const express = require("express");
const http = require("http");
const path = require("node:path");
const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
const { appendFile, mkdir, readFile, writeFile } = require("node:fs/promises");
const { Server } = require("socket.io");

function loadEnvFile(file) {
  let contents;
  try { contents = readFileSync(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    process.env[match[1]] = value;
  }
}
loadEnvFile(path.join(__dirname, ".env"));

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const dataDirectory = path.join(__dirname, "data");
const messageFile = path.join(dataDirectory, "messages.jsonl");
const savedFile = path.join(dataDirectory, "saved-messages.json");
const usernameFile = path.join(dataDirectory, "usernames.json");
const pinsFile = path.join(dataDirectory, "pinned-messages.json");
const uploadsFile = path.join(dataDirectory, "uploads.json");
const uploadDirectory = path.join(dataDirectory, "uploads");
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
const geminiApiKey = process.env.GEMINI_API_KEY || "";
const geminiModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const chatRooms = ["general", "doubts", "notes"];

// Serve index.html, style.css and script.js from the "public" folder
app.use(express.static("public"));
app.use(express.json({ limit: "8kb" }));
app.get("/config.js", (_req, res) => {
  res.type("application/javascript").send(`window.CHATLY_SUPABASE_URL = ${JSON.stringify(supabaseUrl)}; window.CHATLY_SUPABASE_ANON_KEY = ${JSON.stringify(supabaseAnonKey)}; window.CHATLY_ROOMS = ${JSON.stringify(chatRooms)}; window.CHATLY_AURA_ENABLED = ${Boolean(geminiApiKey)};`);
});

let savedMessages = {};
let savedQueue = Promise.resolve();
let usernameRegistry = new Map();
let usernameByUser = new Map();
let usernameQueue = Promise.resolve();
let pinnedMessages = {};
let uploads = {};
let uploadQueue = Promise.resolve();
let pinQueue = Promise.resolve();
const auraLastRequestByUser = new Map();
async function getSupabaseUser(req) {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  return getSupabaseUserForToken(token);
}
async function getSupabaseUserForToken(token) {
  if (!supabaseUrl || !supabaseAnonKey || !token) return null;
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}
io.use(async (socket, next) => {
  const user = await getSupabaseUserForToken(socket.handshake.auth?.token);
  if (!user) return next(new Error("Google sign-in is required to join Chatly."));
  const username = usernameByUser.get(user.id);
  if (!username) return next(new Error("Choose a username before joining Chatly."));
  socket.data.authenticatedUser = user;
  socket.data.userId = user.id;
  socket.data.username = username;
  const avatar = user.user_metadata?.avatar_url || user.user_metadata?.picture || "";
  try {
    const parsedAvatar = new URL(avatar);
    socket.data.avatar = parsedAvatar.protocol === "https:" ? parsedAvatar.href : "";
  } catch { socket.data.avatar = ""; }
  next();
});
app.get("/api/username", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in with Google first." });
  res.json({ username: usernameByUser.get(user.id) || "" });
});
app.post("/api/username", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in with Google first." });
  const name = String(req.body?.username || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 20 || /[\r\n\u0000-\u001f]/.test(name)) {
    return res.status(400).json({ error: "Choose a username between 1 and 20 characters." });
  }
  const operation = usernameQueue.then(async () => {
    const key = name.toLocaleLowerCase();
    const currentOwner = usernameRegistry.get(key);
    if (currentOwner && currentOwner.id !== user.id) {
      const error = new Error("That username is already taken. Please choose another.");
      error.status = 409;
      throw error;
    }
    const next = new Map(usernameRegistry);
    const previous = usernameByUser.get(user.id);
    if (previous && previous.toLocaleLowerCase() !== key) next.delete(previous.toLocaleLowerCase());
    next.set(key, { id: user.id, name });
    await writeFile(usernameFile, JSON.stringify([...next.values()], null, 2), "utf8");
    usernameRegistry = next;
    usernameByUser = new Map([...next.values()].map((entry) => [entry.id, entry.name]));
    return name;
  });
  usernameQueue = operation.catch(() => {});
  try { res.json({ username: await operation }); }
  catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : "Could not save username." }); }
});
app.get("/api/saved-messages", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to view saved messages." });
  res.json(savedMessages[user.id] || []);
});
app.post("/api/saved-messages", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to save messages." });
  const { message, saved } = req.body || {};
  if (!message || typeof message.text !== "string" || typeof message.user !== "string" || !Number.isFinite(message.time)) {
    return res.status(400).json({ error: "Invalid message." });
  }
  const list = savedMessages[user.id] || [];
  const key = `${message.user}\n${message.time}\n${message.text}`;
  savedMessages[user.id] = saved ? (list.some((item) => `${item.user}\n${item.time}\n${item.text}` === key) ? list : [...list, message]) : list.filter((item) => `${item.user}\n${item.time}\n${item.text}` !== key);
  const write = savedQueue.then(() => writeFile(savedFile, JSON.stringify(savedMessages), "utf8"));
  savedQueue = write.catch((error) => console.error("Could not save bookmarks:", error));
  write.then(() => res.json({ saved: savedMessages[user.id] }), () => res.status(500).json({ error: "Could not save this message." }));
});

