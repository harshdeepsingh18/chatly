// Connects to the Socket.IO server that serves this page
const socket = io();
let username = "";

// ----- Grab page elements -----
const $ = (id) => document.getElementById(id);
const loginScreen = $("login");
const chatScreen = $("chat");
const messagesBox = $("messages");
const input = $("message-input");
const typingBox = $("typing");
const sidebar = $("sidebar");
const emojiPanel = $("emoji-panel");

// ----- 1. Login -----
$("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  username = $("username").value.trim();
  if (!username) return;

  socket.emit("user joined", username);   // tell the server who joined
  $("me").textContent = "You are " + username;
  loginScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");
  input.focus();
});

// ----- 2. Sending messages -----
$("message-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  socket.emit("chat message", { user: username, text: text, time: Date.now() });
  socket.emit("typing", false);
  input.value = "";
  emojiPanel.classList.add("hidden");
});

// ----- 3. Showing messages -----
function addMessage({ user, text, time }) {
  const box = document.createElement("div");
  box.className = "msg" + (user === username ? " mine" : "");

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = user;

  const body = document.createElement("span");
  body.textContent = text;            // textContent keeps user input safe from HTML injection

  const stamp = document.createElement("span");
  stamp.className = "time";
  stamp.textContent = new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  box.append(name, body, stamp);
  messagesBox.appendChild(box);
  messagesBox.scrollTop = messagesBox.scrollHeight;   // auto-scroll to newest
}

function addSystemMessage(text) {
  const line = document.createElement("div");
  line.className = "system";
  line.textContent = text;
  messagesBox.appendChild(line);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

socket.on("chat message", addMessage);
socket.on("system message", addSystemMessage);

// ----- 4. Typing indicator -----
let typingTimer;
input.addEventListener("input", () => {
  socket.emit("typing", true);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.emit("typing", false), 1500);
});

// Server sends: { user: "Rahul", isTyping: true }
const typers = new Set();
socket.on("typing", ({ user, isTyping }) => {
  if (user === username) return;
  isTyping ? typers.add(user) : typers.delete(user);
  const names = [...typers];
  typingBox.textContent = names.length
    ? names.join(", ") + (names.length > 1 ? " are" : " is") + " typing..."
    : "";
});

// ----- 5. Online users -----
// Server sends an array of names: ["Rahul", "Aman"]
socket.on("user list", (users) => {
  $("online-count").textContent = users.length;
  const list = $("user-list");
  list.innerHTML = "";
  users.forEach((name) => {
    const li = document.createElement("li");
    li.textContent = name;
    list.appendChild(li);
  });
});

$("menu-btn").addEventListener("click", () => sidebar.classList.toggle("open"));
messagesBox.addEventListener("click", () => sidebar.classList.remove("open"));

// ----- 6. Emoji picker -----
["😀", "😂", "😍", "😎", "🥳", "😢", "👍", "🙏", "🔥", "❤️", "🎉", "👋"].forEach((emoji) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = emoji;
  b.addEventListener("click", () => { input.value += emoji; input.focus(); });
  emojiPanel.appendChild(b);
});
$("emoji-btn").addEventListener("click", () => emojiPanel.classList.toggle("hidden"));

// ----- 7. Light / dark mode (remembered in the browser) -----
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("theme-btn").textContent = theme === "dark" ? "☀️" : "🌙";
  try { localStorage.setItem("theme", theme); } catch (e) {}
}
let saved = "light";
try { saved = localStorage.getItem("theme") || saved; } catch (e) {}
setTheme(saved);
$("theme-btn").addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});
