const express = require("express");
const http = require("http");
const path = require("node:path");
const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
const { Server } = require("socket.io");
const { createSupabaseStore } = require("./supabase-store");

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
const allowedOrigins = (process.env.CHATLY_ALLOWED_ORIGINS || process.env.CHATLY_WEB_ORIGIN || "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "http://127.0.0.1:3000", ...allowedOrigins],
    methods: ["GET", "POST"]
  }
});
const dataDirectory = path.join(__dirname, "data");
const messageFile = path.join(dataDirectory, "messages.jsonl");
const savedFile = path.join(dataDirectory, "saved-messages.json");
const usernameFile = path.join(dataDirectory, "usernames.json");
const pinsFile = path.join(dataDirectory, "pinned-messages.json");
const reactionsFile = path.join(dataDirectory, "message-reactions.json");
const uploadsFile = path.join(dataDirectory, "uploads.json");
const groupsFile = path.join(dataDirectory, "groups.json");
const ticTacToeFile = path.join(dataDirectory, "tic-tac-toe.json");
const partyGamesFile = path.join(dataDirectory, "party-games.json");
const uploadDirectory = path.join(dataDirectory, "uploads");
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const apiUrl = (process.env.CHATLY_API_URL || "").replace(/\/$/, "");
const realtimeUrl = (process.env.CHATLY_REALTIME_URL || "").replace(/\/$/, "");
const supabaseStore = createSupabaseStore({ url: supabaseUrl, serviceKey: supabaseServiceRoleKey, dataDirectory });
const readFile = (...args) => supabaseStore.readFile(...args);
const writeFile = (...args) => supabaseStore.writeFile(...args);
const appendFile = (...args) => supabaseStore.appendFile(...args);
const mkdir = (...args) => supabaseStore.mkdir(...args);
const unlink = (...args) => supabaseStore.unlink(...args);
const configuredOpenAiApiKey = process.env.OPENAI_API_KEY || "";
const openAiApiKey = configuredOpenAiApiKey.toLowerCase().startsWith("your-") ? "" : configuredOpenAiApiKey;
const openAiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const configuredGeminiApiKey = process.env.GEMINI_API_KEY || "";
const geminiApiKey = configuredGeminiApiKey.toLowerCase().startsWith("your-") ? "" : configuredGeminiApiKey;
const geminiModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const chatRooms = ["general", "doubts", "notes"];

