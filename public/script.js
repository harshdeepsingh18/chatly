// Connects to the Socket.IO server that serves this page
const socket = io();
let username = "";
let authToken = "";
let savedItems = [];
let showSavedOnly = false;
let supabaseClient = window.CHATLY_SUPABASE_URL && window.CHATLY_SUPABASE_ANON_KEY && window.supabase?.createClient
  ? window.supabase.createClient(window.CHATLY_SUPABASE_URL, window.CHATLY_SUPABASE_ANON_KEY)
  : null;

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
  const message = { user, text, time };
  const key = messageKey(message);
  if (showSavedOnly && !savedItems.some((item) => messageKey(item) === key)) return;
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
  const save = document.createElement("button");
  save.type = "button";
  save.className = "save-message";
  const isSaved = savedItems.some((item) => messageKey(item) === key);
  save.textContent = isSaved ? "★ Saved" : "☆ Save";
  save.setAttribute("aria-label", isSaved ? "Remove saved message" : "Save message");
  save.addEventListener("click", async () => {
    if (!authToken) { addSystemMessage("Sign in with Google to save messages."); return; }
    save.disabled = true;
    try {
      const response = await fetch("/api/saved-messages", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ message, saved: !isSaved }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update saved messages.");
      savedItems = result.saved;
      renderMessages();
    } catch (error) { addSystemMessage(error.message); }
  });
  box.append(save);
  messagesBox.appendChild(box);
  messagesBox.scrollTop = messagesBox.scrollHeight;   // auto-scroll to newest
}

function messageKey(message) { return `${message.user}\n${message.time}\n${message.text}`; }
function renderMessages() {
  messagesBox.replaceChildren();
  const visible = showSavedOnly ? savedItems : allMessages;
  visible.forEach((message) => addMessage(message));
}
let allMessages = [];
function loadSavedMessages() {
  return fetch("/api/saved-messages", { headers: { Authorization: `Bearer ${authToken}` } }).then(async (response) => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load saved messages.");
    savedItems = result;
    renderMessages();
  });
}

function addSystemMessage(text) {
  const line = document.createElement("div");
  line.className = "system";
  line.textContent = text;
  messagesBox.appendChild(line);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

socket.on("chat message", (message) => { allMessages.push(message); addMessage(message); });
socket.on("chat history", (messages) => { allMessages = messages; renderMessages(); });
socket.on("system message", addSystemMessage);
socket.on("message error", addSystemMessage);

$("saved-btn").addEventListener("click", () => {
  showSavedOnly = !showSavedOnly;
  $("saved-btn").setAttribute("aria-pressed", String(showSavedOnly));
  $("saved-btn").textContent = showSavedOnly ? "← All messages" : "☆ Saved";
  renderMessages();
});

async function handleGoogleCredential(response) {
  const status = $("auth-status");
  status.textContent = "Signing in…";
  try {
    const result = await fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: response.credential }) });
    const data = await result.json();
    if (!result.ok) throw new Error(data.error || "Google sign-in failed.");
    authToken = data.token;
    $("username").value = data.user.name;
    status.textContent = `Signed in as ${data.user.email}`;
    await loadSavedMessages();
    $("login-form").requestSubmit();
  } catch (error) { status.textContent = error.message; }
}
let googleSignInInitialized = false;
function initializeGoogleSignIn() {
  if (googleSignInInitialized) return;
  const fallback = $("google-fallback");
  if (!window.CHATLY_GOOGLE_CLIENT_ID) {
    $("auth-status").textContent = "Google sign-in needs GOOGLE_CLIENT_ID set on the server.";
    return;
  }
  if (!window.google?.accounts?.id) {
    $("auth-status").textContent = "Loading Google sign-in…";
    return;
  }
  window.google.accounts.id.initialize({ client_id: window.CHATLY_GOOGLE_CLIENT_ID, callback: handleGoogleCredential });
  fallback?.remove();
  window.google.accounts.id.renderButton($("google-signin"), { theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width: 300 });
  googleSignInInitialized = true;
}
window.addEventListener("load", initializeGoogleSignIn);
const googleInitTimer = setInterval(() => {
  initializeGoogleSignIn();
  if (!$("google-fallback") || !window.CHATLY_GOOGLE_CLIENT_ID) clearInterval(googleInitTimer);
}, 300);
$("google-fallback").addEventListener("click", () => {
  $("auth-status").textContent = window.CHATLY_GOOGLE_CLIENT_ID
    ? "Google sign-in is still loading. Check your connection and refresh the page."
    : "To enable Google sign-in, set GOOGLE_CLIENT_ID in the server environment and restart Chatly. See README.md.";
});
let resumedSupabaseSession = false;
async function resumeSupabaseSession() {
  if (!supabaseClient || resumedSupabaseSession) return;
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session || resumedSupabaseSession) return;
  resumedSupabaseSession = true;
  authToken = data.session.access_token;
  const user = data.session.user;
  $("username").value = String(user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Chatly user").slice(0, 20);
  $("auth-status").textContent = `Signed in as ${user.email}`;
  try { await loadSavedMessages(); } catch (error) { $("auth-status").textContent = error.message; }
  $("login-form").requestSubmit();
}
$("google-fallback").addEventListener("click", async () => {
  if (!supabaseClient) {
    $("auth-status").textContent = "Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY on the server.";
    return;
  }
  $("auth-status").textContent = "Redirecting to Google…";
  const { error } = await supabaseClient.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  if (error) $("auth-status").textContent = error.message;
});
if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    authToken = session?.access_token || "";
    if (session) resumeSupabaseSession();
  });
  resumeSupabaseSession();
} else {
  $("auth-status").textContent = "Connect Supabase and enable Google in its Auth settings to sign in.";
}

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
