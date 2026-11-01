// Connects to the Socket.IO server that serves this page
const socket = io({ autoConnect: false });
let username = "";
let currentUserId = "";
let currentProfile = null;
let avatarGridBuilt = false;
let authToken = "";
let savedItems = [];
let showSavedOnly = false;
let currentConversation = "general";
let currentDirectUser = null;
let pinnedItems = [];
let onlineUserCache = [];
let myGroups = [];
let editingGroupId = null;
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
let voiceRecorder = null;
let voiceStream = null;
let voiceChunks = [];
const voiceMessageButton = $("voice-message-btn");
voiceMessageButton.addEventListener("click", async () => {
  if (voiceRecorder?.state === "recording") {
    voiceRecorder.stop();
    voiceMessageButton.disabled = true;
    voiceMessageButton.textContent = "…";
    voiceMessageButton.title = "Finishing recording";
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    addSystemMessage("Voice recording is not supported in this browser. Try a current browser over HTTPS.");
    return;
  }
  if (!authToken || !currentConversation) {
    addSystemMessage("Sign in and open a chat before recording a voice message.");
    return;
  }
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
    voiceRecorder = new MediaRecorder(voiceStream, mimeType ? { mimeType } : undefined);
    voiceChunks = [];
    voiceRecorder.addEventListener("dataavailable", (event) => { if (event.data.size) voiceChunks.push(event.data); });
    voiceRecorder.addEventListener("stop", () => {
      const type = (voiceRecorder.mimeType || voiceChunks[0]?.type || "audio/webm").split(";")[0];
      const extension = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
      selectedFile = new File(voiceChunks, `voice-message-${Date.now()}.${extension}`, { type });
      voiceStream?.getTracks().forEach((track) => track.stop());
      voiceStream = null;
      voiceRecorder = null;
      voiceChunks = [];
      voiceMessageButton.disabled = false;
      voiceMessageButton.textContent = "🎙";
      voiceMessageButton.classList.remove("recording");
      voiceMessageButton.setAttribute("aria-label", "Record voice message");
      voiceMessageButton.title = "Recording ready — send voice message";
      $("message-form").requestSubmit();
    }, { once: true });
    voiceRecorder.start();
    voiceMessageButton.classList.add("recording");
    voiceMessageButton.textContent = "■";
    voiceMessageButton.setAttribute("aria-label", "Stop and send recording");
    voiceMessageButton.title = "Recording… select to stop and send";
  } catch (error) {
    voiceStream?.getTracks().forEach((track) => track.stop());
    voiceStream = null;
    addSystemMessage(error.name === "NotAllowedError" ? "Allow microphone access to record a voice message." : "Could not start voice recording.");
  }
});
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
function addMessage({ id, conversation, user, text, time, avatar, attachment, senderId, assistant, deleted, reactions, reactionNames }) {
  const message = { id, conversation, user, text, time, avatar, attachment, senderId, assistant, deleted, reactions, reactionNames };
  const key = messageKey(message);
  if (showSavedOnly && !savedItems.some((item) => messageKey(item) === key)) return;
  const box = document.createElement("div");
  const ownMessage = senderId ? senderId === currentUserId : user === username;
  box.className = "msg" + (user === username ? " mine" : "");
  if (id) box.dataset.messageId = id;
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

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

  bubble.append(name);
  if (text) bubble.append(body);
  if (attachment) {
    const file = document.createElement("div");
    file.className = "message-attachment";
    bubble.append(file);
    showAttachment(attachment, file);
  }
  bubble.append(stamp);
  const reactionEntries = Object.entries(reactions || {}).filter(([, reactors]) => Array.isArray(reactors) && reactors.length);
  let reactionRow = null;
  if (reactionEntries.length) {
    reactionRow = document.createElement("div");
    reactionRow.className = "message-reactions";
    reactionEntries.forEach(([emoji, reactors]) => {
      const wrapper = document.createElement("span");
      wrapper.className = "reaction-wrap";
      const reaction = document.createElement("button");
      reaction.type = "button";
      reaction.className = "reaction-chip" + (reactors.includes(currentUserId) ? " reacted" : "");
      reaction.textContent = `${emoji} ${reactors.length}`;
      reaction.title = reactors.length === 1 ? "1 reaction" : `${reactors.length} reactions`;
      reaction.setAttribute("aria-pressed", String(reactors.includes(currentUserId)));
      const names = reactionNames?.[emoji] || [];
      const who = document.createElement("span");
      who.className = "reaction-who";
      who.setAttribute("role", "tooltip");
      who.textContent = names.length ? `Reacted by ${names.slice(0, 8).join(", ")}${names.length > 8 ? ` and ${names.length - 8} more` : ""}` : `${reactors.length} people reacted`;
      reaction.title = who.textContent;
      reaction.setAttribute("aria-label", `${emoji}, reacted by ${names.join(", ") || `${reactors.length} people`}`);
      reaction.addEventListener("click", (event) => {
        event.stopPropagation();
        document.querySelectorAll(".reaction-wrap.show-reactors").forEach((open) => { if (open !== wrapper) open.classList.remove("show-reactors"); });
        wrapper.classList.toggle("show-reactors");
      });
      wrapper.append(reaction, who);
      reactionRow.append(wrapper);
    });
  }
  if (deleted) {
    box.classList.add("deleted-message");
    box.append(bubble);
    messagesBox.appendChild(box);
    messagesBox.scrollTop = messagesBox.scrollHeight;
    return;
  }
  const actions = document.createElement("div");
  actions.className = "message-actions";
  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "message-menu-button";
  menuButton.textContent = "⋯";
  menuButton.setAttribute("aria-label", "Message options");
  menuButton.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div");
  menu.className = "message-menu hidden";
  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = menu.classList.contains("hidden");
    closeMessageMenus();
    document.querySelectorAll(".message-menu-button").forEach((other) => other.setAttribute("aria-expanded", "false"));
    menu.classList.toggle("hidden", !willOpen);
    menuButton.setAttribute("aria-expanded", String(willOpen));
  });
  let lastTouchTime = 0;
  const canQuickReact = (event) => !ownMessage && id && !event.target.closest("button, a, video, .message-actions, .message-reactions");
  box.addEventListener("dblclick", (event) => {
    if (!canQuickReact(event)) return;
    event.preventDefault();
    socket.emit("react message", { messageId: id, emoji: "❤️" });
  });
  box.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "touch" || !canQuickReact(event)) return;
    const now = Date.now();
    if (now - lastTouchTime < 360) {
      event.preventDefault();
      lastTouchTime = 0;
      socket.emit("react message", { messageId: id, emoji: "❤️" });
    } else lastTouchTime = now;
  });
  box.addEventListener("contextmenu", (event) => {
    if (event.target.closest(".message-menu")) return;
    event.preventDefault();
    closeMessageMenus();
    menu._portalParent = actions;
    document.body.append(menu);
    menu.style.position = "fixed";
    menu.style.right = "auto";
    menu.style.zIndex = "1000";
    menu.classList.remove("hidden");
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8))}px`;
    menuButton.setAttribute("aria-expanded", "true");
  });
  if (!ownMessage) {
    const reactionPicker = document.createElement("div");
    reactionPicker.className = "reaction-picker";
    const reactionLabel = document.createElement("span");
    reactionLabel.className = "reaction-picker-label";
    reactionLabel.textContent = "React";
    reactionPicker.append(reactionLabel);
    ["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "🙏"].forEach((emoji) => {
      const reaction = document.createElement("button");
      reaction.type = "button";
      reaction.textContent = emoji;
      reaction.setAttribute("aria-label", `React with ${emoji}`);
      reaction.addEventListener("click", (event) => {
        event.stopPropagation();
        socket.emit("react message", { messageId: id, emoji });
        closeMessageMenus();
      });
      reactionPicker.append(reaction);
    });
    menu.append(reactionPicker);
  }
  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = "pin-message";
  pin.textContent = pinnedItems.some((item) => item.id === id) ? "📌 Pinned" : "📌 Pin";
  pin.addEventListener("click", () => socket.emit("pin message", id));
  menu.append(pin);
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
  menu.append(save);
  if (id) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-message";
    const attachmentLabel = attachment?.type?.startsWith("audio/") ? "voice message" : "attached file";
    remove.textContent = attachment ? `Delete message / ${attachmentLabel}` : "Delete message";
    remove.setAttribute("aria-label", attachment ? `Delete message and ${attachmentLabel}` : "Delete message");
    remove.addEventListener("click", () => {
      if (window.confirm(attachment ? "Delete this message and its attached file?" : "Delete this message?")) socket.emit("delete message", id);
      menu.classList.add("hidden");
      menuButton.setAttribute("aria-expanded", "false");
    });
    menu.append(remove);
  }
  actions.append(menuButton, menu);
  bubble.append(actions);
  box.append(bubble);
  if (reactionRow) box.append(reactionRow);
  messagesBox.appendChild(box);
  messagesBox.scrollTop = messagesBox.scrollHeight;   // auto-scroll to newest
}

function messageKey(message) { return `${message.user}\n${message.time}\n${message.text}`; }
function closeMessageMenus() {
  document.querySelectorAll(".message-menu").forEach((menu) => {
    menu.classList.add("hidden");
    if (menu._portalParent) {
      menu._portalParent.appendChild(menu);
      delete menu._portalParent;
    }
    menu.style.position = "";
    menu.style.left = "";
    menu.style.top = "";
    menu.style.right = "";
    menu.style.zIndex = "";
  });
  document.querySelectorAll(".message-menu-button").forEach((button) => button.setAttribute("aria-expanded", "false"));
}
document.addEventListener("click", () => {
  closeMessageMenus();
  document.querySelectorAll(".reaction-wrap.show-reactors").forEach((wrapper) => wrapper.classList.remove("show-reactors"));
});
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
    } else if (attachment.type?.startsWith("audio/")) {
      const audio = document.createElement("audio");
      audio.src = url;
      audio.controls = true;
      audio.preload = "metadata";
      audio.className = "voice-message-player";
      audio.setAttribute("aria-label", `Voice message from ${attachment.name}`);
      container.append(audio);
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
  if (url && (/^https:\/\//i.test(url) || /^\/api\/avatars\/avatar-\d{1,3}\.svg$/.test(url))) {
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
  updateDetailsPanel();
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
  $("conversation-name").textContent = `Direct message with ${user.name}`;
  $("call-controls").classList.remove("hidden");
  $("search-input").value = "";
  document.querySelectorAll(".room-button").forEach((button) => button.classList.remove("active"));
  document.querySelectorAll(".group-button").forEach((button) => button.classList.remove("active"));
  updateDetailsPanel();
});
socket.on("direct notification", ({ conversation, fromId, fromName }) => {
  if (fromId === currentUserId) return;
  if (conversation === currentConversation) return;
  incrementUnread(`${fromName} sent you a message`);
});
socket.on("groups updated", async () => { await loadGroups(); updateDetailsPanel(); });
socket.on("chat message", (message) => {
  if (message.conversation !== currentConversation) {
    if (message.conversation?.startsWith("dm:") || message.senderId === currentUserId) return;
    incrementUnread(`New message in #${message.conversation}`);
    return;
  }
  allMessages.push(message);
  addMessage(message);
  updateDetailsPanel();
  if (message.user !== username) {
    if (document.visibilityState !== "visible") incrementUnread("New message");
    else playMessageSound();
  }
});
socket.on("message deleted", ({ message, conversation, pinned }) => {
  if (conversation !== currentConversation) return;
  allMessages = allMessages.map((item) => item.id === message.id ? message : item);
  savedItems = savedItems.filter((item) => item.id !== message.id);
  pinnedItems = pinned;
  renderMessages();
  renderPinnedMessages();
  updateDetailsPanel();
});
socket.on("message reactions", ({ id, conversation, reactions, reactionNames }) => {
  allMessages = allMessages.map((message) => message.id === id ? { ...message, reactions, reactionNames } : message);
  savedItems = savedItems.map((message) => message.id === id ? { ...message, reactions, reactionNames } : message);
  if (conversation === currentConversation) renderMessages();
});
socket.on("system message", addSystemMessage);
socket.on("message error", addSystemMessage);

