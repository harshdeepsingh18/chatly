const express = require("express");
const http = require("http");
const path = require("node:path");
const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
const { appendFile, mkdir, readFile, unlink, writeFile } = require("node:fs/promises");
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
const reactionsFile = path.join(dataDirectory, "message-reactions.json");
const uploadsFile = path.join(dataDirectory, "uploads.json");
const groupsFile = path.join(dataDirectory, "groups.json");
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
let avatarByUser = new Map();
let usernameQueue = Promise.resolve();
let pinnedMessages = {};
let messageReactions = {};
let reactionQueue = Promise.resolve();
const deletingMessages = new Set();
let uploads = {};
let groups = {};
let groupsQueue = Promise.resolve();
let uploadQueue = Promise.resolve();
let pinQueue = Promise.resolve();
const auraLastRequestByUser = new Map();
const avatarBackgrounds = ["#ed5262", "#68b9a2", "#f0a642", "#a98be8", "#5ba9d3", "#e987b5", "#d4aa57", "#5e78bd", "#6ebd68", "#dd7351", "#55b9bd", "#b76eab"];
const avatarSkins = ["#f6d1b1", "#e8b995", "#d69a70", "#bd805c", "#9b6249", "#f0c7a0", "#81523e", "#613e33"];
const avatarHairs = ["#241d22", "#3b2a24", "#6d422d", "#ad6236", "#d0a34f", "#41454c", "#8a5b72", "#252e3c", "#4b4734", "#b8b3ac"];
const avatarClothes = ["#6556a5", "#337f83", "#b7535d", "#e18449", "#4e719e", "#57916d", "#353b49", "#d16e9b", "#ba9146", "#609caa"];
const avatarUrlFor = (avatarId) => avatarId ? `/api/avatars/${avatarId}.svg` : "";
function makeAvatarSvg(index) {
  const pick = (items, factor) => items[(index * factor + Math.floor(index / 7)) % items.length];
  const bg = pick(avatarBackgrounds, 5);
  const skin = pick(avatarSkins, 3);
  const hair = pick(avatarHairs, 7);
  const clothes = pick(avatarClothes, 9);
  const styles = [
    `<path d="M23 48c-4-24 8-38 28-38 22 0 33 15 27 40-5-8-8-16-9-23-10 9-26 12-44 11z" fill="${hair}"/>`,
    `<path d="M20 48c-5-28 9-39 31-39 22 0 34 16 28 40l-2 32H24z" fill="${hair}"/><path d="M25 44c7-19 27-27 46-17-7-16-30-23-44-9-7 7-8 16-2 26z" fill="${hair}"/>`,
    `<path d="M22 45c-8-20 4-37 28-37 23 0 38 17 28 39-6-6-8-14-8-20-12 13-29 17-48 18z" fill="${hair}"/>${Array.from({length:8},(_,i)=>`<circle cx="${30+(i%4)*13}" cy="${11+Math.floor(i/4)*9}" r="8" fill="${hair}"/>`).join("")}`,
    `<path d="M22 50c-5-29 9-42 31-42 21 0 32 17 26 43-9-8-14-18-15-26-10 10-22 15-42 14z" fill="${hair}"/><circle cx="52" cy="10" r="10" fill="${hair}"/>`,
    `<path d="M21 49c-6-25 7-40 30-40 22 0 36 16 29 42-10-7-16-18-18-28-10 12-23 17-41 18z" fill="${hair}"/><path d="M26 42c-10 12-8 30-1 41" fill="none" stroke="${hair}" stroke-width="8"/>`,
    `<path d="M22 44c0-21 11-35 30-35 21 0 31 14 28 36-9-4-15-11-18-20-9 12-22 18-40 19z" fill="${hair}"/><path d="M73 29c10 9 10 24 5 34" fill="none" stroke="${hair}" stroke-width="8"/>`,
    `<path d="M20 45c-2-24 12-37 32-37 21 0 34 14 29 38-9-10-15-14-21-24-10 12-22 20-40 23z" fill="${hair}"/><path d="M27 16c8-11 22-13 31-8" fill="none" stroke="${hair}" stroke-width="8" stroke-linecap="round"/>`,
    `<path d="M21 48c-4-26 9-40 31-40 23 0 35 16 28 42-9-7-12-18-14-27-11 13-27 20-45 25z" fill="${hair}"/><path d="M23 37c-7 8-6 20-2 30M77 37c7 8 6 20 2 30" fill="none" stroke="${hair}" stroke-width="7"/>`
  ];
  const glasses = index % 5 === 0 ? `<g fill="none" stroke="#28313b" stroke-width="2.4"><circle cx="40" cy="47" r="7"/><circle cx="60" cy="47" r="7"/><path d="M47 47h6M33 46l-5-2M67 46l5-2"/></g>` : "";
  const earrings = index % 4 === 0 ? `<circle cx="27" cy="62" r="2.4" fill="#f4cf74"/><circle cx="73" cy="62" r="2.4" fill="#f4cf74"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="${bg}"/><path d="M12 100c3-22 17-32 38-32s35 10 38 32" fill="${clothes}"/><path d="M42 66h16v12H42z" fill="${skin}"/><ellipse cx="27" cy="48" rx="5" ry="8" fill="${skin}"/><ellipse cx="73" cy="48" rx="5" ry="8" fill="${skin}"/><ellipse cx="50" cy="46" rx="23" ry="28" fill="${skin}"/>${styles[index%styles.length]}<path d="M38 44h5M57 44h5" stroke="#332821" stroke-width="2.5" stroke-linecap="round"/><circle cx="41" cy="49" r="2.1" fill="#2d2726"/><circle cx="59" cy="49" r="2.1" fill="#2d2726"/><path d="M49 51l-2 7 4 1" fill="none" stroke="#b8795e" stroke-width="1.7" stroke-linecap="round"/><path d="M44 63q6 5 12 0" fill="none" stroke="#8d4e4e" stroke-width="2" stroke-linecap="round"/>${glasses}${earrings}</svg>`;
}
app.get("/api/avatars/:avatarId.svg", (req, res) => {
  const match = req.params.avatarId.match(/^avatar-(\d{1,3})$/);
  const index = match ? Number(match[1]) : 0;
  if (!index || index > 120) return res.sendStatus(404);
  res.type("image/svg+xml").set("Cache-Control", "public, max-age=31536000, immutable").send(makeAvatarSvg(index));
});
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
  socket.data.googleAvatar = user.user_metadata?.avatar_url || user.user_metadata?.picture || "";
  const avatar = avatarUrlFor(avatarByUser.get(user.id)) || socket.data.googleAvatar;
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
app.get("/api/avatar", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in first." });
  const avatarId = avatarByUser.get(user.id) || "";
  res.json({ avatarId, avatar: avatarUrlFor(avatarId) });
});
app.post("/api/avatar", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in first." });
  const avatarId = String(req.body?.avatarId || "");
  if (avatarId && (!/^avatar-\d{1,3}$/.test(avatarId) || Number(avatarId.slice(7)) < 1 || Number(avatarId.slice(7)) > 120)) {
    return res.status(400).json({ error: "Choose one of the available avatars." });
  }
  const operation = usernameQueue.then(async () => {
    const currentName = usernameByUser.get(user.id);
    if (!currentName) throw new Error("Choose a username before selecting an avatar.");
    const key = currentName.toLocaleLowerCase();
    const current = usernameRegistry.get(key);
    if (!current || current.id !== user.id) throw new Error("Could not find your Chatly profile.");
    const next = new Map(usernameRegistry);
    const updated = { ...current };
    if (avatarId) updated.avatarId = avatarId;
    else delete updated.avatarId;
    next.set(key, updated);
    await writeFile(usernameFile, JSON.stringify([...next.values()], null, 2), "utf8");
    usernameRegistry = next;
    if (avatarId) avatarByUser.set(user.id, avatarId);
    else avatarByUser.delete(user.id);
  });
  usernameQueue = operation.catch(() => {});
  try {
    await operation;
    const avatar = avatarUrlFor(avatarId);
    const profileAvatar = avatar || user.user_metadata?.avatar_url || user.user_metadata?.picture || "";
    const persistUpdatedAvatars = persistenceQueue.then(async () => {
      const nextMessages = messages.map((message) => message.senderId === user.id ? { ...message, googleAvatar: message.googleAvatar || message.avatar || "", avatar: avatar || message.googleAvatar || message.avatar || "" } : message);
      await writeFile(messageFile, nextMessages.map((message) => JSON.stringify(message)).join("\n") + (nextMessages.length ? "\n" : ""), "utf8");
      messages = nextMessages;
    });
    persistenceQueue = persistUpdatedAvatars.catch((error) => console.error("Could not update profile avatars in message history:", error));
    await persistUpdatedAvatars;
    for (const activeSocket of io.sockets.sockets.values()) {
      if (activeSocket.data.userId !== user.id) continue;
      activeSocket.data.avatar = profileAvatar;
      const member = users.get(activeSocket.id);
      if (member) users.set(activeSocket.id, { ...member, avatar: profileAvatar });
    }
    io.emit("avatar updated", { userId: user.id, avatar: profileAvatar });
    sendUserList();
    res.json({ avatarId, avatar: profileAvatar });
  } catch { res.status(500).json({ error: "Could not save your avatar." }); }
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
    const previousEntry = previous ? usernameRegistry.get(previous.toLocaleLowerCase()) : null;
    next.set(key, { ...previousEntry, ...currentOwner, id: user.id, name });
    await writeFile(usernameFile, JSON.stringify([...next.values()], null, 2), "utf8");
    usernameRegistry = next;
    usernameByUser = new Map([...next.values()].map((entry) => [entry.id, entry.name]));
    for (const activeSocket of io.sockets.sockets.values()) {
      if (activeSocket.data.userId !== user.id) continue;
      activeSocket.data.username = name;
      const member = users.get(activeSocket.id);
      if (member) users.set(activeSocket.id, { ...member, name });
      activeSocket.emit("username updated", name);
    }
    sendUserList();
    return name;
  });
  usernameQueue = operation.catch(() => {});
  try { res.json({ username: await operation }); }
  catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : "Could not save username." }); }
});
app.get("/api/groups", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in first." });
  const onlineById = new Map();
  for (const [socketId, member] of users) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket?.data.userId) onlineById.set(socket.data.userId, member);
  }
  res.json(Object.values(groups).filter((group) => group.memberIds.includes(user.id)).map((group) => ({
    ...group,
    members: group.memberIds.map((id) => ({ id, name: usernameByUser.get(id) || "Chatly member", avatar: onlineById.get(id)?.avatar || avatarUrlFor(avatarByUser.get(id)), online: onlineById.has(id) }))
  })));
});
app.get("/api/group-members", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in first." });
  const onlineById = new Map();
  for (const [socketId, member] of users) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket?.data.userId) onlineById.set(socket.data.userId, member);
  }
  res.json([...usernameByUser.entries()].filter(([id]) => id !== user.id).map(([id, name]) => ({
    id, name, avatar: onlineById.get(id)?.avatar || avatarUrlFor(avatarByUser.get(id)), online: onlineById.has(id)
  })).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)));
});
app.post("/api/groups", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in first." });
  const name = String(req.body?.name || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 40 || /[\r\n\u0000-\u001f]/.test(name)) return res.status(400).json({ error: "Group names must be 1 to 40 characters." });
  const invitees = Array.isArray(req.body?.memberIds) ? [...new Set(req.body.memberIds.filter((id) => typeof id === "string"))] : [];
  if (!invitees.length || invitees.length > 24 || invitees.some((id) => !usernameByUser.has(id))) return res.status(400).json({ error: "Choose between 1 and 24 registered members." });
  const operation = groupsQueue.then(async () => {
    const id = crypto.randomUUID();
    const group = { id, name, creatorId: user.id, memberIds: [...new Set([user.id, ...invitees])], createdAt: Date.now() };
    const next = { ...groups, [id]: group };
    await writeFile(groupsFile, JSON.stringify(next, null, 2), "utf8");
    groups = next;
    for (const memberId of group.memberIds) io.to(`user:${memberId}`).emit("groups updated");
    return group;
  });
  groupsQueue = operation.catch(() => {});
  try { res.status(201).json(await operation); }
  catch { res.status(500).json({ error: "Could not create the group." }); }
});
app.post("/api/groups/:id/members", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in first." });
  const group = groups[req.params.id];
  if (!group || group.creatorId !== user.id) return res.status(404).json({ error: "Only the group creator can add members." });
  const additions = Array.isArray(req.body?.memberIds) ? [...new Set(req.body.memberIds.filter((id) => typeof id === "string"))] : [];
  if (!additions.length || additions.length > 24 || additions.some((id) => !usernameByUser.has(id))) return res.status(400).json({ error: "Choose at least one registered member to add." });
  const operation = groupsQueue.then(async () => {
    const current = groups[req.params.id];
    if (!current || current.creatorId !== user.id) throw new Error("Only the group creator can add members.");
    const nextGroup = { ...current, memberIds: [...new Set([...current.memberIds, ...additions])] };
    if (nextGroup.memberIds.length > 25) {
      const error = new Error("Groups can have up to 25 members.");
      error.status = 400;
      throw error;
    }
    const next = { ...groups, [current.id]: nextGroup };
    await writeFile(groupsFile, JSON.stringify(next, null, 2), "utf8");
    groups = next;
    nextGroup.memberIds.forEach((memberId) => io.to(`user:${memberId}`).emit("groups updated"));
    return nextGroup;
  });
  groupsQueue = operation.catch(() => {});
  try { res.json(await operation); }
  catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : "Could not add those members." }); }
});
app.get("/api/saved-messages", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to view saved messages." });
  const liveMessages = new Map(messages.map((message) => [message.id, message]));
  res.json((savedMessages[user.id] || []).map((message) => ({ ...message, reactions: liveMessages.get(message.id)?.reactions || messageReactions[message.id] || {} })));
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
  if (chatRooms.includes(conversation) || isDirectConversationFor(conversation, userId)) return true;
  if (typeof conversation === "string" && conversation.startsWith("group:")) return Boolean(groups[conversation.slice(6)]?.memberIds.includes(userId));
  return false;
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
    avatarByUser = new Map(entries.filter((entry) => entry.avatarId).map((entry) => [entry.id, entry.avatarId]));
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  try { pinnedMessages = JSON.parse(await readFile(pinsFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  try { messageReactions = JSON.parse(await readFile(reactionsFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  messages = messages.map((message) => ({ ...message, reactions: messageReactions[message.id] || message.reactions || {} }));
  try { uploads = JSON.parse(await readFile(uploadsFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  try { groups = JSON.parse(await readFile(groupsFile, "utf8")); }
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

    const member = { name, avatar: socket.data.avatar, googleAvatar: socket.data.googleAvatar };
    users.set(socket.id, member);
    chatRooms.forEach((room) => socket.join(room));
    io.emit("system message", name + " joined the chat");
    sendUserList();
  });

  socket.on("join room", (room) => {
    if (!chatRooms.includes(room)) return;
    sendConversation(socket, room);
  });

  socket.on("join group", (groupId) => {
    if (typeof groupId !== "string" || !canAccessConversation(`group:${groupId}`, socket.data.userId)) return;
    sendConversation(socket, `group:${groupId}`);
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
      text, time: Date.now(), avatar: member.avatar, googleAvatar: member.googleAvatar, attachment: attachment ? uploads[attachment.id] : undefined
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
    } else if (conversation.startsWith("group:")) {
      const group = groups[conversation.slice(6)];
      group?.memberIds.filter((id) => id !== socket.data.userId).forEach((id) => io.to(`user:${id}`).emit("direct notification", { conversation, fromId: socket.data.userId, fromName: member.name }));
    }
  });

  socket.on("delete message", async (messageId) => {
    if (typeof messageId !== "string" || messageId.length > 100) return;
    const message = messages.find((item) => item.id === messageId);
    if (!message || message.deleted || message.conversation !== socket.data.activeConversation || !canAccessConversation(message.conversation, socket.data.userId)) return;
    deletingMessages.add(messageId);
    const conversation = message.conversation;
    const deleter = users.get(socket.id);
    if (!deleter) return;
    const tombstone = {
      id: message.id, conversation, user: deleter.name, senderId: socket.data.userId,
      text: "This message was deleted.", time: message.time, avatar: deleter.avatar || "",
      deleted: true, deletedAt: Date.now()
    };
    const nextMessages = messages.map((item) => item.id === messageId ? tombstone : item);
    const nextPins = { ...pinnedMessages, [conversation]: (pinnedMessages[conversation] || []).filter((id) => id !== messageId) };
    const nextSaved = Object.fromEntries(Object.entries(savedMessages).map(([ownerId, items]) => [ownerId, items.filter((item) => item.id !== messageId)]));
    const attachmentId = message.attachment?.id;
    const attachmentStillUsed = attachmentId && nextMessages.some((item) => item.attachment?.id === attachmentId);
    try {
      const reactionCleanup = reactionQueue.then(async () => {
        const nextReactions = { ...messageReactions };
        delete nextReactions[messageId];
        await writeFile(reactionsFile, JSON.stringify(nextReactions), "utf8");
        messageReactions = nextReactions;
      });
      reactionQueue = reactionCleanup.catch((error) => console.error("Could not remove deleted message reactions:", error));
      await reactionCleanup;
      const operation = persistenceQueue.then(async () => {
        await writeFile(messageFile, nextMessages.map((item) => JSON.stringify(item)).join("\n") + (nextMessages.length ? "\n" : ""), "utf8");
        await writeFile(pinsFile, JSON.stringify(nextPins), "utf8");
        await writeFile(savedFile, JSON.stringify(nextSaved), "utf8");
        if (attachmentId && !attachmentStillUsed) {
          const nextUploads = { ...uploads };
          delete nextUploads[attachmentId];
          await writeFile(uploadsFile, JSON.stringify(nextUploads), "utf8");
          try { await unlink(path.join(uploadDirectory, attachmentId)); } catch (error) { if (error.code !== "ENOENT") throw error; }
          uploads = nextUploads;
        }
        messages = nextMessages;
        pinnedMessages = nextPins;
        savedMessages = nextSaved;
      });
      persistenceQueue = operation.catch((error) => console.error("Could not delete chat message:", error));
      await operation;
      io.to(conversation).emit("message deleted", { message: tombstone, conversation, pinned: conversationPins(conversation) });
    } catch { socket.emit("message error", "Could not delete this message. Please try again."); }
    finally { deletingMessages.delete(messageId); }
  });

  socket.on("react message", async ({ messageId, emoji } = {}) => {
    const allowedEmojis = new Set(["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "🙏"]);
    if (typeof messageId !== "string" || !allowedEmojis.has(emoji) || deletingMessages.has(messageId)) return;
    const initial = messages.find((item) => item.id === messageId);
    const conversation = socket.data.activeConversation;
    if (!initial || initial.deleted || initial.conversation !== conversation || !canAccessConversation(conversation, socket.data.userId)) return;
    const operation = reactionQueue.then(async () => {
      const message = messages.find((item) => item.id === messageId);
      if (!message || message.deleted || message.conversation !== socket.data.activeConversation || !canAccessConversation(message.conversation, socket.data.userId)) return;
      const nextMessageReactions = { ...(messageReactions[messageId] || message.reactions || {}) };
      const users = new Set(nextMessageReactions[emoji] || []);
      users.has(socket.data.userId) ? users.delete(socket.data.userId) : users.add(socket.data.userId);
      if (users.size) nextMessageReactions[emoji] = [...users];
      else delete nextMessageReactions[emoji];
      const nextAllReactions = { ...messageReactions };
      if (Object.keys(nextMessageReactions).length) nextAllReactions[messageId] = nextMessageReactions;
      else delete nextAllReactions[messageId];
      await writeFile(reactionsFile, JSON.stringify(nextAllReactions), "utf8");
      messageReactions = nextAllReactions;
      message.reactions = nextMessageReactions;
      io.to(conversation).emit("message reactions", { id: messageId, conversation, reactions: nextMessageReactions });
    });
    reactionQueue = operation.catch((error) => console.error("Could not save message reaction:", error));
    try { await operation; }
    catch { socket.emit("message error", "Could not save that reaction."); }
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