app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && allowedOrigins.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Chat-Conversation, X-File-Name, X-File-Type");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(origin && allowedOrigins.includes(origin) ? 204 : 403);
  next();
});
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "8kb" }));
app.get("/config.js", (_req, res) => {
  res.type("application/javascript").send(`window.CHATLY_SUPABASE_URL = ${JSON.stringify(supabaseUrl)}; window.CHATLY_SUPABASE_ANON_KEY = ${JSON.stringify(supabaseAnonKey)}; window.CHATLY_ROOMS = ${JSON.stringify(chatRooms)}; window.CHATLY_AURA_ENABLED = ${Boolean(openAiApiKey || geminiApiKey)}; window.CHATLY_API_URL = ${JSON.stringify(apiUrl)}; window.CHATLY_REALTIME_URL = ${JSON.stringify(realtimeUrl)};`);
});
app.get("/socket.io/socket.io.js", (_req, res) => res.sendFile(require.resolve("socket.io/client-dist/socket.io.js")));
let initializationPromise;
function initializeStorage() {
  if (!initializationPromise) initializationPromise = loadMessages();
  return initializationPromise;
}
app.use((req, res, next) => {
  initializeStorage().then(() => next(), next);
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
let ticTacToeGames = {};
let ticTacToeQueue = Promise.resolve();
let partyGames = {};
let partyGamesQueue = Promise.resolve();
let groupsQueue = Promise.resolve();
let uploadQueue = Promise.resolve();
let pinQueue = Promise.resolve();
const auraLastRequestByUser = new Map();
const avatarBackgrounds = ["#ed5262", "#68b9a2", "#f0a642", "#a98be8", "#5ba9d3", "#e987b5", "#d4aa57", "#5e78bd", "#6ebd68", "#dd7351", "#55b9bd", "#b76eab"];
const avatarSkins = ["#f6d1b1", "#e8b995", "#d69a70", "#bd805c", "#9b6249", "#f0c7a0", "#81523e", "#613e33"];
const avatarHairs = ["#241d22", "#3b2a24", "#6d422d", "#ad6236", "#d0a34f", "#41454c", "#8a5b72", "#252e3c", "#4b4734", "#b8b3ac"];
const avatarClothes = ["#6556a5", "#337f83", "#b7535d", "#e18449", "#4e719e", "#57916d", "#353b49", "#d16e9b", "#ba9146", "#609caa"];
const avatarUrlFor = (avatarId) => avatarId ? `${apiUrl}/api/avatars/${avatarId}.svg` : "";
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
  res.json((savedMessages[user.id] || []).map((message) => {
    const reactions = liveMessages.get(message.id)?.reactions || messageReactions[message.id] || {};
    return { ...message, reactions, reactionNames: reactionNamesFor(reactions) };
  }));
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
function reactionNamesFor(reactions = {}) {
  return Object.fromEntries(Object.entries(reactions).map(([emoji, userIds]) => [
    emoji, userIds.map((id) => usernameByUser.get(id) || "Chatly member")
  ]));
}

const allowedFileTypes = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf",
  "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac"
]);
app.post("/api/uploads", express.raw({ type: "application/octet-stream", limit: "12mb" }), async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to upload files." });
  const conversation = req.get("x-chat-conversation") || "";
  if (!canAccessConversation(conversation, user.id)) return res.status(400).json({ error: "Choose a room or direct chat first." });
  const type = String(req.get("x-file-type") || "application/octet-stream").toLowerCase();
  if (!allowedFileTypes.has(type)) return res.status(415).json({ error: "Use an image, PDF, text file, DOCX document, or audio recording." });
  const buffer = req.body;
  if (!Buffer.isBuffer(buffer) || !buffer.length) return res.status(400).json({ error: "The selected file is empty." });
  const encodedName = req.get("x-file-name") || "attachment";
  let name;
  try { name = decodeURIComponent(encodedName).replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120); }
  catch { name = "attachment"; }
  const id = crypto.randomUUID();
  const metadata = { id, name: name || "attachment", type, size: buffer.length, conversation, uploaderId: user.id };
  try {
    await writeFile(path.join(uploadDirectory, id), buffer, supabaseStore.enabled ? type : undefined);
    const operation = uploadQueue.then(async () => {
      const next = { ...uploads, [id]: metadata };
      await writeFile(uploadsFile, JSON.stringify(next), "utf8");
      uploads = next;
    });
    uploadQueue = operation.catch((error) => console.error("Could not save upload metadata:", error));
    await operation;
    res.json({ id, name: metadata.name, type, size: metadata.size });
  } catch (error) {
    console.error("Could not save uploaded file:", error);
    res.status(500).json({ error: "Could not save the uploaded file." });
  }
});
app.get("/api/uploads/:id", async (req, res) => {
  const user = await getSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to view this attachment." });
  const file = uploads[req.params.id];
  if (!file || !canAccessConversation(file.conversation, user.id)) return res.sendStatus(404);
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Disposition", `${file.type.startsWith("image/") || file.type.startsWith("audio/") || file.type === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  try {
    res.type(file.type).send(await readFile(path.join(uploadDirectory, file.id)));
  } catch (error) {
    console.error("Could not read uploaded file:", error);
    res.status(500).json({ error: "Could not load this attachment." });
  }
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
  try { ticTacToeGames = JSON.parse(await readFile(ticTacToeFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  try { partyGames = JSON.parse(await readFile(partyGamesFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

function persistTicTacToeGames() {
  const write = ticTacToeQueue.then(() => writeFile(ticTacToeFile, JSON.stringify(ticTacToeGames), "utf8"));
  ticTacToeQueue = write.catch((error) => console.error("Could not save Tic Tac Toe scores:", error));
  return write;
}

function emitTicTacToeGame(game) {
  game.players.forEach((userId) => io.to(`user:${userId}`).emit("tic-tac-toe state", game));
}

function savePartyGames() {
  const write = partyGamesQueue.then(() => writeFile(partyGamesFile, JSON.stringify(partyGames), "utf8"));
  partyGamesQueue = write.catch((error) => console.error("Could not save party games:", error));
  return write;
}
function emitPartyGame(game) {
  game.players.forEach((userId) => io.to(`user:${userId}`).emit("party game state", game));
}
function partyGameKey(conversation, type) { return `${conversation}|${type}`; }
function initialChessBoard() {
  return ["bR","bN","bB","bQ","bK","bB","bN","bR", ...Array(8).fill("bP"), ...Array(32).fill(null), ...Array(8).fill("wP"), "wR","wN","wB","wQ","wK","wB","wN","wR"];
}
function startPartyGame(game) {
  game.status = "playing";
  game.winner = null;
  game.turn = game.players[0];
  if (game.type === "snakes-ladders") { game.positions = [0, 0]; game.dice = null; }
  if (game.type === "ludo") { game.tokens = [Array(4).fill(-1), Array(4).fill(-1)]; game.dice = null; game.startOffsets = [0, 26]; }
  if (game.type === "chess") { game.board = initialChessBoard(); game.enPassant = null; }
  if (game.type === "snake-arena") {
    game.snakes = [[[3,7],[2,7],[1,7]], [[11,7],[12,7],[13,7]]];
    game.directions = [[1,0],[-1,0]];
    game.nextDirections = [[1,0],[-1,0]];
    game.food = [7,7]; game.lengthScores = [0, 0];
  }
}
function chessMoves(board, from) {
  const piece = board[from];
  if (!piece) return [];
  const color = piece[0], kind = piece[1], row = Math.floor(from / 8), col = from % 8;
  const moves = [];
  const add = (r, c) => {
    if (r < 0 || r > 7 || c < 0 || c > 7) return false;
    const target = board[r * 8 + c];
    if (target && target[0] === color) return false;
    moves.push(r * 8 + c);
    return !target;
  };
  if (kind === "P") {
    const step = color === "w" ? -1 : 1;
    const next = row + step;
    if (next >= 0 && next < 8 && !board[next * 8 + col]) {
      moves.push(next * 8 + col);
      const home = color === "w" ? 6 : 1;
      if (row === home && !board[(row + 2 * step) * 8 + col]) moves.push((row + 2 * step) * 8 + col);
    }
    for (const dc of [-1, 1]) if (next >= 0 && next < 8 && col + dc >= 0 && col + dc < 8 && board[next * 8 + col + dc]?.[0] === (color === "w" ? "b" : "w")) moves.push(next * 8 + col + dc);
    return moves;
  }
  if (kind === "N") {
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) add(row + dr, col + dc);
    return moves;
  }
  const directions = [];
  if (kind === "B" || kind === "Q") directions.push([-1,-1],[-1,1],[1,-1],[1,1]);
  if (kind === "R" || kind === "Q") directions.push([-1,0],[1,0],[0,-1],[0,1]);
  if (kind === "K") {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dr || dc) add(row + dr, col + dc);
    return moves;
  }
  for (const [dr, dc] of directions) for (let distance = 1; distance < 8; distance++) if (!add(row + dr * distance, col + dc * distance)) break;
  return moves;
}
function chessInCheck(board, color) {
  const king = board.findIndex((piece) => piece === `${color}K`);
  if (king < 0) return true;
  const row = Math.floor(king / 8), col = king % 8, enemy = color === "w" ? "b" : "w";
  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (!piece || piece[0] !== enemy) continue;
    if (piece[1] === "P") {
      const direction = enemy === "w" ? -1 : 1;
      if (Math.floor(from / 8) + direction === row && Math.abs(from % 8 - col) === 1) return true;
    } else if (chessMoves(board, from).includes(king)) return true;
  }
  return false;
}
function legalChessMoves(board, from) {
  const piece = board[from];
  if (!piece) return [];
  return chessMoves(board, from).filter((to) => {
    if (board[to]?.[1] === "K") return false;
    const next = board.slice(); next[to] = piece; next[from] = null;
    if (piece[1] === "P" && (to < 8 || to >= 56)) next[to] = `${piece[0]}Q`;
    return !chessInCheck(next, piece[0]);
  });
}
function finishPartyGame(game, winnerId) {
  game.status = "finished";
  game.winner = winnerId;
  game.turn = null;
  game.players.forEach((id) => game.scores[id] ||= { wins: 0, losses: 0, draws: 0 });
  if (winnerId) {
    game.scores[winnerId].wins++;
    game.scores[game.players.find((id) => id !== winnerId)].losses++;
  } else game.players.forEach((id) => game.scores[id].draws++);
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
    messages: messages.filter((message) => message.conversation === conversation).map((message) => ({ ...message, reactionNames: reactionNamesFor(message.reactions) })),
    pinned: conversationPins(conversation)
  });
}

async function askOpenAI(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openAiApiKey}` },
      body: JSON.stringify({
        model: openAiModel,
        instructions: "You are Aura, a friendly study helper in Chatly. Explain clearly and briefly, show steps for difficult topics, and say when you are unsure.",
        input: prompt,
        store: false
      }),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error?.message || "OpenAI request failed.");
      error.code = data.error?.code || data.error?.type;
      error.status = response.status;
      throw error;
    }
    const answer = (data.output || []).flatMap((item) => item.content || []).filter((part) => part.type === "output_text").map((part) => part.text).join("\n").trim();
    if (!answer) throw new Error("Aura did not return an answer.");
    return answer.slice(0, 8000);
  } finally { clearTimeout(timeout); }
}

async function askGemini(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: "You are Aura, a friendly study helper in Chatly. Explain clearly and briefly, show steps for difficult topics, and say when you are unsure." }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1200 }
      }),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error?.message || "Gemini request failed.");
      error.code = data.error?.status || data.error?.code;
      error.status = response.status;
      throw error;
    }
    const answer = (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("\n").trim();
    if (!answer) throw new Error("Aura did not return an answer.");
    return answer.slice(0, 8000);
  } finally { clearTimeout(timeout); }
}

async function askAura(prompt) {
  if (geminiApiKey) return askGemini(prompt);
  if (openAiApiKey) return askOpenAI(prompt);
  throw new Error("Aura needs a GEMINI_API_KEY or OPENAI_API_KEY in the server .env file.");
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
    socket.emit("tic-tac-toe state", ticTacToeGames[conversation] || null);
  });

  socket.on("tic-tac-toe get state", () => {
    const conversation = socket.data.activeConversation;
    if (!isDirectConversationFor(conversation, socket.data.userId)) return;
    socket.emit("tic-tac-toe state", ticTacToeGames[conversation] || null);
  });

  socket.on("tic-tac-toe invite", async (acknowledge) => {
    const respond = (result) => { if (typeof acknowledge === "function") acknowledge(result); };
    const conversation = socket.data.activeConversation;
    if (!isDirectConversationFor(conversation, socket.data.userId)) {
      respond({ ok: false, error: "Open a direct chat with your friend before inviting them." });
      return;
    }
    const peerId = conversation.split(":").slice(1).find((id) => id !== socket.data.userId);
    if (!peerId || !usernameByUser.has(peerId)) {
      respond({ ok: false, error: "That friend is no longer available." });
      return;
    }
    const previous = ticTacToeGames[conversation];
    if (previous?.status === "playing" || previous?.status === "pending") {
      socket.emit("tic-tac-toe state", previous);
      respond({ ok: true });
      return;
    }
    const scores = previous?.scores || {};
    for (const id of [socket.data.userId, peerId]) scores[id] ||= { wins: 0, losses: 0, draws: 0 };
    const game = {
      conversation, players: [socket.data.userId, peerId], invitedBy: socket.data.userId,
      board: Array(9).fill(null), turn: null, status: "pending", winner: null, scores
    };
    ticTacToeGames[conversation] = game;
    try {
      await persistTicTacToeGames();
      emitTicTacToeGame(game);
      respond({ ok: true });
    } catch {
      socket.emit("message error", "Could not save the game invitation. Please try again.");
      respond({ ok: false, error: "Could not save the game invitation. Please try again." });
    }
  });

  socket.on("tic-tac-toe accept", async () => {
    const conversation = socket.data.activeConversation;
    const game = ticTacToeGames[conversation];
    if (!game || game.status !== "pending" || game.invitedBy === socket.data.userId || !game.players.includes(socket.data.userId)) return;
    game.status = "playing";
    game.board = Array(9).fill(null);
    game.turn = game.invitedBy;
    game.winner = null;
    try { await persistTicTacToeGames(); emitTicTacToeGame(game); }
    catch { socket.emit("message error", "Could not start the game. Please try again."); }
  });

  socket.on("tic-tac-toe decline", async () => {
    const conversation = socket.data.activeConversation;
    const game = ticTacToeGames[conversation];
    if (!game || game.status !== "pending" || game.invitedBy === socket.data.userId || !game.players.includes(socket.data.userId)) return;
    game.status = "declined";
    game.turn = null;
    try { await persistTicTacToeGames(); emitTicTacToeGame(game); }
    catch { socket.emit("message error", "Could not update the game invitation."); }
  });

  socket.on("tic-tac-toe move", async (index) => {
    const conversation = socket.data.activeConversation;
    const game = ticTacToeGames[conversation];
    if (!game || game.status !== "playing" || game.turn !== socket.data.userId || !game.players.includes(socket.data.userId) || !Number.isInteger(index) || index < 0 || index > 8 || game.board[index] !== null) return;
    game.board[index] = socket.data.userId;
    const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    const won = wins.some((line) => line.every((cell) => game.board[cell] === socket.data.userId));
    if (won || game.board.every(Boolean)) {
      game.status = "finished";
      game.winner = won ? socket.data.userId : null;
      for (const id of game.players) game.scores[id] ||= { wins: 0, losses: 0, draws: 0 };
      if (won) {
        game.scores[socket.data.userId].wins++;
        game.scores[game.players.find((id) => id !== socket.data.userId)].losses++;
      } else game.players.forEach((id) => game.scores[id].draws++);
      game.turn = null;
    } else game.turn = game.players.find((id) => id !== socket.data.userId);
    try { await persistTicTacToeGames(); emitTicTacToeGame(game); }
    catch { socket.emit("message error", "Could not save the game score. Please try again."); }
  });

  socket.on("party-game get", (type) => {
    const conversation = socket.data.activeConversation;
    if (!isDirectConversationFor(conversation, socket.data.userId) || !["snakes-ladders", "ludo", "chess", "snake-arena"].includes(type)) return;
    const game = partyGames[partyGameKey(conversation, type)];
    socket.emit("party game state", game || { conversation, type, players: [socket.data.userId], status: "idle", scores: {} });
  });
  socket.on("party-game invite", async (type, acknowledge) => {
    const respond = (result) => { if (typeof acknowledge === "function") acknowledge(result); };
    const conversation = socket.data.activeConversation;
    const allowed = new Set(["snakes-ladders", "ludo", "chess", "snake-arena"]);
    if (!allowed.has(type)) {
      respond({ ok: false, error: "Choose a valid game and try again." });
      return;
    }
    if (!isDirectConversationFor(conversation, socket.data.userId)) {
      respond({ ok: false, error: "Open a direct chat with your friend before inviting them." });
      return;
    }
    const peerId = conversation.split(":").slice(1).find((id) => id !== socket.data.userId);
    if (!peerId || !usernameByUser.has(peerId)) {
      respond({ ok: false, error: "That friend is no longer available." });
      return;
    }
    const key = partyGameKey(conversation, type);
    const previous = partyGames[key];
    if (previous?.status === "pending" || previous?.status === "playing") {
      socket.emit("party game state", previous);
      respond({ ok: true });
      return;
    }
    const scores = previous?.scores || {};
    for (const id of [socket.data.userId, peerId]) scores[id] ||= { wins: 0, losses: 0, draws: 0 };
    const game = { conversation, type, players: [socket.data.userId, peerId], invitedBy: socket.data.userId, status: "pending", scores };
    partyGames[key] = game;
    try {
      await savePartyGames();
      emitPartyGame(game);
      respond({ ok: true });
    } catch {
      socket.emit("message error", "Could not save the game invite. Please try again.");
      respond({ ok: false, error: "Could not save the game invite. Please try again." });
    }
  });
  socket.on("party-game accept", async (type) => {
    const game = partyGames[partyGameKey(socket.data.activeConversation, type)];
    if (!game || game.status !== "pending" || game.invitedBy === socket.data.userId || !game.players.includes(socket.data.userId)) return;
    startPartyGame(game);
    try { await savePartyGames(); emitPartyGame(game); }
    catch { socket.emit("message error", "Could not start the game. Please try again."); }
  });
  socket.on("party-game decline", async (type) => {
    const game = partyGames[partyGameKey(socket.data.activeConversation, type)];
    if (!game || game.status !== "pending" || game.invitedBy === socket.data.userId || !game.players.includes(socket.data.userId)) return;
    game.status = "declined";
    try { await savePartyGames(); emitPartyGame(game); }
    catch { socket.emit("message error", "Could not update the game invite."); }
  });
  socket.on("party-game direction", ({ dx, dy } = {}) => {
    const game = partyGames[partyGameKey(socket.data.activeConversation, "snake-arena")];
    if (!game || game.type !== "snake-arena" || game.status !== "playing") return;
    const playerIndex = game.players.indexOf(socket.data.userId);
    if (playerIndex < 0 || ![[0,-1],[0,1],[-1,0],[1,0]].some(([x,y]) => x === dx && y === dy)) return;
    const [oldX, oldY] = game.directions[playerIndex];
    if (dx === -oldX && dy === -oldY) return;
    game.nextDirections[playerIndex] = [dx, dy];
  });
  socket.on("party-game legal", ({ from } = {}) => {
    const game = partyGames[partyGameKey(socket.data.activeConversation, "chess")];
    if (!game || game.type !== "chess" || game.status !== "playing" || game.turn !== socket.data.userId || !Number.isInteger(from) || from < 0 || from >= 64) return;
    const color = game.players[0] === socket.data.userId ? "w" : "b";
    if (game.board[from]?.[0] !== color) return;
    socket.emit("party-game legal", { conversation: game.conversation, from, moves: legalChessMoves(game.board, from) });
  });
  socket.on("party-game action", async ({ type, action, from, to, token } = {}) => {
    if (!["snakes-ladders", "ludo", "chess"].includes(type)) return;
    const game = partyGames[partyGameKey(socket.data.activeConversation, type)];
    if (!game || game.status !== "playing" || game.turn !== socket.data.userId || !game.players.includes(socket.data.userId)) return;
    const playerIndex = game.players.indexOf(socket.data.userId);
    if (game.type === "snakes-ladders" && action === "roll") {
      const roll = crypto.randomInt(1, 7);
      const next = game.positions[playerIndex] + roll;
      if (next <= 100) game.positions[playerIndex] = ({4:14,9:31,20:38,28:84,40:59,51:67,63:81,71:91,17:7,54:34,62:19,64:60,87:24,93:73,95:75,99:78})[next] || next;
      if (game.positions[playerIndex] === 100) finishPartyGame(game, socket.data.userId);
      else game.turn = game.players[1 - playerIndex];
    } else if (game.type === "ludo" && action === "roll" && game.dice == null) {
      game.dice = crypto.randomInt(1, 7);
      const roll = game.dice;
      const tokens = game.tokens[playerIndex];
      if (!tokens.some((position) => position < 0 ? roll === 6 : position + roll <= 57) && roll !== 6) { game.dice = null; game.turn = game.players[1 - playerIndex]; }
    } else if (game.type === "ludo" && action === "move-token" && game.dice != null && Number.isInteger(token) && token >= 0 && token < 4) {
      const roll = game.dice, old = game.tokens[playerIndex][token];
      if (old < 0 ? roll !== 6 : old + roll > 57) return;
      const next = old < 0 ? 0 : old + roll;
      game.tokens[playerIndex][token] = next;
      if (next < 52) {
        const track = (next + game.startOffsets[playerIndex]) % 52;
        const safe = new Set([0,8,13,21,26,34,39,47]);
        if (!safe.has(track)) game.tokens[1 - playerIndex] = game.tokens[1 - playerIndex].map((position) => position >= 0 && position < 52 && (position + game.startOffsets[1 - playerIndex]) % 52 === track ? -1 : position);
      }
      if (game.tokens[playerIndex].every((position) => position === 57)) finishPartyGame(game, socket.data.userId);
      else { game.dice = null; if (roll !== 6) game.turn = game.players[1 - playerIndex]; }
    } else if (game.type === "chess" && action === "move" && Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from < 64 && to >= 0 && to < 64) {
      const piece = game.board[from], color = playerIndex === 0 ? "w" : "b";
      if (!piece || piece[0] !== color || !legalChessMoves(game.board, from).includes(to)) return;
      game.board[to] = piece[1] === "P" && (to < 8 || to >= 56) ? `${color}Q` : piece;
      game.board[from] = null;
      const nextColor = color === "w" ? "b" : "w";
      const hasMoves = game.board.some((candidate, square) => candidate?.[0] === nextColor && legalChessMoves(game.board, square).length > 0);
      if (!hasMoves) finishPartyGame(game, chessInCheck(game.board, nextColor) ? socket.data.userId : null);
      else game.turn = game.players[1 - playerIndex];
    } else return;
    try { await savePartyGames(); emitPartyGame(game); }
    catch { socket.emit("message error", "Could not save this game move."); }
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
        await supabaseStore.deleteMessage(messageId);
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
    if (!initial || initial.deleted || initial.conversation !== conversation || initial.senderId === socket.data.userId || (!initial.senderId && initial.user === socket.data.username) || !canAccessConversation(conversation, socket.data.userId)) return;
    const operation = reactionQueue.then(async () => {
      const message = messages.find((item) => item.id === messageId);
      if (!message || message.deleted || message.conversation !== socket.data.activeConversation || message.senderId === socket.data.userId || (!message.senderId && message.user === socket.data.username) || !canAccessConversation(message.conversation, socket.data.userId)) return;
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
      io.to(conversation).emit("message reactions", { id: messageId, conversation, reactions: nextMessageReactions, reactionNames: reactionNamesFor(nextMessageReactions) });
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
    if (!openAiApiKey && !geminiApiKey) return socket.emit("message error", "Aura needs a GEMINI_API_KEY or OPENAI_API_KEY in the server .env file.");
    const lastRequest = auraLastRequestByUser.get(socket.data.userId) || 0;
    if (Date.now() - lastRequest < 4000) return socket.emit("message error", "Give Aura a moment before asking another question.");
    auraLastRequestByUser.set(socket.data.userId, Date.now());
    try {
      const answer = await askAura(prompt);
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
      console.error(`Aura ${geminiApiKey ? "Gemini" : "OpenAI"} request failed:`, error.code || error.name, error.message);
      const message = error.name === "AbortError" ? "Aura took too long to answer. Try again."
        : geminiApiKey && error.status === 429 ? "Aura has reached Gemini's free usage limit. Wait a while and try again, or set OPENAI_API_KEY and add API credits."
        : geminiApiKey && error.status === 403 ? "Gemini API access was denied. Check that your API key and project are enabled for the Gemini API."
        : ["insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached"].includes(error.code) ? "Aura needs OpenAI API credits. Add billing or credits to your OpenAI API account, then try again."
        : error.status === 401 ? "Aura's OpenAI API key was rejected. Check OPENAI_API_KEY in the server .env file."
        : error.status === 429 ? "Aura is being rate limited by OpenAI. Wait a moment and try again."
        : "Aura could not answer right now.";
      socket.emit("message error", message);
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

const snakeArenaTimer = setInterval(() => {
  for (const game of Object.values(partyGames)) {
    if (game.type !== "snake-arena" || game.status !== "playing") continue;
    const heads = game.snakes.map((snake, index) => [snake[0][0] + game.nextDirections[index][0], snake[0][1] + game.nextDirections[index][1]]);
    const eating = heads.map(([x, y]) => x === game.food[0] && y === game.food[1]);
    const dead = heads.map(([x, y], index) => x < 0 || x >= 15 || y < 0 || y >= 15 || game.snakes[index].slice(0, eating[index] ? undefined : -1).some(([sx, sy]) => sx === x && sy === y) || game.snakes[1 - index].some(([sx, sy]) => sx === x && sy === y));
    if ((heads[0][0] === heads[1][0] && heads[0][1] === heads[1][1]) || (heads[0][0] === game.snakes[1][0][0] && heads[0][1] === game.snakes[1][0][1] && heads[1][0] === game.snakes[0][0][0] && heads[1][1] === game.snakes[0][0][1])) dead[0] = dead[1] = true;
    if (dead[0] || dead[1]) {
      finishPartyGame(game, dead[0] === dead[1] ? null : game.players[dead[0] ? 1 : 0]);
      savePartyGames().catch((error) => console.error("Could not save Snake Arena game:", error));
      emitPartyGame(game);
      continue;
    }
    game.directions = game.nextDirections.map((direction) => direction.slice());
    game.snakes.forEach((snake, index) => { snake.unshift(heads[index]); if (!eating[index]) snake.pop(); else game.lengthScores[index]++; });
    if (eating.some(Boolean)) {
      const occupied = new Set(game.snakes.flat().map(([x, y]) => `${x},${y}`));
      const available = [];
      for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) if (!occupied.has(`${x},${y}`)) available.push([x,y]);
      game.food = available.length ? available[crypto.randomInt(available.length)] : [7,7];
    }
    emitPartyGame(game);
  }
}, 180);
snakeArenaTimer.unref();

const PORT = process.env.PORT || 3000;

async function startServer() {
  if (process.env.NODE_ENV === "production" && (!supabaseStore.enabled || !supabaseUrl || !supabaseAnonKey)) {
    throw new Error("Production requires SUPABASE_URL, SUPABASE_ANON_KEY, and server-only SUPABASE_SERVICE_ROLE_KEY.");
  }
  await initializeStorage();
  server.listen(PORT, () => {
    console.log("Chatly running at http://localhost:" + PORT);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Unable to start Chatly:", error);
    process.exitCode = 1;
  });
}

module.exports = app;