document.querySelectorAll(".room-button").forEach((button) => {
  button.addEventListener("click", () => {
    currentDirectUser = null;
    $("call-controls").classList.add("hidden");
    currentConversation = button.dataset.room;
    updateDetailsPanel();
    showSavedOnly = false;
    $("saved-btn").textContent = "☆ Saved";
    $("conversation-name").textContent = `# ${currentConversation}`;
    document.querySelectorAll(".room-button").forEach((roomButton) => roomButton.classList.toggle("active", roomButton === button));
    document.querySelectorAll(".group-button").forEach((groupButton) => groupButton.classList.remove("active"));
    $("search-input").value = "";
    socket.emit("join room", currentConversation);
    clearUnread();
    sidebar.classList.remove("open");
  });
});

async function loadGroups() {
  if (!authToken) return;
  try {
    const response = await fetch("/api/groups", { headers: { Authorization: `Bearer ${authToken}` } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load groups.");
    myGroups = result;
    const nav = $("group-list");
    nav.replaceChildren();
    myGroups.forEach((group) => {
      const item = document.createElement("div");
      item.className = "group-list-item";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "room-button group-button" + (currentConversation === `group:${group.id}` ? " active" : "");
      button.dataset.groupId = group.id;
      button.textContent = `▧ ${group.name}`;
      button.title = `${group.memberIds.length} members`;
      button.addEventListener("click", () => openGroup(group));
      item.append(button);
      if (group.creatorId === currentUserId) {
        const addButton = document.createElement("button");
        addButton.type = "button";
        addButton.className = "group-list-add";
        addButton.textContent = "+";
        addButton.title = `Add members to ${group.name}`;
        addButton.setAttribute("aria-label", `Add members to ${group.name}`);
        addButton.addEventListener("click", () => showGroupMembersDialog(group));
        item.append(addButton);
      }
      nav.append(item);
    });
  } catch (error) { addSystemMessage(error.message); }
}
function openGroup(group) {
  currentDirectUser = null;
  $("call-controls").classList.add("hidden");
  currentConversation = `group:${group.id}`;
  showSavedOnly = false;
  $("saved-btn").textContent = "☆ Saved";
  $("saved-btn").setAttribute("aria-pressed", "false");
  $("conversation-name").textContent = `▧ ${group.name}`;
  document.querySelectorAll(".room-button").forEach((button) => button.classList.remove("active"));
  document.querySelectorAll(".group-button").forEach((button) => button.classList.toggle("active", button.dataset.groupId === group.id));
  $("search-input").value = "";
  socket.emit("join group", group.id);
  updateDetailsPanel();
  clearUnread();
  sidebar.classList.remove("open");
}

async function showGroupMembersDialog(group = null) {
  editingGroupId = group?.id || null;
  $("group-modal").classList.remove("hidden");
  $("group-modal-title").textContent = group ? `Add members to ${group.name}` : "Create a group";
  $("group-name-label").classList.toggle("hidden", Boolean(group));
  $("group-name").classList.toggle("hidden", Boolean(group));
  $("group-name").required = !group;
  $("group-submit").textContent = group ? "Add members" : "Create group";
  $("group-status").textContent = "Loading members…";
  $("group-member-options").replaceChildren();
  try {
    const response = await fetch("/api/group-members", { headers: { Authorization: `Bearer ${authToken}` } });
    const availableMembers = await response.json();
    if (!response.ok) throw new Error(availableMembers.error || "Could not load members.");
    const existingIds = new Set(group?.memberIds || []);
    const members = [...(group?.members || []), ...availableMembers.filter((member) => !existingIds.has(member.id))];
    const options = $("group-member-options");
    if (!members.length) options.textContent = "No other Chatly members yet.";
    members.forEach((member) => {
      const label = document.createElement("label");
      label.className = "group-member-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = member.id;
      if (existingIds.has(member.id)) { checkbox.checked = true; checkbox.disabled = true; }
      const avatar = createAvatar(member.name, member.avatar);
      const name = document.createElement("span");
      name.textContent = member.name;
      const status = document.createElement("small");
      status.textContent = member.online ? "Online" : "";
      label.append(checkbox, avatar, name, status);
      options.append(label);
    });
    $("group-status").textContent = "Select one or more people to add.";
  } catch (error) { $("group-status").textContent = error.message; }
}
$("create-group-btn").addEventListener("click", () => showGroupMembersDialog());
function openAddGroupMembersDialog() {
  const group = myGroups.find((item) => `group:${item.id}` === currentConversation);
  if (group?.creatorId === currentUserId) showGroupMembersDialog(group);
}
$("add-group-members-btn").addEventListener("click", openAddGroupMembersDialog);
$("add-group-members-header").addEventListener("click", openAddGroupMembersDialog);
$("group-close").addEventListener("click", () => $("group-modal").classList.add("hidden"));
$("group-modal").addEventListener("click", (event) => { if (event.target === $("group-modal")) $("group-modal").classList.add("hidden"); });
$("create-group-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("group-submit");
  submit.disabled = true;
  const groupMode = Boolean(editingGroupId);
  $("group-status").textContent = groupMode ? "Adding members…" : "Creating group…";
  const memberIds = [...$("group-member-options").querySelectorAll("input:checked:not(:disabled)")].map((checkbox) => checkbox.value);
  try {
    const url = groupMode ? `/api/groups/${encodeURIComponent(editingGroupId)}/members` : "/api/groups";
    const body = groupMode ? { memberIds } : { name: $("group-name").value.trim(), memberIds };
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` }, body: JSON.stringify(body) });
    const group = await response.json();
    if (!response.ok) throw new Error(group.error || (groupMode ? "Could not add members." : "Could not create group."));
    $("group-modal").classList.add("hidden");
    if (!groupMode) $("group-name").value = "";
    editingGroupId = null;
    await loadGroups();
    if (!groupMode) openGroup(group);
    else updateDetailsPanel();
  } catch (error) { $("group-status").textContent = error.message; }
  finally { submit.disabled = false; }
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
  currentProfile = { id: user.id, email: user.email || "", name: String(user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Chatly user").slice(0, 20), avatar: user.user_metadata?.avatar_url || user.user_metadata?.picture || "" };
  currentProfile.googleAvatar = currentProfile.avatar;
  username = currentProfile.name;
  $("auth-status").textContent = `Signed in as ${user.email}`;
  let hasSavedUsername = false;
  try {
    const response = await fetch("/api/username", { headers: { Authorization: `Bearer ${authToken}` } });
    const result = await response.json();
    if (response.ok && result.username) { username = result.username; hasSavedUsername = true; }
  } catch {}
  try {
    const avatarResponse = await fetch("/api/avatar", { headers: { Authorization: `Bearer ${authToken}` } });
    const avatarResult = await avatarResponse.json();
    if (avatarResponse.ok) {
      currentProfile.avatarId = avatarResult.avatarId || "";
      currentProfile.avatar = avatarResult.avatar || currentProfile.googleAvatar;
    }
  } catch {}
  updateProfilePanel();
  $("username").value = username;
  loginScreen.classList.add("hidden");
  if (hasSavedUsername) await enterChat();
  else usernameScreen.classList.remove("hidden");
}
async function enterChat() {
  await loadGroups();
  try { await loadSavedMessages(); } catch (error) { $("username-status").textContent = error.message; }
  socket.auth = { token: authToken };
  if (!socket.connected) socket.connect();
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
    updateProfilePanel();
    await enterChat();
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

function updateProfilePanel() {
  if (!currentProfile) return;
  const avatar = createAvatar(currentProfile.name || username, currentProfile.avatar, "avatar profile-avatar");
  avatar.id = "settings-avatar";
  $("settings-avatar").replaceWith(avatar);
  $("settings-username-label").textContent = username || currentProfile.name;
  $("settings-email").textContent = currentProfile.email;
  buildAvatarGrid();
  $("settings-username").value = username || "";
  const profileButton = $("profile-btn");
  profileButton.replaceChildren(createAvatar(username || currentProfile.name, currentProfile.avatar, "avatar profile-button-avatar"), document.createTextNode("Profile"));
}
function buildAvatarGrid() {
  if (avatarGridBuilt) return;
  avatarGridBuilt = true;
  const grid = $("avatar-grid");
  for (let index = 1; index <= 120; index += 1) {
    const avatarId = `avatar-${index}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "avatar-choice";
    button.dataset.avatarId = avatarId;
    button.setAttribute("aria-label", `Choose illustrated avatar ${index}`);
    const image = document.createElement("img");
    image.src = `/api/avatars/${avatarId}.svg`;
    image.alt = "";
    image.loading = "lazy";
    button.append(image);
    button.addEventListener("click", () => saveProfileAvatar(avatarId));
    grid.append(button);
  }
}
async function saveProfileAvatar(avatarId) {
  const status = $("avatar-status");
  status.textContent = "Saving avatar…";
  document.querySelectorAll(".avatar-choice").forEach((button) => { button.disabled = true; });
  try {
    const response = await fetch("/api/avatar", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ avatarId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save avatar.");
    currentProfile.avatarId = result.avatarId;
    currentProfile.avatar = result.avatar || currentProfile.googleAvatar;
    updateProfilePanel();
    document.querySelectorAll(".avatar-choice").forEach((button) => button.classList.toggle("selected", button.dataset.avatarId === avatarId));
    status.textContent = avatarId ? "Avatar saved to your profile." : "Using your Google photo.";
  } catch (error) { status.textContent = error.message; }
  finally { document.querySelectorAll(".avatar-choice").forEach((button) => { button.disabled = false; }); }
}
$("google-avatar-btn").addEventListener("click", () => saveProfileAvatar(""));
$("avatar-show-more").addEventListener("click", () => {
  const expanded = $("avatar-grid").classList.toggle("expanded");
  $("avatar-show-more").textContent = expanded ? "Show less" : "Show more";
  $("avatar-show-more").setAttribute("aria-expanded", String(expanded));
});
socket.on("avatar updated", (update) => {
  if (!update || typeof update !== "object") return;
  allMessages = allMessages.map((message) => message.senderId === update.userId ? { ...message, avatar: update.avatar || message.googleAvatar || message.avatar } : message);
  savedItems = savedItems.map((message) => message.senderId === update.userId ? { ...message, avatar: update.avatar || message.googleAvatar || message.avatar } : message);
  onlineUserCache = onlineUserCache.map((member) => member.id === update.userId ? { ...member, avatar: update.avatar || member.avatar } : member);
  if (currentDirectUser?.id === update.userId) currentDirectUser.avatar = update.avatar || currentDirectUser.avatar;
  myGroups = myGroups.map((group) => ({ ...group, members: (group.members || []).map((member) => member.id === update.userId ? { ...member, avatar: update.avatar || member.avatar } : member) }));
  if (update.userId === currentUserId && currentProfile) {
    currentProfile.avatar = update.avatar || currentProfile.googleAvatar;
    currentProfile.avatarId = update.avatar?.match(/avatar-(\d+)\.svg$/)?.[0]?.replace(".svg", "") || "";
    updateProfilePanel();
  }
  renderMessages();
  updateDetailsPanel();
});
$("profile-btn").addEventListener("click", () => { updateProfilePanel(); $("settings-status").textContent = ""; $("settings-modal").classList.remove("hidden"); });
$("settings-close").addEventListener("click", () => $("settings-modal").classList.add("hidden"));
$("settings-modal").addEventListener("click", (event) => { if (event.target === $("settings-modal")) $("settings-modal").classList.add("hidden"); });
$("settings-username-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const save = $("settings-username-save");
  const status = $("settings-status");
  save.disabled = true;
  status.textContent = "Saving username…";
  try {
    const response = await fetch("/api/username", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ username: $("settings-username").value.trim() }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save that username.");
    username = result.username;
    if (currentProfile) currentProfile.name = username;
    $("me").textContent = "You are " + username;
    updateProfilePanel();
    status.textContent = "Username saved.";
  } catch (error) { status.textContent = error.message; }
  finally { save.disabled = false; }
});
socket.on("username updated", (name) => { username = name; if (currentProfile) currentProfile.name = name; $("me").textContent = "You are " + name; updateProfilePanel(); });
$("signout-btn").addEventListener("click", async () => {
  $("signout-btn").disabled = true;
  try { if (supabaseClient) await supabaseClient.auth.signOut(); }
  finally {
    socket.disconnect();
    authToken = ""; currentUserId = ""; currentProfile = null; username = ""; resumedSupabaseSession = false;
    $("settings-modal").classList.add("hidden");
    chatScreen.classList.add("hidden"); usernameScreen.classList.add("hidden"); loginScreen.classList.remove("hidden");
    $("auth-status").textContent = "Signed out.";
    $("signout-btn").disabled = false;
  }
});

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
  onlineUserCache = users.filter((user) => user.id !== currentUserId);
  $("online-count").textContent = onlineUserCache.length;
  const list = $("user-list");
  list.innerHTML = "";
  onlineUserCache.forEach(({ id, name, avatar }) => {
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
  updateDetailsPanel();
});

function updateDetailsPanel() {
  const person = currentDirectUser;
  const group = currentConversation.startsWith("group:") ? myGroups.find((item) => `group:${item.id}` === currentConversation) : null;
  const name = person?.name || group?.name || `# ${currentConversation}`;
  const conversationAvatar = createAvatar(name, person?.avatar || "", "avatar conversation-avatar");
  conversationAvatar.id = "conversation-avatar";
  $("conversation-avatar").replaceWith(conversationAvatar);
  $("conversation-name").textContent = name;
  const onlineGroupMembers = group ? group.memberIds.filter((id) => id === currentUserId || onlineUserCache.some((user) => user.id === id)).length : 0;
  $("conversation-subtitle").textContent = person
    ? (onlineUserCache.some((user) => user.id === person.id) ? "Direct message · Online" : "Direct message")
    : group ? `${group.memberIds.length} members · ${onlineGroupMembers} online`
      : `Community room · ${onlineUserCache.length} online`;
  $("add-group-members-header").classList.toggle("hidden", !group || group.creatorId !== currentUserId);
  const avatar = createAvatar(name, person?.avatar || "", "avatar details-avatar");
  avatar.id = "details-avatar";
  $("details-avatar").replaceWith(avatar);
  $("details-name").textContent = name;
  $("details-status").textContent = person
    ? (onlineUserCache.some((user) => user.id === person.id) ? "Online" : "Chat member")
    : group ? `${group.memberIds.length} members` : "Chat room";
  const membersSection = $("details-members-section");
  membersSection.classList.toggle("hidden", !group);
  $("add-group-members-btn").classList.toggle("hidden", !group || group.creatorId !== currentUserId);
  const membersBox = $("details-members");
  membersBox.replaceChildren();
  (group?.members || []).forEach((member) => {
    const row = document.createElement("div");
    row.className = "details-member";
    row.append(createAvatar(member.name, member.avatar));
    const label = document.createElement("span");
    label.textContent = member.name + (member.id === group.creatorId ? " · Admin" : "");
    const status = document.createElement("span");
    status.className = member.online ? "online-dot" : "offline-dot";
    status.title = member.online ? "Online" : "Offline";
    row.append(label, status);
    membersBox.append(row);
  });

  const attachments = allMessages.filter((message) => message.attachment).map((message) => message.attachment);
  const unique = [...new Map(attachments.map((file) => [file.id, file])).values()];
  const images = unique.filter((file) => file.type?.startsWith("image/")).slice(-6).reverse();
  const files = unique.filter((file) => !file.type?.startsWith("image/")).slice(-6).reverse();
  const mediaBox = $("details-media");
  mediaBox.replaceChildren();
  if (!images.length) mediaBox.innerHTML = '<span class="details-empty">No shared images yet</span>';
  images.forEach((file) => {
    const tile = document.createElement("div");
    tile.className = "details-media-item";
    tile.title = file.name;
    mediaBox.append(tile);
    showAttachment(file, tile);
  });
  const filesBox = $("details-files");
  filesBox.replaceChildren();
  if (!files.length) filesBox.innerHTML = '<span class="details-empty">No shared files yet</span>';
  files.forEach((file) => {
    const tile = document.createElement("div");
    tile.className = "details-file";
    filesBox.append(tile);
    showAttachment(file, tile);
  });
}

$("details-toggle").addEventListener("click", () => {
  if (window.innerWidth > 1000) $("chat").classList.toggle("details-closed");
  else $("details-panel").classList.add("open");
});
$("conversation-details-btn").addEventListener("click", () => {
  if (window.innerWidth > 1000) $("chat").classList.toggle("details-closed");
  else $("details-panel").classList.add("open");
});
$("details-close").addEventListener("click", () => {
  if (window.innerWidth > 1000) $("chat").classList.add("details-closed");
  else $("details-panel").classList.remove("open");
});
$("conversation-search-btn").addEventListener("click", () => $("search-input").focus());

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
  try { localStorage.setItem("chatly-theme-v2", theme); } catch (e) {}
}
let saved = "dark";
try { saved = localStorage.getItem("chatly-theme-v2") || saved; } catch (e) {}
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
  const peerName = activeCall?.peerName || currentDirectUser?.name || "Chatly call";
  const peerAvatar = activeCall?.peerAvatar || currentDirectUser?.avatar || "";
  $("call-peer-name").textContent = peerName;
  const headerAvatar = createAvatar(peerName, peerAvatar, "avatar call-avatar");
  headerAvatar.id = "call-avatar";
  $("call-avatar").replaceWith(headerAvatar);
  const stageAvatar = createAvatar(peerName, peerAvatar, "avatar audio-call-avatar");
  stageAvatar.id = "audio-call-avatar";
  $("audio-call-avatar").replaceWith(stageAvatar);
  $("audio-call-name").textContent = peerName;
  $("call-modal").classList.remove("hidden");
  $("hangup-call-btn").classList.toggle("hidden", incoming);
  $("incoming-call-actions").classList.toggle("hidden", !incoming);
  $("active-call-actions").classList.toggle("hidden", incoming);
}
function setCallVideos(video) {
  $("call-modal").classList.toggle("audio-only", !video);
  $("audio-call-stage").classList.toggle("hidden", video);
  $("local-video").classList.toggle("hidden", !video);
  $("remote-video").classList.toggle("hidden", !video);
  $("camera-call-btn").disabled = !video;
}
async function startCall(video) {
  if (!currentDirectUser || activeCall) return;
  const callId = crypto.randomUUID();
  activeCall = { callId, peerId: currentDirectUser.id, peerName: currentDirectUser.name, peerAvatar: currentDirectUser.avatar || "", video, initiator: true, offerSent: false, pendingLocalCandidates: [] };
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
  $("mute-call-btn").textContent = "🎙 Mute";
  $("mute-call-btn").setAttribute("aria-label", "Mute microphone");
  $("camera-call-btn").textContent = "▣ Camera off";
  $("camera-call-btn").setAttribute("aria-label", "Turn camera off");
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
  $("mute-call-btn").textContent = muted ? "🎙 Unmute" : "🎙 Mute";
  $("mute-call-btn").setAttribute("aria-label", muted ? "Unmute microphone" : "Mute microphone");
});
$("camera-call-btn").addEventListener("click", () => {
  const tracks = localCallStream?.getVideoTracks() || [];
  if (!tracks.length) return;
  const enabled = tracks[0].enabled;
  tracks.forEach((track) => { track.enabled = !enabled; });
  $("camera-call-btn").textContent = enabled ? "▣ Camera on" : "▣ Camera off";
  $("camera-call-btn").setAttribute("aria-label", enabled ? "Turn camera on" : "Turn camera off");
});

socket.on("incoming call", ({ callId, fromId, fromName, fromAvatar, offer, video }) => {
  if (activeCall) {
    socket.emit("call end", { toId: fromId, callId, reason: "busy" });
    return;
  }
  currentDirectUser = { id: fromId, name: fromName, avatar: fromAvatar };
  socket.emit("open direct", fromId);
  activeCall = { callId, peerId: fromId, peerName: fromName, peerAvatar: fromAvatar || "", video, offer, initiator: false };
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
