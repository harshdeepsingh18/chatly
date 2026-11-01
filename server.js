const express = require("express");
const http = require("http");
const path = require("node:path");
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
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

// Serve index.html, style.css and script.js from the "public" folder
app.use(express.static("public"));
app.use(express.json({ limit: "8kb" }));
app.get("/config.js", (_req, res) => {
  res.type("application/javascript").send(`window.CHATLY_SUPABASE_URL = ${JSON.stringify(supabaseUrl)}; window.CHATLY_SUPABASE_ANON_KEY = ${JSON.stringify(supabaseAnonKey)};`);
});

let savedMessages = {};
let savedQueue = Promise.resolve();
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
  socket.data.authenticatedUser = user;
  next();
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

// socket.id -> username (everyone who is online right now)
const users = new Map();
let messages = [];
let persistenceQueue = Promise.resolve();

async function loadMessages() {
  await mkdir(dataDirectory, { recursive: true });

  let contents;
  try {
    contents = await readFile(messageFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  messages = (contents || "").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid saved message in ${messageFile} on line ${index + 1}: ${error.message}`);
    }
  });
  try { savedMessages = JSON.parse(await readFile(savedFile, "utf8")); }
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
  io.emit("user list", [...users.values()]);
}

io.on("connection", (socket) => {
  // 1. Someone logs in
  socket.on("user joined", () => {
    const authenticatedUser = socket.data.authenticatedUser;
    const name = String(authenticatedUser.user_metadata?.full_name || authenticatedUser.user_metadata?.name || authenticatedUser.email?.split("@")[0] || "Chatly user").trim().slice(0, 20);
    if (users.has(socket.id)) return;

    users.set(socket.id, name);
    io.emit("system message", name + " joined the chat");
    sendUserList();
    socket.emit("chat history", messages);
  });

  // 2. Someone sends a message -> broadcast to everyone (including the sender)
  socket.on("chat message", async (msg) => {
    const user = users.get(socket.id);
    const text = String((msg && msg.text) || "").trim().slice(0, 1000);
    if (!user || !text) return;

    const message = { user, text, time: Date.now() };
    try {
      await persistMessage(message);
    } catch (error) {
      socket.emit("message error", "Your message could not be saved. Please try again.");
      return;
    }

    messages.push(message);
    io.emit("chat message", message);
  });

  // 3. Someone starts/stops typing -> tell everyone else
  socket.on("typing", (isTyping) => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.broadcast.emit("typing", { user, isTyping: Boolean(isTyping) });
  });

  // 4. Someone closes the tab
  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (!user) return;

    users.delete(socket.id);
    socket.broadcast.emit("typing", { user, isTyping: false });
    io.emit("system message", user + " left the chat");
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
