// Connects to the Socket.IO server that serves this page
const socket = io({ autoConnect: false });
let username = "";
let currentUserId = "";
let authToken = "";
let savedItems = [];
let showSavedOnly = false;
let currentConversation = "general";
let currentDirectUser = null;
let pinnedItems = [];
let unreadCount = 0;
const titleBase = "Chatly";
const attachmentUrls = new Map();
let selectedFile = null;
let activeCall = null;
let peerConnection = null;
let localCallStream = null;
let remoteCallStream = null;
let queuedIceCandidates = [];
let callTimeout = null;
let supabaseClient = window.CHATLY_SUPABASE_URL && window.CHATLY_SUPABASE_ANON_KEY && window.supabase?.createClient
  ? window.supabase.createClient(window.CHATLY_SUPABASE_URL, window.CHATLY_SUPABASE_ANON_KEY)
  : null;

// ----- Grab page elements -----
const $ = (id) => document.getElementById(id);
const loginScreen = $("login");
const usernameScreen = $("username-screen");
const chatScreen = $("chat");
const messagesBox = $("messages");
const input = $("message-input");
const typingBox = $("typing");
const sidebar = $("sidebar");
const emojiPanel = $("emoji-panel");

// ----- 1. Authenticated entry -----
socket.on("connect", () => {
  socket.emit("user joined");
  socket.emit("join room", currentConversation);
  $("me").textContent = "You are " + username;
  loginScreen.classList.add("hidden");
  usernameScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");
  input.focus();
});
socket.on("connect_error", (error) => {
  loginScreen.classList.add("hidden");
  usernameScreen.classList.remove("hidden");
  chatScreen.classList.add("hidden");
  $("username-submit").disabled = false;
  $("username-status").textContent = error.message || "Could not join Chatly. Please try again.";
});

// ----- 2. Sending messages -----
$("message-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  const file = selectedFile;
  if (!text && !file) return;
  $("send-btn").disabled = true;
  try {
    let attachment;
    if (file) {
      if (file.size > 12 * 1024 * 1024) throw new Error("Files must be 12 MB or smaller.");
      const response = await fetch("/api/uploads", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "Authorization": `Bearer ${authToken}`,
          "X-Chat-Conversation": currentConversation,
          "X-File-Name": encodeURIComponent(file.name),
          "X-File-Type": file.type || "application/octet-stream"
        },
        body: file
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not upload this file.");
      attachment = result;
    }
    socket.emit("chat message", { text, attachment });
    const auraMatch = text.match(/^@aura\s+([\s\S]+)/i);
    if (auraMatch) socket.emit("aura request", auraMatch[1]);
    input.value = "";
    selectedFile = null;
    $("file-input").value = "";
    $("file-btn").textContent = "+";
    $("file-btn").title = "Attach a file";
  } catch (error) { addSystemMessage(error.message); }
  finally { $("send-btn").disabled = false; }
  socket.emit("typing", false);
  emojiPanel.classList.add("hidden");
});

// ----- 3. Showing messages -----
function addMessage({ id, conversation, user, text, time, avatar, attachment }) {
  const message = { id, conversation, user, text, time, avatar, attachment };
  const key = messageKey(message);
  if (showSavedOnly && !savedItems.some((item) => messageKey(item) === key)) return;
  const box = document.createElement("div");
  box.className = "msg" + (user === username ? " mine" : "");
  if (id) box.dataset.messageId = id;

  const name = document.createElement("div");
  name.className = "name";
  name.append(createAvatar(user, avatar, "avatar message-avatar"));
  const usernameLabel = document.createElement("span");
  usernameLabel.textContent = user;
  name.append(usernameLabel);

  const body = document.createElement("span");
  body.textContent = text;            // textContent keeps user input safe from HTML injection

  const stamp = document.createElement("span");
  stamp.className = "time";
  stamp.textContent = new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  box.append(name);
  if (text) box.append(body);
  if (attachment) {
    const file = document.createElement("div");
    file.className = "message-attachment";
    box.append(file);
    showAttachment(attachment, file);
  }
  box.append(stamp);
  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = "pin-message";
  pin.textContent = pinnedItems.some((item) => item.id === id) ? "📌 Pinned" : "📌 Pin";
  pin.addEventListener("click", () => socket.emit("pin message", id));
  box.append(pin);
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
  const query = $("search-input").value.trim().toLocaleLowerCase();
  const visible = (showSavedOnly ? savedItems : allMessages).filter((message) => !query || `${message.user} ${message.text} ${message.attachment?.name || ""}`.toLocaleLowerCase().includes(query));
  visible.forEach((message) => addMessage(message));
}