function directConversation(a, b) { return `dm:${[a, b].sort().join(":")}`; }
function isDirectConversationFor(conversation, userId) {
  const parts = String(conversation || "").split(":");
  return parts.length === 3 && parts[0] === "dm" && parts.slice(1).includes(userId);
}
function canAccessConversation(conversation, userId) {
  return chatRooms.includes(conversation) || isDirectConversationFor(conversation, userId);
}
function conversationPins(conversation) {
  const ids = new Set(pinnedMessages[conversation] || []);
  return messages.filter((message) => message.conversation === conversation && ids.has(message.id));
}

const allowedFileTypes = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf",
  "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);
app.post("/api/uploads", express.raw({ type: "application/octet-stream", limit: "12mb" }), async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to upload files." });
  const conversation = req.get("x-chat-conversation") || "";
  if (!canAccessConversation(conversation, user.id)) return res.status(400).json({ error: "Choose a room or direct chat first." });
  const type = String(req.get("x-file-type") || "application/octet-stream").toLowerCase();
  if (!allowedFileTypes.has(type)) return res.status(415).json({ error: "Use an image, PDF, text file, or DOCX document." });
  const buffer = req.body;
  if (!Buffer.isBuffer(buffer) || !buffer.length) return res.status(400).json({ error: "The selected file is empty." });
  const encodedName = req.get("x-file-name") || "attachment";
  let name;
  try { name = decodeURIComponent(encodedName).replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120); }
  catch { name = "attachment"; }
  const id = crypto.randomUUID();
  const metadata = { id, name: name || "attachment", type, size: buffer.length, conversation, uploaderId: user.id };
  await writeFile(path.join(uploadDirectory, id), buffer);
  const operation = uploadQueue.then(async () => {
    const next = { ...uploads, [id]: metadata };
    await writeFile(uploadsFile, JSON.stringify(next), "utf8");
    uploads = next;
  });
  uploadQueue = operation.catch((error) => console.error("Could not save upload metadata:", error));
  try {
    await operation;
    res.json({ id, name: metadata.name, type, size: metadata.size });
  } catch { res.status(500).json({ error: "Could not save the uploaded file." }); }
});
app.get("/api/uploads/:id", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to view this attachment." });
  const file = uploads[req.params.id];
  if (!file || !canAccessConversation(file.conversation, user.id)) return res.sendStatus(404);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Disposition", `${file.type.startsWith("image/") || file.type === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.type(file.type).sendFile(path.join(uploadDirectory, file.id));
});

// socket.id -> username (everyone who is online right now)
const users = new Map();
let messages = [];
let persistenceQueue = Promise.resolve();

