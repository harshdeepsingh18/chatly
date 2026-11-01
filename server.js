const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve index.html, style.css and script.js from the "public" folder
app.use(express.static("public"));

// socket.id -> username (everyone who is online right now)
const users = new Map();

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
  });

  // 2. Someone sends a message -> broadcast to everyone (including the sender)
  socket.on("chat message", (msg) => {
    const user = users.get(socket.id);
    const text = String((msg && msg.text) || "").trim().slice(0, 1000);
    if (!user || !text) return;

    io.emit("chat message", { user, text, time: Date.now() });
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
server.listen(PORT, () => {
  console.log("Chatly running at http://localhost:" + PORT);
});