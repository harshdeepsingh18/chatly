const express = require("express");
const http = require("http");
const path = require("node:path");
const { appendFile, mkdir, readFile } = require("node:fs/promises");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const dataDirectory = path.join(__dirname, "data");
const messageFile = path.join(dataDirectory, "messages.jsonl");

// Serve index.html, style.css and script.js from the "public" folder
app.use(express.static("public"));

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
    if (error.code === "ENOENT") return;
    throw error;
  }

  messages = contents.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid saved message in ${messageFile} on line ${index + 1}: ${error.message}`);
    }
  });
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
  socket.on("user joined", (name) => {
    name = String(name || "").trim().slice(0, 20);
    if (!name) return;

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