async function showAttachment(attachment, container) {
  try {
    let url = attachmentUrls.get(attachment.id);
    if (!url) {
      const response = await fetch(`/api/uploads/${encodeURIComponent(attachment.id)}`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) throw new Error("Attachment unavailable");
      url = URL.createObjectURL(await response.blob());
      attachmentUrls.set(attachment.id, url);
    }
    if (attachment.type?.startsWith("image/")) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = attachment.name;
      image.className = "attachment-image";
      container.append(image);
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = `${attachment.name} (${Math.ceil(attachment.size / 1024)} KB)`;
      container.append(link);
    }
  } catch { container.textContent = `${attachment.name} — unavailable`; }
}

function renderPinnedMessages() {
  const box = $("pinned-messages");
  box.replaceChildren();
  box.classList.toggle("hidden", pinnedItems.length === 0);
  pinnedItems.forEach((message) => {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = `📌 ${message.user}: ${message.text || message.attachment?.name || "Attachment"}`;
    item.addEventListener("click", () => document.querySelector(`[data-message-id="${message.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    box.append(item);
  });
}

function updateTabTitle() { document.title = unreadCount ? `(${unreadCount}) ${titleBase}` : titleBase; }
function incrementUnread(label) {
  unreadCount += 1;
  updateTabTitle();
  playMessageSound();
  if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
    try { new Notification("Chatly", { body: label, icon: "/icon-192.png" }); } catch {}
  }
}
function clearUnread() { unreadCount = 0; updateTabTitle(); }
function playMessageSound() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.13);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.14);
    oscillator.onended = () => context.close();
  } catch {}
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

function createAvatar(name, url, className = "avatar") {
  const avatar = document.createElement("span");
  avatar.className = className;
  avatar.setAttribute("aria-hidden", "true");
  const initials = String(name || "?").trim().slice(0, 1).toUpperCase() || "?";
  if (url && /^https:\/\//i.test(url)) {
    const image = document.createElement("img");
    image.src = url;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => { avatar.textContent = initials; }, { once: true });
    avatar.append(image);
  } else avatar.textContent = initials;
  return avatar;
}

socket.on("conversation history", ({ conversation, messages, pinned }) => {
  currentConversation = conversation;
  allMessages = messages;
  pinnedItems = pinned;
  renderMessages();
  renderPinnedMessages();
  clearUnread();
});
socket.on("pinned messages", ({ conversation, messages }) => {
  if (conversation !== currentConversation) return;
  pinnedItems = messages;
  renderPinnedMessages();
  renderMessages();
});
socket.on("direct opened", ({ user }) => {
  currentDirectUser = user;
  $("conversation-title").textContent = `Direct message with ${user.name}`;
  $("call-controls").classList.remove("hidden");
  $("search-input").value = "";
  document.querySelectorAll(".room-button").forEach((button) => button.classList.remove("active"));
});
socket.on("direct notification", ({ conversation, fromId, fromName }) => {
  if (fromId === currentUserId) return;
  if (fromId === currentDirectUser?.id && conversation === currentConversation) return;
  incrementUnread(`${fromName} sent you a message`);
});
socket.on("chat message", (message) => {
  if (message.conversation !== currentConversation) {
    if (message.conversation?.startsWith("dm:") || message.senderId === currentUserId) return;
    incrementUnread(`New message in #${message.conversation}`);
    return;
  }
  allMessages.push(message);
  addMessage(message);
  if (message.user !== username) {
    if (document.visibilityState !== "visible") incrementUnread("New message");
    else playMessageSound();
  }
});
socket.on("system message", addSystemMessage);
socket.on("message error", addSystemMessage);

document.querySelectorAll(".room-button").forEach((button) => {
  button.addEventListener("click", () => {
    currentDirectUser = null;
    $("call-controls").classList.add("hidden");
    currentConversation = button.dataset.room;
    showSavedOnly = false;
    $("saved-btn").textContent = "☆ Saved";
    $("conversation-title").textContent = `# ${currentConversation}`;
    document.querySelectorAll(".room-button").forEach((roomButton) => roomButton.classList.toggle("active", roomButton === button));
    $("search-input").value = "";
    socket.emit("join room", currentConversation);
    clearUnread();
    sidebar.classList.remove("open");
  });
});

$("search-input").addEventListener("input", renderMessages);
$("file-btn").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", () => {
  selectedFile = $("file-input").files[0] || null;
  $("file-btn").textContent = selectedFile ? "✓" : "+";
  $("file-btn").title = selectedFile ? selectedFile.name : "Attach a file";
});