async function loadMessages() {
  await mkdir(dataDirectory, { recursive: true });
  await mkdir(uploadDirectory, { recursive: true });

  let contents;
  try {
    contents = await readFile(messageFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  messages = (contents || "").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      const message = JSON.parse(line);
      const id = message.id || crypto.createHash("sha256").update(`${message.user}\n${message.time}\n${message.text}`).digest("hex").slice(0, 32);
      return { ...message, id, conversation: message.conversation || message.room || "general" };
    } catch (error) {
      throw new Error(`Invalid saved message in ${messageFile} on line ${index + 1}: ${error.message}`);
    }
  });
  try { savedMessages = JSON.parse(await readFile(savedFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  try {
    const entries = JSON.parse(await readFile(usernameFile, "utf8"));
    usernameRegistry = new Map(entries.map((entry) => [entry.name.toLocaleLowerCase(), entry]));
    usernameByUser = new Map(entries.map((entry) => [entry.id, entry.name]));
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  try { pinnedMessages = JSON.parse(await readFile(pinsFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  try { uploads = JSON.parse(await readFile(uploadsFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

function persistMessage(message) {
  const write = persistenceQueue.then(() =>
    appendFile(messageFile, `${JSON.stringify(message)}\n`, "utf8")
  );
  persistenceQueue = write.catch((error) => {
    console.error("Could not save chat message:", error);
  });
  return write;
}

function sendUserList() {
  const online = new Map();
  for (const socket of io.sockets.sockets.values()) {
    if (!socket.data.userId || !users.has(socket.id)) continue;
    online.set(socket.data.userId, { id: socket.data.userId, ...users.get(socket.id) });
  }
  io.emit("user list", [...online.values()]);
}

function sendConversation(socket, conversation) {
  socket.data.activeConversation = conversation;
  socket.join(conversation);
  socket.emit("conversation history", {
    conversation,
    messages: messages.filter((message) => message.conversation === conversation),
    pinned: conversationPins(conversation)
  });
}

async function askGemini(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey },
      body: JSON.stringify({
        model: geminiModel,
        input: `You are Aura, a friendly study helper in Chatly. Explain clearly and briefly, show steps for difficult topics, and say when you are unsure.\n\nStudent question: ${prompt}`,
        store: false
      }),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Gemini request failed.");
    const answer = (data.steps || []).flatMap((step) => step.content || []).filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
    if (!answer) throw new Error("Aura did not return an answer.");
    return answer.slice(0, 8000);
  } finally { clearTimeout(timeout); }
}

io.on("connection", (socket) => {
  socket.join(`user:${socket.data.userId}`);
  // 1. Someone logs in
  socket.on("user joined", () => {
    const name = socket.data.username;
    if (users.has(socket.id)) return;

    const member = { name, avatar: socket.data.avatar };
    users.set(socket.id, member);
    chatRooms.forEach((room) => socket.join(room));
    io.emit("system message", name + " joined the chat");
    sendUserList();
  });

  socket.on("join room", (room) => {
    if (!chatRooms.includes(room)) return;
    sendConversation(socket, room);
  });

  socket.on("open direct", (targetId) => {
    if (typeof targetId !== "string" || targetId === socket.data.userId || !usernameByUser.has(targetId)) return;
    const conversation = directConversation(socket.data.userId, targetId);
    sendConversation(socket, conversation);
    const target = [...users.entries()].find(([id]) => io.sockets.sockets.get(id)?.data.userId === targetId)?.[1];
    socket.emit("direct opened", {
      conversation,
      user: { id: targetId, name: usernameByUser.get(targetId), avatar: target?.avatar || "" }
    });
  });

  // 2. Someone sends a message -> broadcast to everyone (including the sender)
  socket.on("chat message", async (msg) => {
    const member = users.get(socket.id);
    const text = String((msg && msg.text) || "").trim().slice(0, 1000);
    const conversation = socket.data.activeConversation;
    const attachment = msg && msg.attachment;
    if (!member || !conversation || !canAccessConversation(conversation, socket.data.userId) || (!text && !attachment)) return;
    if (attachment && (!uploads[attachment.id] || uploads[attachment.id].conversation !== conversation)) return;

    const message = {
      id: crypto.randomUUID(), conversation, user: member.name, senderId: socket.data.userId,
      text, time: Date.now(), avatar: member.avatar, attachment: attachment ? uploads[attachment.id] : undefined
    };
    try {
      await persistMessage(message);
    } catch (error) {
      socket.emit("message error", "Your message could not be saved. Please try again.");
      return;
    }

    messages.push(message);
    io.to(conversation).emit("chat message", message);
    if (isDirectConversationFor(conversation, socket.data.userId)) {
      const recipientId = conversation.split(":").slice(1).find((id) => id !== socket.data.userId);
      io.to(`user:${recipientId}`).emit("direct notification", { conversation, fromId: socket.data.userId, fromName: member.name });
    }
  });

  socket.on("pin message", (messageId) => {
    const conversation = socket.data.activeConversation;
    const message = messages.find((item) => item.id === messageId && item.conversation === conversation);
    if (!message) return;
    const ids = new Set(pinnedMessages[conversation] || []);
    ids.has(messageId) ? ids.delete(messageId) : ids.add(messageId);
    pinnedMessages[conversation] = [...ids];
    const write = pinQueue.then(() => writeFile(pinsFile, JSON.stringify(pinnedMessages), "utf8"));
    pinQueue = write.catch((error) => console.error("Could not save pinned messages:", error));
    write.then(() => io.to(conversation).emit("pinned messages", { conversation, messages: conversationPins(conversation) }))
      .catch(() => socket.emit("message error", "Could not update pinned messages."));
  });

  socket.on("aura request", async (prompt) => {
    const conversation = socket.data.activeConversation;
    prompt = String(prompt || "").trim().slice(0, 1000);
    if (!conversation || !prompt) return;
    if (!geminiApiKey) return socket.emit("message error", "Aura needs a GEMINI_API_KEY in the server .env file.");
    const lastRequest = auraLastRequestByUser.get(socket.data.userId) || 0;
    if (Date.now() - lastRequest < 4000) return socket.emit("message error", "Give Aura a moment before asking another question.");
    auraLastRequestByUser.set(socket.data.userId, Date.now());
    try {
      const answer = await askGemini(prompt);
      const message = {
        id: crypto.randomUUID(), conversation, user: "Aura", senderId: "aura",
        text: answer, time: Date.now(), avatar: "", assistant: true
      };
      await persistMessage(message);
      messages.push(message);
      io.to(conversation).emit("chat message", message);
      if (isDirectConversationFor(conversation, socket.data.userId)) {
        const recipientId = conversation.split(":").slice(1).find((id) => id !== socket.data.userId);
        io.to(`user:${recipientId}`).emit("direct notification", { conversation, fromId: socket.data.userId, fromName: "Aura", id: message.id });
      }
    } catch (error) {
      socket.emit("message error", error.name === "AbortError" ? "Aura took too long to answer. Try again." : "Aura could not answer right now.");
    }
  });

  socket.on("call offer", ({ toId, callId, offer, video }) => {
    if (typeof toId !== "string" || toId === socket.data.userId || !usernameByUser.has(toId) || typeof callId !== "string" || !offer) return;
    io.to(`user:${toId}`).emit("incoming call", {
      callId, fromId: socket.data.userId, fromName: socket.data.username,
      fromAvatar: socket.data.avatar, offer, video: Boolean(video)
    });
  });

  socket.on("call answer", ({ toId, callId, answer }) => {
    if (typeof toId !== "string" || !usernameByUser.has(toId) || typeof callId !== "string" || !answer) return;
    io.to(`user:${toId}`).emit("call answered", { callId, fromId: socket.data.userId, answer });
  });

  socket.on("call ice", ({ toId, callId, candidate }) => {
    if (typeof toId !== "string" || !usernameByUser.has(toId) || typeof callId !== "string" || !candidate) return;
    io.to(`user:${toId}`).emit("call ice", { callId, fromId: socket.data.userId, candidate });
  });

  socket.on("call end", ({ toId, callId, reason }) => {
    if (typeof toId !== "string" || !usernameByUser.has(toId) || typeof callId !== "string") return;
    io.to(`user:${toId}`).emit("call ended", { callId, fromId: socket.data.userId, reason: String(reason || "ended") });
  });

  // 3. Someone starts/stops typing -> tell everyone else
  socket.on("typing", (isTyping) => {
    const member = users.get(socket.id);
    if (!member || !socket.data.activeConversation) return;
    socket.to(socket.data.activeConversation || "").emit("typing", { user: member.name, isTyping: Boolean(isTyping) });
  });

  // 4. Someone closes the tab
  socket.on("disconnect", () => {
    const member = users.get(socket.id);
    if (!member) return;

    users.delete(socket.id);
    socket.broadcast.emit("typing", { user: member.name, isTyping: false });
    io.emit("system message", member.name + " left the chat");
    sendUserList();
  });
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  await loadMessages();
  server.listen(PORT, () => {
    console.log("Chatly running at http://localhost:" + PORT);
  });
}

startServer().catch((error) => {
  console.error("Unable to start Chatly:", error);
  process.exitCode = 1;
});