$("saved-btn").addEventListener("click", () => {
  showSavedOnly = !showSavedOnly;
  $("saved-btn").setAttribute("aria-pressed", String(showSavedOnly));
  $("saved-btn").textContent = showSavedOnly ? "← All messages" : "☆ Saved";
  renderMessages();
});

let resumedSupabaseSession = false;
async function resumeSupabaseSession() {
  if (!supabaseClient || resumedSupabaseSession) return;
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session || resumedSupabaseSession) return;
  resumedSupabaseSession = true;
  authToken = data.session.access_token;
  const user = data.session.user;
  currentUserId = user.id;
  username = String(user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Chatly user").slice(0, 20);
  $("auth-status").textContent = `Signed in as ${user.email}`;
  try {
    const response = await fetch("/api/username", { headers: { Authorization: `Bearer ${authToken}` } });
    const result = await response.json();
    if (response.ok && result.username) username = result.username;
  } catch {}
  $("username").value = username;
  loginScreen.classList.add("hidden");
  usernameScreen.classList.remove("hidden");
}
$("username-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const chosenName = $("username").value.trim();
  const status = $("username-status");
  const submit = $("username-submit");
  submit.disabled = true;
  status.textContent = "Checking username…";
  try {
    const response = await fetch("/api/username", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ username: chosenName })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save that username.");
    username = result.username;
    status.textContent = "Opening your chat…";
    try { await loadSavedMessages(); } catch (error) { status.textContent = error.message; }
    socket.auth = { token: authToken };
    socket.connect();
  } catch (error) {
    status.textContent = error.message;
    submit.disabled = false;
  }
});
$("google-fallback").addEventListener("click", async () => {
  if (!supabaseClient) {
    $("auth-status").textContent = "Supabase is not configured. Copy .env.example to .env, add your Supabase Project URL and anon key, then restart the server.";
    return;
  }
  $("auth-status").textContent = "Redirecting to Google…";
  const { error } = await supabaseClient.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  if (error) $("auth-status").textContent = error.message;
});
if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    authToken = session?.access_token || "";
    if (authToken) socket.auth = { token: authToken };
  });
  resumeSupabaseSession();
} else {
  $("auth-status").textContent = "Add your Supabase Project URL and anon key to .env, enable Google under Supabase Auth providers, and restart the server.";
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
  users.forEach(({ id, name, avatar }) => {
    const li = document.createElement("li");
    li.append(createAvatar(name, avatar));
    const label = document.createElement("button");
    label.type = "button";
    label.className = "online-name direct-user";
    label.textContent = name;
    label.title = `Message ${name}`;
    label.addEventListener("click", () => {
      if (id !== currentUserId) socket.emit("open direct", id);
      sidebar.classList.remove("open");
    });
    const dot = document.createElement("span");
    dot.className = "online-dot";
    dot.setAttribute("aria-label", "Online");
    li.append(label, dot);
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

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
window.addEventListener("focus", clearUnread);

function callIceServers() {
  return [{ urls: "stun:stun.l.google.com:19302" }];
}
function showCall(status, incoming = false) {
  $("call-status").textContent = status;
  $("call-modal").classList.remove("hidden");
  $("incoming-call-actions").classList.toggle("hidden", !incoming);
  $("active-call-actions").classList.toggle("hidden", incoming);
}
function setCallVideos(video) {
  $("call-modal").classList.toggle("audio-only", !video);
  $("local-video").classList.toggle("hidden", !video);
  $("remote-video").classList.toggle("hidden", !video);
  $("camera-call-btn").disabled = !video;
}
async function startCall(video) {
  if (!currentDirectUser || activeCall) return;
  const callId = crypto.randomUUID();
  activeCall = { callId, peerId: currentDirectUser.id, peerName: currentDirectUser.name, video, initiator: true, offerSent: false, pendingLocalCandidates: [] };
  setCallVideos(video);
  showCall(`Calling ${activeCall.peerName}…`);
  try {
    localCallStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    $("local-video").srcObject = localCallStream;
    createPeerConnection();
    localCallStream.getTracks().forEach((track) => peerConnection.addTrack(track, localCallStream));
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("call offer", { toId: activeCall.peerId, callId, offer, video });
    activeCall.offerSent = true;
    activeCall.pendingLocalCandidates.forEach((candidate) => socket.emit("call ice", { toId: activeCall.peerId, callId, candidate }));
    activeCall.pendingLocalCandidates = [];
    callTimeout = setTimeout(() => {
      if (activeCall?.callId === callId && peerConnection?.connectionState !== "connected") {
        addSystemMessage(`${activeCall.peerName} did not answer.`);
        endCall("no-answer");
      }
    }, 30000);
  } catch (error) {
    addSystemMessage(error.name === "NotAllowedError" ? "Allow microphone and camera access to place this call." : "Could not start the call. Check your microphone and camera.");
    endCall("failed", false);
  }
}
function createPeerConnection() {
  peerConnection = new RTCPeerConnection({ iceServers: callIceServers() });
  peerConnection.onicecandidate = ({ candidate }) => {
    if (!candidate || !activeCall) return;
    if (activeCall.initiator && !activeCall.offerSent) activeCall.pendingLocalCandidates.push(candidate);
    else socket.emit("call ice", { toId: activeCall.peerId, callId: activeCall.callId, candidate });
  };
  peerConnection.ontrack = ({ streams, track }) => {
    if (!remoteCallStream) remoteCallStream = streams[0] || new MediaStream();
    if (!streams[0]) remoteCallStream.addTrack(track);
    $("remote-video").srcObject = remoteCallStream;
    $("remote-video").play().catch(() => {});
  };
  peerConnection.onconnectionstatechange = () => {
    if (!activeCall || !peerConnection) return;
    if (peerConnection.connectionState === "connected") {
      clearTimeout(callTimeout);
      $("call-status").textContent = `Connected with ${activeCall.peerName}`;
    } else if (peerConnection.connectionState === "failed") {
      addSystemMessage("The call could not connect. Try again on another network.");
      endCall("failed", false);
    }
  };
}
async function acceptCall() {
  if (!activeCall || activeCall.initiator) return;
  const call = activeCall;
  try {
    localCallStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.video });
    $("local-video").srcObject = localCallStream;
    createPeerConnection();
    localCallStream.getTracks().forEach((track) => peerConnection.addTrack(track, localCallStream));
    await peerConnection.setRemoteDescription(call.offer);
    await flushIceCandidates();
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("call answer", { toId: call.peerId, callId: call.callId, answer });
    showCall(`Connecting to ${call.peerName}…`);
  } catch (error) {
    addSystemMessage(error.name === "NotAllowedError" ? "Allow microphone and camera access to answer." : "Could not answer the call.");
    endCall("failed");
  }
}
async function flushIceCandidates() {
  if (!peerConnection?.remoteDescription) return;
  const candidates = queuedIceCandidates;
  queuedIceCandidates = [];
  for (const candidate of candidates) {
    try { await peerConnection.addIceCandidate(candidate); } catch {}
  }
}
function endCall(reason = "ended", notifyPeer = true) {
  if (activeCall && notifyPeer) socket.emit("call end", { toId: activeCall.peerId, callId: activeCall.callId, reason });
  clearTimeout(callTimeout);
  peerConnection?.close();
  peerConnection = null;
  localCallStream?.getTracks().forEach((track) => track.stop());
  localCallStream = null;
  remoteCallStream = null;
  queuedIceCandidates = [];
  $("local-video").srcObject = null;
  $("remote-video").srcObject = null;
  $("call-modal").classList.add("hidden");
  $("mute-call-btn").textContent = "Mute";
  $("camera-call-btn").textContent = "Camera off";
  activeCall = null;
}

$("voice-call-btn").addEventListener("click", () => startCall(false));
$("video-call-btn").addEventListener("click", () => startCall(true));
$("accept-call-btn").addEventListener("click", acceptCall);
$("decline-call-btn").addEventListener("click", () => endCall("declined"));
$("hangup-call-btn").addEventListener("click", () => endCall());
$("mute-call-btn").addEventListener("click", () => {
  const tracks = localCallStream?.getAudioTracks() || [];
  if (!tracks.length) return;
  const muted = tracks[0].enabled;
  tracks.forEach((track) => { track.enabled = !muted; });
  $("mute-call-btn").textContent = muted ? "Unmute" : "Mute";
});
$("camera-call-btn").addEventListener("click", () => {
  const tracks = localCallStream?.getVideoTracks() || [];
  if (!tracks.length) return;
  const enabled = tracks[0].enabled;
  tracks.forEach((track) => { track.enabled = !enabled; });
  $("camera-call-btn").textContent = enabled ? "Camera on" : "Camera off";
});

socket.on("incoming call", ({ callId, fromId, fromName, fromAvatar, offer, video }) => {
  if (activeCall) {
    socket.emit("call end", { toId: fromId, callId, reason: "busy" });
    return;
  }
  currentDirectUser = { id: fromId, name: fromName, avatar: fromAvatar };
  socket.emit("open direct", fromId);
  activeCall = { callId, peerId: fromId, peerName: fromName, video, offer, initiator: false };
  setCallVideos(video);
  showCall(`Incoming ${video ? "video" : "voice"} call from ${fromName}`, true);
});
socket.on("call answered", async ({ callId, fromId, answer }) => {
  if (!activeCall?.initiator || callId !== activeCall.callId || fromId !== activeCall.peerId || !peerConnection) return;
  try {
    await peerConnection.setRemoteDescription(answer);
    await flushIceCandidates();
    $("call-status").textContent = `Connecting to ${activeCall.peerName}…`;
  } catch { endCall("failed"); }
});
socket.on("call ice", async ({ callId, fromId, candidate }) => {
  if (!activeCall || callId !== activeCall.callId || fromId !== activeCall.peerId) return;
  if (!peerConnection?.remoteDescription) queuedIceCandidates.push(candidate);
  else {
    try { await peerConnection.addIceCandidate(candidate); } catch {}
  }
});
socket.on("call ended", ({ callId, fromId, reason }) => {
  if (!activeCall || callId !== activeCall.callId || fromId !== activeCall.peerId) return;
  if (reason === "declined") addSystemMessage(`${activeCall.peerName} declined the call.`);
  else if (reason === "busy") addSystemMessage(`${activeCall.peerName} is busy.`);
  else if (reason === "no-answer") addSystemMessage(`${activeCall.peerName} did not answer.`);
  endCall(reason, false);
});
