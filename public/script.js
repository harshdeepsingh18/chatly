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
let ticTacToeState = null;
let partyGameState = null;
const partyGameStates = new Map();
let selectedPartyGame = "tic-tac-toe";
let chessSelectedSquare = null;
let chessLegalSquares = [];
let pinnedItems = [];
let onlineUserCache = [];
let myGroups = [];
let contactsCache = [];
let conversationCache = [];
let activeInboxFilter = "all";
const unreadByConversation = new Map();
let pinnedConversationIds = [];
try { pinnedConversationIds = JSON.parse(localStorage.getItem("chatly-pinned-conversations") || "[]").filter((id) => typeof id === "string"); } catch {}
let globalSearchTimer = null;
let globalSearchSequence = 0;
let focusUntil = 0;
try { focusUntil = Number(localStorage.getItem("chatly-focus-until") || 0); } catch {}
let editingGroupId = null;
let unreadCount = 0;
const titleBase = "Chatly";
const attachmentUrls = new Map();
let selectedFile = null;
const pendingAuraRequests = new Map();
let auraPanelReturnToHome = true;
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
const voiceMicIcon = '<svg class="voice-mic-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="3" width="6" height="12" rx="3"></rect><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8"></path></svg>';
let pendingMediaRequest = null;
const micIconSvg = '<svg class="lucide-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z"></path><path d="M19 10a7 7 0 0 1-14 0"></path><path d="M12 19v3"></path></svg>';
const cameraIconSvg = '<svg class="lucide-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"></path><path d="m16 9 5-3v12l-5-3"></path></svg>';
function showMediaPermission(request, help = "Tap continue, then choose Allow in your browser’s permission prompt.") {
  pendingMediaRequest = request;
  const voiceMessage = request.kind === "voice-message";
  $("media-permission-icon").innerHTML = voiceMessage ? micIconSvg : request.video ? cameraIconSvg : micIconSvg;
  $("media-permission-title").textContent = voiceMessage ? "Record a voice message" : request.video ? "Ready for a video call?" : "Ready for a voice call?";
  $("media-permission-description").textContent = voiceMessage
    ? "Allow microphone access to record a voice message in this chat."
    : request.video ? "Allow both devices so you and your friend can see and hear each other."
      : "Allow microphone access so you and your friend can talk.";
  $("permission-camera-item").classList.toggle("hidden", voiceMessage || !request.video);
  $("media-permission-help").textContent = help;
  $("media-permission-continue").textContent = "Continue and allow";
  const canRequest = Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
  $("media-permission-continue").disabled = !canRequest;
  if (!window.isSecureContext) $("media-permission-help").textContent = "Microphone and camera access needs HTTPS. Open the secure https:// Chatly address on your phone.";
  else if (!navigator.mediaDevices?.getUserMedia) $("media-permission-help").textContent = "This browser does not provide microphone or camera access. Try an up-to-date browser.";
  $("media-permission-modal").classList.remove("hidden");
}
async function runMediaPermissionRequest() {
  const request = pendingMediaRequest;
  if (!request || !navigator.mediaDevices?.getUserMedia || !window.isSecureContext) return;
  const button = $("media-permission-continue");
  button.disabled = true;
  button.textContent = "Waiting for browser permission…";
  $("media-permission-help").textContent = "Choose Allow in the browser prompt. If no prompt appears, check this site’s permissions in your browser settings.";
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: request.video });
  } catch (error) {
    let help = "The browser blocked access. Open the site permissions from the address bar, allow the requested devices, then try again.";
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") help = "No matching microphone or camera was found. Connect or enable the device, then try again.";
    else if (error.name === "NotReadableError" || error.name === "TrackStartError") help = "The device is busy or blocked by your phone. Close other apps using it, then try again.";
    showMediaPermission(request, help);
    $("media-permission-continue").textContent = "Try again";
    return;
  }
  pendingMediaRequest = null;
  $("media-permission-modal").classList.add("hidden");
  button.disabled = false;
  button.textContent = "Continue and allow";
  await request.onGranted(stream);
}
function requestMediaPermission(request) {
  showMediaPermission(request);
}
$("media-permission-continue").addEventListener("click", runMediaPermissionRequest);
$("media-permission-cancel").addEventListener("click", () => {
  const request = pendingMediaRequest;
  pendingMediaRequest = null;
  $("media-permission-modal").classList.add("hidden");
  request?.onCancel?.();
});
function beginVoiceRecording(stream) {
  voiceStream = stream;
  try {
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
    voiceRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
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
      voiceMessageButton.innerHTML = voiceMicIcon;
      voiceMessageButton.classList.remove("recording");
      voiceMessageButton.setAttribute("aria-label", "Record voice message");
      voiceMessageButton.title = "Recording ready — send voice message";
      $("message-form").requestSubmit();
    }, { once: true });
    voiceRecorder.start();
    voiceMessageButton.classList.add("recording");
    voiceMessageButton.innerHTML = '<span class="voice-stop-icon" aria-hidden="true"></span>';
    voiceMessageButton.setAttribute("aria-label", "Stop and send recording");
    voiceMessageButton.title = "Recording… select to stop and send";
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    voiceStream = null;
    voiceRecorder = null;
    addSystemMessage("Could not start voice recording in this browser.");
  }
}
voiceMessageButton.addEventListener("click", () => {
  if (voiceRecorder?.state === "recording") {
    voiceRecorder.stop();
    voiceMessageButton.disabled = true;
    voiceMessageButton.textContent = "…";
    voiceMessageButton.title = "Finishing recording";
    return;
  }
  if (typeof MediaRecorder === "undefined") {
    addSystemMessage("Voice recording is not supported in this browser. Try a current browser over HTTPS.");
    return;
  }
  if (!authToken || !currentConversation) {
    addSystemMessage("Sign in and open a chat before recording a voice message.");
    return;
  }
  requestMediaPermission({ kind: "voice-message", video: false, onGranted: beginVoiceRecording });
});
function activateAuraShortcut() {
  const currentText = input.value.trimStart();
  if (!/^@aura\b/i.test(currentText) && !/^\/aura\b/i.test(currentText)) input.value = currentText ? `@aura ${currentText}` : "@aura ";
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
const auraPanel = $("aura-panel");
const auraPanelContent = $("aura-panel-content");
function showAuraHome() {
  auraPanelContent.innerHTML = `<p class="aura-panel-question">What would you like to do?</p><div class="aura-actions"><button type="button" data-aura-action="summarize"><svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18.5V6.5A2.5 2.5 0 0 1 6.5 4h9.4L20 9.1v9.4A2.5 2.5 0 0 1 17.5 21H6.5A2.5 2.5 0 0 1 4 18.5Z"></path><path d="M15.5 4v4.5h4.5"></path><path d="M8 12h8M8 16h8"></path></svg><strong>Summarize chat</strong></button><button type="button" data-aura-action="translate"><svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h7.5M4 11h10.5M4 15.5h6.5M16.5 5.5v13M14 8.5h5M14 15.5h5"></path><path d="m18 3.5 2.4 2.4 2.2-2.2"></path></svg><strong>Translate messages</strong></button><button type="button" data-aura-action="reply"><svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9.5V7.2A1.2 1.2 0 0 1 8.2 6h9.8A1.2 1.2 0 0 1 19.2 7.2v7.6A1.2 1.2 0 0 1 18 16H10l-4 4v-4.5H8.2A1.2 1.2 0 0 1 7 14.8v-5.3Z"></path></svg><strong>Suggest a reply</strong></button><button type="button" data-aura-action="explain"><svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8v8.5M8.5 6.6h7M6.7 18.8c.5 1.4 1.7 2.4 3.3 2.4 1.7 0 2.8-1.2 3.3-2.4.5-1.7-.7-3.1-3.3-3.1-2.6 0-3.8 1.4-3.3 3.1Z"></path></svg><strong>Explain a message</strong></button><button type="button" data-aura-action="improve"><svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18.5h16"></path><path d="M7 15.5 12.5 10l2 2 4-4"></path><path d="M17 8.5h2v2"></path><path d="M7 7.5h6"></path></svg><strong>Improve my text</strong></button><button type="button" data-aura-action="find"><svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6"></circle><path d="m16 16 4 4"></path></svg><strong>Find something in this chat</strong></button><button type="button" data-aura-action="ask"><svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 9.8a3.5 3.5 0 0 1 7 0c0 2.2-2.2 2.9-3.5 4.3-.5.5-.8 1-.8 1.9"></path><path d="M12 18.5h.01"></path><circle cx="12" cy="12" r="9"></circle></svg><strong>Ask Aura anything</strong></button></div>`;
}
function openAuraPanel() {
  showAuraHome();
  auraPanel.classList.remove("hidden");
  $("aura-shortcut-btn").setAttribute("aria-expanded", "true");
}
function closeAuraPanel() {
  auraPanel.classList.add("hidden");
  $("aura-shortcut-btn").setAttribute("aria-expanded", "false");
}
function auraPanelView(title, content) {
  auraPanelContent.innerHTML = `<button type="button" class="aura-back" data-aura-action="home">‹ All Aura tools</button><p class="aura-panel-question">${title}</p>${content}`;
}
function showAuraTextPrompt(action) {
  const isFind = action === "find";
  const isImprove = action === "improve";
  if (isImprove) {
    auraPanelView("How should Aura improve your text?", `<div class="aura-choice-list">${[
      ["professional", "Make it professional"], ["friendly", "Make it friendly"], ["grammar", "Fix grammar"], ["shorter", "Make it shorter"], ["clearer", "Make it clearer"]
    ].map(([value, label]) => `<button type="button" data-aura-style="${value}">${label}</button>`).join("")}</div><p class="aura-panel-note">Aura uses the text in your composer and returns an edit for you to review.</p>`);
    return;
  }
  const title = isFind ? "What would you like to find?" : "Ask Aura anything";
  const placeholder = isFind ? "What did we decide about the trip?" : "Ask a question…";
  auraPanelView(title, `<div class="aura-question-form" data-aura-form="${action}"><input name="question" maxlength="800" placeholder="${placeholder}" required><button type="button" data-aura-submit>Ask Aura</button></div>`);
  auraPanelContent.querySelector("input")?.focus();
}
function submitAuraQuestion(form) {
  const question = form.querySelector("input")?.value.trim();
  if (!question) return;
  if (form.dataset.auraForm === "translate") return requestAura(`/ai translate ${question}`, "translate");
  const prompt = form.dataset.auraForm === "find" ? `/ai Find something in this chat: ${question}` : `/ai ${question}`;
  requestAura(prompt, form.dataset.auraForm);
}
function requestAura(prompt, kind = "chat", mode = "chat") {
  const requestId = window.crypto?.randomUUID?.() || `aura-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  pendingAuraRequests.set(requestId, { kind, mode });
  auraPanelContent.innerHTML = `<div class="aura-loading" role="status"><span class="aura-spinner" aria-hidden="true"></span><strong>Aura is thinking…</strong><small>Your answer will appear here and in the chat.</small></div>`;
  socket.emit("aura request", { prompt, requestId, kind, mode });
}
function finishAuraRequest(requestId, answer, error = "") {
  const request = pendingAuraRequests.get(requestId);
  if (!request) return;
  pendingAuraRequests.delete(requestId);
  if (request.mode === "composer" && !error) {
    input.value = answer;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    auraPanelContent.innerHTML = `<div class="aura-result-note"><strong>Text ready to edit</strong><p>Aura put its suggestion in your composer. Review it before sending.</p><button type="button" class="aura-back" data-aura-action="home">Back to Aura tools</button></div>`;
    return;
  }
  auraPanelContent.innerHTML = error
    ? `<div class="aura-error" role="alert"><strong>Aura couldn’t finish that request.</strong><p></p><button type="button" class="aura-back" data-aura-action="home">Try another action</button></div>`
    : `<div class="aura-result-note"><strong><span class="aura-mark" aria-hidden="true"></span> Aura’s answer is in the chat</strong><p>${request.kind === "reply" ? "Choose a suggestion below Aura’s message to use it." : "Your answer is ready in the conversation."}</p><button type="button" class="aura-back" data-aura-action="home">Back to Aura tools</button></div>`;
  if (error) auraPanelContent.querySelector(".aura-error p").textContent = error;
}
$("aura-shortcut-btn").addEventListener("click", openAuraPanel);
$("aura-panel-close").addEventListener("click", closeAuraPanel);
auraPanelContent.addEventListener("click", (event) => {
  const actionButton = event.target.closest("[data-aura-action]");
  if (actionButton) {
    const action = actionButton.dataset.auraAction;
    if (action === "home") return showAuraHome();
    if (action === "summarize") return auraPanelView("Choose how much chat to summarize", `<div class="aura-choice-list"><button type="button" data-aura-summary="10">Last 10 messages</button><button type="button" data-aura-summary="50">Last 50 messages</button><button type="button" data-aura-summary="all">Entire conversation</button></div>`);
    if (action === "translate") return auraPanelView("Choose a language", `<div class="aura-choice-list">${["English", "Hindi", "Spanish", "French", "German", "Other"].map((language) => `<button type="button" data-aura-language="${language}">${language}</button>`).join("")}</div>`);
    if (action === "reply") return requestAura("/ai reply", "reply");
    if (action === "explain") return requestAura("/ai explain", "explain");
    if (action === "improve" || action === "find" || action === "ask") return showAuraTextPrompt(action);
  }
  const askButton = event.target.closest("[data-aura-submit]");
  if (askButton) return submitAuraQuestion(askButton.closest("[data-aura-form]"));
  const summary = event.target.closest("[data-aura-summary]");
  if (summary) return requestAura(`/ai summarize ${summary.dataset.auraSummary}`, "summarize");
  const language = event.target.closest("[data-aura-language]");
  if (language) {
    if (language.dataset.auraLanguage === "Other") {
      auraPanelView("Enter a language", `<div class="aura-question-form" data-aura-form="translate"><input name="question" maxlength="40" placeholder="Language" required><button type="button" data-aura-submit>Translate</button></div>`);
      auraPanelContent.querySelector("input")?.focus();
      return;
    }
    return requestAura(`/ai translate ${language.dataset.auraLanguage}`, "translate");
  }
  const style = event.target.closest("[data-aura-style]");
  if (style) {
    const text = input.value.trim();
    if (!text) return auraPanelView("Add some text first", `<p class="aura-panel-note">Type a message in the composer, then choose an improvement style.</p><button type="button" class="aura-back" data-aura-action="improve">Choose a style</button>`);
    return requestAura(`/ai improve my text. Style: ${style.dataset.auraStyle}. Return only the improved text. Text: ${text}`, "improve", "composer");
  }
});
 auraPanelContent.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !event.target.matches(".aura-question-form input")) return;
  event.preventDefault();
  submitAuraQuestion(event.target.closest("[data-aura-form]"));
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !auraPanel.classList.contains("hidden")) closeAuraPanel();
});
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "a") {
    event.preventDefault();
    activateAuraShortcut();
  }
});
$("message-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const typedText = input.value.trim();
  if (/^\/ai(?:\s|$)/i.test(typedText)) {
    const prompt = typedText.replace(/^\/ai\s*/i, "").trim();
    if (!prompt) {
      input.value = "/ai ";
      input.focus();
      return;
    }
    socket.emit("aura request", `/ai ${prompt}`);
    input.value = "";
    emojiPanel.classList.add("hidden");
    socket.emit("typing", false);
    return;
  }
  const slashAuraMatch = typedText.match(/^\/aura(?:\s+([\s\S]+))?$/i);
  const text = slashAuraMatch ? (slashAuraMatch[1] ? `@aura ${slashAuraMatch[1]}` : "") : typedText;
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
function addMessage({ id, conversation, user, text, time, avatar, attachment, senderId, assistant, auraKind, requestId, deleted, reactions, reactionNames }) {
  const message = { id, conversation, user, text, time, avatar, attachment, senderId, assistant, auraKind, requestId, deleted, reactions, reactionNames };
  const key = messageKey(message);
  if (showSavedOnly && !savedItems.some((item) => messageKey(item) === key)) return;
  const box = document.createElement("div");
  const ownMessage = senderId ? senderId === currentUserId : user === username;
  box.className = "msg" + (user === username ? " mine" : "") + (assistant ? " aura-message" : "");
  if (id) box.dataset.messageId = id;
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  const name = document.createElement("div");
  name.className = "name";
  name.append(createAvatar(user, avatar, "avatar message-avatar"));
  const usernameLabel = document.createElement("span");
  usernameLabel.textContent = assistant ? "Aura" : user;
  if (assistant) usernameLabel.classList.add("aura-name");
  name.append(usernameLabel);

  const body = document.createElement("span");
  body.className = "message-text";
  body.textContent = text;            // textContent keeps user input safe from HTML injection

  const stamp = document.createElement("span");
  stamp.className = "time";
  stamp.textContent = new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  bubble.append(name);
  if (text) bubble.append(body);
  if (assistant && message.auraKind === "reply") {
    const suggestions = text.split(/\r?\n/).map((line) => line.trim().replace(/^(?:\d+[.)]\s*|[-*•]\s*)/, "").replace(/^['“”"]|['“”"]$/g, "")).filter(Boolean);
    if (suggestions.length >= 2 && suggestions.length <= 4) {
      const suggestionList = document.createElement("div");
      suggestionList.className = "aura-suggestions";
      suggestions.slice(0, 3).forEach((suggestion) => {
        const item = document.createElement("div");
        item.className = "aura-suggestion";
        const suggestionText = document.createElement("span");
        suggestionText.textContent = suggestion;
        const useReply = document.createElement("button");
        useReply.type = "button";
        useReply.textContent = "Use reply";
        useReply.addEventListener("click", () => {
          input.value = suggestion;
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        });
        item.append(suggestionText, useReply);
        suggestionList.append(item);
      });
      bubble.append(suggestionList);
    }
  }
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
  const replyButton = document.createElement("button");
  replyButton.type = "button";
  replyButton.textContent = "Reply";
  replyButton.addEventListener("click", () => {
    input.value = `${user}: ${text}`;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    closeMessageMenus();
  });
  menu.append(replyButton);
  if (text) {
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "Copy text";
    copyButton.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); addSystemMessage("Message copied."); }
      catch { addSystemMessage("Clipboard access is unavailable in this browser."); }
      closeMessageMenus();
    });
    menu.append(copyButton);
    if (assistant !== true) {
      const explainButton = document.createElement("button");
      explainButton.type = "button";
      explainButton.textContent = "Explain with Aura";
      explainButton.addEventListener("click", () => { socket.emit("aura request", `/ai explain ${text}`); closeMessageMenus(); });
      const translateButton = document.createElement("button");
      translateButton.type = "button";
      translateButton.textContent = "Translate with Aura";
      translateButton.addEventListener("click", () => { socket.emit("aura request", `/ai Translate this message into English. Return only the translation.\n\n${text}`); closeMessageMenus(); });
      menu.append(explainButton, translateButton);
    }
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
function updateFocusUi() {
  const active = focusUntil > Date.now();
  if (focusUntil && !active) {
    focusUntil = 0;
    try { localStorage.removeItem("chatly-focus-until"); } catch {}
  }
  const button = $("focus-toggle");
  if (button) {
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("is-active", active);
    $("focus-label").textContent = active ? `Until ${new Date(focusUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Quiet your notifications";
  }
  const settingsButton = $("settings-focus-toggle");
  if (settingsButton) settingsButton.textContent = active ? "Resume" : "Turn on";
  document.body.classList.toggle("focus-active", active);
}
function setFocusMode(active) {
  focusUntil = active ? Date.now() + 60 * 60 * 1000 : 0;
  try {
    if (focusUntil) localStorage.setItem("chatly-focus-until", String(focusUntil));
    else localStorage.removeItem("chatly-focus-until");
  } catch {}
  updateFocusUi();
}
function isFocusModeActive() { return focusUntil > Date.now(); }
updateFocusUi();
setInterval(updateFocusUi, 30000);
function incrementUnread(label) {
  if (isFocusModeActive()) return;
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
  if (currentDirectUser?.id !== user.id) {
    ticTacToeState = null;
    partyGameState = null;
    partyGameStates.clear();
    chessSelectedSquare = null;
    chessLegalSquares = [];
  }
  currentDirectUser = user;
  clearConversationUnread(currentConversation);
  loadConversations();
  $("conversation-name").textContent = `Direct message with ${user.name}`;
  $("call-controls").classList.remove("hidden");
  $("search-input").value = "";
  document.querySelectorAll(".room-button").forEach((button) => button.classList.remove("active"));
  document.querySelectorAll(".group-button").forEach((button) => button.classList.remove("active"));
  updateDetailsPanel();
  if (!$("games-section").classList.contains("hidden")) {
    renderGamesView();
    if (selectedPartyGame === "tic-tac-toe") socket.emit("tic-tac-toe get state");
    else socket.emit("party-game get", selectedPartyGame);
  }
});
socket.on("tic-tac-toe state", (game) => {
  if (game && game.conversation !== currentConversation) {
    if (game.status === "pending" && game.invitedBy !== currentUserId && game.players.includes(currentUserId)) incrementUnread("Tic Tac Toe invitation");
    return;
  }
  const previous = ticTacToeState;
  ticTacToeState = game;
  if (game) setGamesFeedback("");
  if (game?.status === "pending" && game.invitedBy !== currentUserId && previous?.status !== "pending") {
    addSystemMessage(`${currentDirectUser?.name || "Your friend"} invited you to play Tic Tac Toe.`);
  }
  renderTicTacToe();
});
socket.on("party game state", (game) => {
  if (game && game.conversation !== currentConversation) {
    if (game.status === "pending" && game.invitedBy !== currentUserId && game.players.includes(currentUserId)) incrementUnread(`${game.type} invitation`);
    return;
  }
  const previous = partyGameState;
  setGamesFeedback("");
  partyGameStates.set(game.type, game);
  if (game.type !== selectedPartyGame) return;
  partyGameState = game;
  chessSelectedSquare = null;
  chessLegalSquares = [];
  if (game?.status === "pending" && game.invitedBy !== currentUserId && previous?.status !== "pending") {
    addSystemMessage(`${currentDirectUser?.name || "Your friend"} invited you to play ${gameLabels[game.type] || "a game"}.`);
  }
  renderTicTacToe();
});
const gameLabels = { "tic-tac-toe": "Tic Tac Toe", "snakes-ladders": "Snakes and Ladders", ludo: "Ludo", chess: "Chess", "snake-arena": "Snake Arena" };
const gameDetails = {
  "tic-tac-toe": { icon: "⭕", description: "A quick classic. Get three in a row." },
  "snakes-ladders": { icon: "🪜", description: "Roll, climb, and race to the finish." },
  ludo: { icon: "🎲", description: "Bring your tokens home to win." },
  chess: { icon: "♟️", description: "A thoughtful match, move by move." },
  "snake-arena": { icon: "🐍", description: "Grow your snake and outlast your rival." }
};
function setGamesFeedback(message, isError = false) {
  const feedback = $("games-feedback");
  feedback.textContent = message;
  feedback.classList.toggle("success", Boolean(message) && !isError);
}
function requestGameInvite(type, button) {
  const label = button.textContent;
  setGamesFeedback("");
  button.disabled = true;
  button.textContent = "Sending invite…";
  const event = type === "tic-tac-toe" ? "tic-tac-toe invite" : "party-game invite";
  const args = type === "tic-tac-toe" ? [] : [type];
  socket.timeout(8000).emit(event, ...args, (timeoutError, result) => {
    if (!timeoutError && result?.ok) {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = label;
      }
      setGamesFeedback(`Invite sent to ${currentDirectUser?.name || "your friend"}.`);
      return;
    }
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = label;
    }
    setGamesFeedback(timeoutError ? "The server did not respond. Check your connection and try again." : result?.error || "Could not send the invite. Please try again.", true);
  });
}
socket.on("party-game legal", ({ conversation, from, moves }) => {
  if (conversation !== currentConversation) return;
  chessSelectedSquare = from;
  chessLegalSquares = moves;
  renderTicTacToe();
});
function renderGamesView() {
  const opponent = $("games-opponent");
  opponent.replaceChildren();

  if (currentDirectUser) {
    const card = document.createElement("div");
    card.className = "games-opponent-card";
    card.append(createAvatar(currentDirectUser.name, currentDirectUser.avatar));
    const copy = document.createElement("div");
    copy.className = "games-opponent-copy";
    const name = document.createElement("strong");
    name.textContent = `Playing with ${currentDirectUser.name}`;
    const hint = document.createElement("small");
    hint.textContent = "Choose a game below to invite them.";
    copy.append(name, hint);
    card.append(copy);
    opponent.append(card);
    return;
  }

  const empty = document.createElement("div");
  empty.className = "games-opponent-empty";
  const title = document.createElement("strong");
  title.textContent = "Choose a friend to play with";
  const hint = document.createElement("p");
  hint.textContent = onlineUserCache.length
    ? "Pick someone online, or open a direct chat with a friend first."
    : "Start a direct chat with a friend. They’ll show up here when they’re online.";
  empty.append(title, hint);

  if (onlineUserCache.length) {
    const choices = document.createElement("div");
    choices.className = "games-opponent-choices";
    onlineUserCache.forEach((user) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "games-opponent-choice";
      button.textContent = `${user.name} · Invite`;
      button.addEventListener("click", () => {
        socket.emit("open direct", user.id);
        sidebar.classList.remove("open");
      });
      choices.append(button);
    });
    empty.append(choices);
  }

  opponent.append(empty);
}
function renderTicTacToe() {
  const content = $("tic-tac-toe-content");
  if (!content) return;
  content.replaceChildren();
  const picker = document.createElement("div");
  picker.className = "party-game-picker";
  Object.entries(gameLabels).forEach(([type, label]) => {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "party-game-choice" + (selectedPartyGame === type ? " selected" : "");
    const icon = document.createElement("span");
    icon.className = "game-card-icon";
    icon.textContent = gameDetails[type].icon;
    const name = document.createElement("span");
    name.className = "game-card-name";
    name.textContent = label;
    const description = document.createElement("span");
    description.className = "game-card-description";
    description.textContent = gameDetails[type].description;
    choice.append(icon, name, description);
    choice.setAttribute("aria-pressed", String(selectedPartyGame === type));
    choice.addEventListener("click", () => {
      selectedPartyGame = type;
      if (type === "tic-tac-toe") {
        if (currentDirectUser) socket.emit("tic-tac-toe get state");
      } else {
        partyGameState = partyGameStates.get(type) || null;
        if (currentDirectUser) socket.emit("party-game get", type);
      }
      renderGamesView();
      renderTicTacToe();
    });
    picker.append(choice);
  });
  content.append(picker);
  if (!currentDirectUser) {
    const note = document.createElement("p");
    note.className = "games-empty-note";
    note.textContent = "Select a friend above to start or continue a multiplayer game.";
    content.append(note);
    return;
  }
  if (selectedPartyGame !== "tic-tac-toe") {
    renderPartyGame(content, partyGameStates.get(selectedPartyGame) || partyGameState);
    return;
  }
  const game = ticTacToeState;
  const friend = currentDirectUser;
  const meScore = game?.scores?.[currentUserId] || { wins: 0, losses: 0, draws: 0 };
  const friendScore = game?.scores?.[friend?.id] || { wins: 0, losses: 0, draws: 0 };
  const score = document.createElement("div");
  score.className = "tic-tac-toe-score";
  score.innerHTML = `<div><strong>YOU</strong><b>${meScore.wins || 0}</b><small>WINS</small></div><span>VS</span><div><strong></strong><b>${friendScore.wins || 0}</b><small>WINS</small></div><div class="tic-tac-toe-draws"><b>${meScore.draws || 0}</b><small>DRAWS</small></div>`;
  score.children[0].children[0].textContent = username || "You";
  score.children[2].children[0].textContent = friend?.name || "Friend";
  content.append(score);
  const status = document.createElement("p");
  status.className = "tic-tac-toe-status";
  content.append(status);
  if (!game || game.status === "declined" || game.status === "finished") {
    if (game?.status === "finished") status.textContent = game.winner ? (game.winner === currentUserId ? "You won! 🎉" : `${friend?.name || "Your friend"} won this round.`) : "It's a draw!";
    else if (game?.status === "declined") status.textContent = "Invitation declined. Invite them again when they’re ready.";
    else status.textContent = "Challenge your friend to a quick game.";
    const invite = document.createElement("button");
    invite.type = "button";
    invite.className = "tic-tac-toe-primary";
    invite.textContent = game?.status === "finished" ? "Play again" : "Invite to play";
    invite.addEventListener("click", () => requestGameInvite("tic-tac-toe", invite));
    content.append(invite);
    return;
  }
  if (game.status === "pending") {
    const invited = game.invitedBy !== currentUserId;
    status.textContent = invited ? `${friend?.name || "Your friend"} wants to play!` : `Waiting for ${friend?.name || "your friend"} to accept…`;
    if (invited) {
      const actions = document.createElement("div");
      actions.className = "tic-tac-toe-actions";
      const accept = document.createElement("button");
      accept.type = "button";
      accept.className = "tic-tac-toe-primary";
      accept.textContent = "Accept and play";
      accept.addEventListener("click", () => socket.emit("tic-tac-toe accept"));
      const decline = document.createElement("button");
      decline.type = "button";
      decline.className = "tic-tac-toe-secondary";
      decline.textContent = "Not now";
      decline.addEventListener("click", () => socket.emit("tic-tac-toe decline"));
      actions.append(accept, decline);
      content.append(actions);
    }
    return;
  }
  const myTurn = game.turn === currentUserId;
  const myMark = game.players[0] === currentUserId ? "X" : "O";
  status.textContent = myTurn ? `Your turn — you're ${myMark}.` : `${friend?.name || "Your friend"} is playing…`;
  const board = document.createElement("div");
  board.className = "tic-tac-toe-board";
  game.board.forEach((cell, index) => {
    const square = document.createElement("button");
    square.type = "button";
    square.className = "tic-tac-toe-square" + (cell ? (cell === game.players[0] ? " mark-x" : " mark-o") : "");
    square.textContent = cell ? (cell === game.players[0] ? "X" : "O") : "";
    square.setAttribute("aria-label", `Square ${index + 1}${cell ? `, ${square.textContent}` : ", empty"}`);
    square.disabled = !myTurn || Boolean(cell);
    square.addEventListener("click", () => socket.emit("tic-tac-toe move", index));
    board.append(square);
  });
  content.append(board);
}
function renderPartyGame(content, game) {
  const friend = currentDirectUser;
  const type = selectedPartyGame;
  const scores = game?.scores || {};
  const mine = scores[currentUserId] || { wins: 0, losses: 0, draws: 0 };
  const theirs = scores[friend?.id] || { wins: 0, losses: 0, draws: 0 };
  const score = document.createElement("div");
  score.className = "tic-tac-toe-score party-score";
  const me = document.createElement("div");
  const meName = document.createElement("strong"); meName.textContent = username || "You";
  const meWins = document.createElement("b"); meWins.textContent = String(mine.wins || 0);
  const meLabel = document.createElement("small"); meLabel.textContent = "WINS";
  me.append(meName, meWins, meLabel);
  const vs = document.createElement("span"); vs.textContent = "VS";
  const other = document.createElement("div");
  const otherName = document.createElement("strong"); otherName.textContent = friend?.name || "Friend";
  const otherWins = document.createElement("b"); otherWins.textContent = String(theirs.wins || 0);
  const otherLabel = document.createElement("small"); otherLabel.textContent = "WINS";
  other.append(otherName, otherWins, otherLabel);
  const draws = document.createElement("div"); draws.className = "tic-tac-toe-draws";
  const drawsValue = document.createElement("b"); drawsValue.textContent = String(mine.draws || 0);
  const drawsLabel = document.createElement("small"); drawsLabel.textContent = "DRAWS";
  draws.append(drawsValue, drawsLabel);
  score.append(me, vs, other, draws);
  content.append(score);

  if (game?.status === "playing" && game.type !== type) {
    const note = document.createElement("p"); note.className = "tic-tac-toe-status"; note.textContent = `A ${gameLabels[game.type]} game is already in progress.`; content.append(note);
    const switchGame = document.createElement("button"); switchGame.className = "tic-tac-toe-primary"; switchGame.textContent = `Open ${gameLabels[game.type]}`;
    switchGame.addEventListener("click", () => { selectedPartyGame = game.type; partyGameState = partyGameStates.get(game.type); renderTicTacToe(); }); content.append(switchGame); return;
  }
  const status = document.createElement("p"); status.className = "tic-tac-toe-status"; content.append(status);
  if (!game || game.status === "idle" || game.status === "declined" || game.status === "finished") {
    if (game?.status === "finished") status.textContent = game.winner ? (game.winner === currentUserId ? "You won! 🎉" : `${friend?.name || "Your friend"} won.`) : "It's a draw!";
    else if (game?.status === "declined") status.textContent = "Invite declined. You can ask again later.";
    else status.textContent = `Invite ${friend?.name || "your friend"} to play ${gameLabels[type]}.`;
    const invite = document.createElement("button"); invite.type = "button"; invite.className = "tic-tac-toe-primary"; invite.textContent = game?.status === "finished" ? "Play again" : "Invite to play";
    invite.addEventListener("click", () => requestGameInvite(type, invite)); content.append(invite); return;
  }
  if (game.status === "pending") {
    const invited = game.invitedBy !== currentUserId;
    status.textContent = invited ? `${friend?.name || "Your friend"} invited you to play.` : `Waiting for ${friend?.name || "your friend"}…`;
    if (invited) {
      const actions = document.createElement("div"); actions.className = "tic-tac-toe-actions";
      const accept = document.createElement("button"); accept.type = "button"; accept.className = "tic-tac-toe-primary"; accept.textContent = "Accept"; accept.addEventListener("click", () => socket.emit("party-game accept", type));
      const decline = document.createElement("button"); decline.type = "button"; decline.className = "tic-tac-toe-secondary"; decline.textContent = "Decline"; decline.addEventListener("click", () => socket.emit("party-game decline", type));
      actions.append(accept, decline); content.append(actions);
    }
    return;
  }

  if (type === "snakes-ladders") {
    const index = game.players.indexOf(currentUserId), myTurn = game.turn === currentUserId;
    status.textContent = myTurn ? "Your turn — roll the dice." : `${friend?.name || "Your friend"} is rolling…`;
    const board = document.createElement("div"); board.className = "snakes-ladders-board";
    const jumps = new Map([[4,"L"],[9,"L"],[20,"L"],[28,"L"],[40,"L"],[51,"L"],[63,"L"],[71,"L"],[17,"S"],[54,"S"],[62,"S"],[64,"S"],[87,"S"],[93,"S"],[95,"S"],[99,"S"]]);
    for (let n = 100; n >= 1; n--) {
      const row = Math.floor((100 - n) / 10), start = 100 - row * 10;
      const number = row % 2 === 0 ? start - ((100 - n) % 10) : start - 9 + ((100 - n) % 10);
      const cell = document.createElement("div"); cell.className = "snakes-ladders-cell";
      const label = document.createElement("small"); label.textContent = String(number); cell.append(label);
      const jump = jumps.get(number); if (jump) { const mark = document.createElement("i"); mark.className = jump === "L" ? "ladder-mark" : "snake-mark"; mark.textContent = jump; mark.title = jump === "L" ? "Ladder" : "Snake"; cell.append(mark); }
      game.players.forEach((player, pi) => { if ((game.positions?.[pi] || 0) === number) { const pawn = document.createElement("b"); pawn.className = `board-pawn pawn-${pi}`; pawn.textContent = pi === index ? "●" : "●"; pawn.title = pi === 0 ? "You" : friend?.name || "Friend"; cell.append(pawn); } });
      board.append(cell);
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "snakes-ladders-art");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("aria-hidden", "true");
    const point = (number) => {
      const rowFromBottom = Math.floor((number - 1) / 10);
      const offset = (number - 1) % 10;
      return [(rowFromBottom % 2 === 0 ? offset : 9 - offset) * 10 + 5, (9 - rowFromBottom) * 10 + 5];
    };
    const addPath = (className, d) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", className);
      path.setAttribute("d", d);
      svg.append(path);
    };
    [[4,14],[9,31],[20,38],[28,84],[40,59],[51,67],[63,81],[71,91]].forEach(([from,to]) => {
      const [x1,y1] = point(from), [x2,y2] = point(to);
      addPath("ladder-rail", `M ${x1-1.2} ${y1} L ${x2-1.2} ${y2}`);
      addPath("ladder-rail", `M ${x1+1.2} ${y1} L ${x2+1.2} ${y2}`);
      for (let step = 1; step < 5; step++) {
        const t = step / 5, x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
        addPath("ladder-rung", `M ${x-1.3} ${y} L ${x+1.3} ${y}`);
      }
    });
    [[17,7],[54,34],[62,19],[64,60],[87,24],[93,73],[95,75],[99,78]].forEach(([from,to], index) => {
      const [x1,y1] = point(from), [x2,y2] = point(to);
      const bend = index % 2 ? 7 : -7;
      addPath("snake-path", `M ${x1} ${y1} Q ${(x1+x2)/2+bend} ${(y1+y2)/2} ${x2} ${y2}`);
      const head = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      head.setAttribute("class", "snake-mark-head"); head.setAttribute("cx", String(x1)); head.setAttribute("cy", String(y1)); head.setAttribute("r", "1.65"); svg.append(head);
    });
    board.append(svg);
    content.append(board);
    const roll = document.createElement("button"); roll.type = "button"; roll.className = "tic-tac-toe-primary game-roll-button"; roll.textContent = myTurn ? "🎲 Roll dice" : `Position: ${game.positions?.[index] || "Start"}`; roll.disabled = !myTurn; roll.addEventListener("click", () => socket.emit("party-game action", { type, action: "roll" })); content.append(roll);
  } else if (type === "ludo") {
    const index = game.players.indexOf(currentUserId), myTurn = game.turn === currentUserId;
    const currentRoll = game.dice;
    status.textContent = myTurn ? (currentRoll == null ? "Your turn — roll the dice." : `You rolled a ${currentRoll}. Choose a token.`) : `${friend?.name || "Your friend"} is playing…`;
    const die = document.createElement("div"); die.className = "ludo-die"; die.textContent = currentRoll || "🎲"; content.append(die);
    game.players.forEach((player, pi) => {
      const section = document.createElement("section"); section.className = `ludo-player ludo-player-${pi}`;
      const heading = document.createElement("strong"); heading.textContent = pi === index ? `${username} · You` : friend?.name || "Friend"; section.append(heading);
      const tokens = document.createElement("div"); tokens.className = "ludo-tokens";
      (game.tokens?.[pi] || []).forEach((position, tokenIndex) => {
        const pawn = document.createElement("button"); pawn.type = "button"; pawn.className = "ludo-token"; pawn.textContent = position < 0 ? "●" : position >= 57 ? "★" : String(position + 1);
        pawn.title = position < 0 ? `Token ${tokenIndex + 1} in yard` : `Token ${tokenIndex + 1}: ${position >= 57 ? "Home" : `step ${position + 1} of 58`}`;
        const legal = pi === index && myTurn && currentRoll != null && (position < 0 ? currentRoll === 6 : position + currentRoll <= 57);
        pawn.disabled = !legal; pawn.classList.toggle("can-move", legal);
        if (pi === index) pawn.addEventListener("click", () => socket.emit("party-game action", { type, action: "move-token", token: tokenIndex }));
        const progress = document.createElement("small"); progress.textContent = position < 0 ? "Yard" : position >= 57 ? "Home" : `${position}/57`;
        const item = document.createElement("div"); item.className = "ludo-token-item"; item.append(pawn, progress); tokens.append(item);
      });
      section.append(tokens); content.append(section);
    });
    if (myTurn && currentRoll == null) { const roll = document.createElement("button"); roll.type = "button"; roll.className = "tic-tac-toe-primary game-roll-button"; roll.textContent = "Roll dice"; roll.addEventListener("click", () => socket.emit("party-game action", { type, action: "roll" })); content.append(roll); }
  } else if (type === "chess") {
    const index = game.players.indexOf(currentUserId), myTurn = game.turn === currentUserId;
    status.textContent = myTurn ? `Your turn — playing ${index === 0 ? "White" : "Black"}.` : `${friend?.name || "Your friend"} is thinking…`;
    const board = document.createElement("div"); board.className = "chess-board";
    const glyphs = { wK:"♔", wQ:"♕", wR:"♖", wB:"♗", wN:"♘", wP:"♙", bK:"♚", bQ:"♛", bR:"♜", bB:"♝", bN:"♞", bP:"♟" };
    for (let view = 0; view < 64; view++) {
      const squareIndex = index === 0 ? view : 63 - view;
      const row = Math.floor(squareIndex / 8), col = squareIndex % 8, piece = game.board[squareIndex];
      const square = document.createElement("button"); square.type = "button"; square.className = `chess-square ${(row + col) % 2 ? "dark" : "light"}`;
      if (piece) { square.textContent = glyphs[piece]; square.classList.add(piece[0] === "w" ? "white-piece" : "black-piece"); }
      if (squareIndex === chessSelectedSquare) square.classList.add("selected");
      if (chessLegalSquares.includes(squareIndex)) square.classList.add("legal-target");
      square.disabled = !myTurn;
      square.addEventListener("click", () => {
        if (chessLegalSquares.includes(squareIndex) && chessSelectedSquare !== null) { socket.emit("party-game action", { type, action: "move", from: chessSelectedSquare, to: squareIndex }); chessSelectedSquare = null; chessLegalSquares = []; }
        else if (piece && piece[0] === (index === 0 ? "w" : "b")) socket.emit("party-game legal", { from: squareIndex });
        else { chessSelectedSquare = null; chessLegalSquares = []; }
        renderTicTacToe();
      });
      board.append(square);
    }
    content.append(board);
  } else if (type === "snake-arena") {
    const index = game.players.indexOf(currentUserId);
    status.textContent = `${username}: ${game.lengthScores?.[index] || 0} · ${friend?.name || "Friend"}: ${game.lengthScores?.[1-index] || 0} — use arrow keys / WASD`;
    const arena = document.createElement("div"); arena.className = "snake-arena-board";
    for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
      const cell = document.createElement("span"); cell.className = "snake-arena-cell";
      game.snakes?.forEach((snake, pi) => { const part = snake.findIndex(([sx,sy]) => sx === x && sy === y); if (part >= 0) cell.classList.add(part === 0 ? `snake-head-${pi}` : `snake-body-${pi}`); });
      if (game.food?.[0] === x && game.food?.[1] === y) cell.classList.add("snake-food");
      arena.append(cell);
    }
    content.append(arena);
    const controls = document.createElement("div"); controls.className = "snake-arena-controls";
    [["↑",0,-1],["←",-1,0],["↓",0,1],["→",1,0]].forEach(([label,dx,dy]) => { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.setAttribute("aria-label", `Move ${label}`); button.addEventListener("click", () => socket.emit("party-game direction", { dx, dy })); controls.append(button); });
    content.append(controls);
  }
}
window.addEventListener("keydown", (event) => {
  if ($("games-section").classList.contains("hidden") || selectedPartyGame !== "snake-arena" || partyGameState?.status !== "playing") return;
  const direction = { ArrowUp:[0,-1], w:[0,-1], ArrowDown:[0,1], s:[0,1], ArrowLeft:[-1,0], a:[-1,0], ArrowRight:[1,0], d:[1,0] }[event.key];
  if (!direction) return;
  event.preventDefault();
  socket.emit("party-game direction", { dx: direction[0], dy: direction[1] });
});
$("games-nav-btn").addEventListener("click", () => openGamesSection());
$("tic-tac-toe-btn").addEventListener("click", () => openGamesSection());
$("games-back-btn").addEventListener("click", () => closeGamesSection());
function openGamesSection() {
  $("chat").classList.add("games-open");
  $("conversation-view").classList.add("hidden");
  $("games-section").classList.remove("hidden");
  $("games-nav-btn").classList.add("active");
  $("games-nav-btn").setAttribute("aria-current", "page");
  sidebar.classList.remove("open");
  renderGamesView();
  renderTicTacToe();
  if (currentDirectUser) {
    if (selectedPartyGame === "tic-tac-toe") socket.emit("tic-tac-toe get state");
    else socket.emit("party-game get", selectedPartyGame);
  }
}
function closeGamesSection() {
  $("chat").classList.remove("games-open");
  $("conversation-view").classList.remove("hidden");
  $("games-section").classList.add("hidden");
  $("games-nav-btn").classList.remove("active");
  $("games-nav-btn").setAttribute("aria-current", "false");
}
socket.on("direct notification", ({ conversation, fromId, fromName }) => {
  if (fromId === currentUserId) return;
  if (conversation === currentConversation) return;
  markConversationUnread(conversation);
  loadConversations();
  incrementUnread(`${fromName} sent you a message`);
});
socket.on("groups updated", async () => { await loadGroups(); updateDetailsPanel(); });
socket.on("chat message", (message) => {
  updateConversationPreview(message);
  if (message.conversation !== currentConversation) {
    if (message.conversation?.startsWith("dm:") || message.senderId === currentUserId) return;
    markConversationUnread(message.conversation);
    incrementUnread(`New message in #${message.conversation}`);
    return;
  }
  clearConversationUnread(message.conversation);
  if (message.requestId) finishAuraRequest(message.requestId, message.text);
  allMessages.push(message);
  addMessage(message);
  updateDetailsPanel();
  if (message.user !== username) {
    if (document.visibilityState !== "visible") incrementUnread("New message");
    else if (!isFocusModeActive()) playMessageSound();
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
socket.on("aura response", ({ requestId, text }) => finishAuraRequest(requestId, text));
socket.on("aura response error", ({ requestId, error }) => finishAuraRequest(requestId, "", error));

document.querySelectorAll(".room-button").forEach((button) => {
  button.addEventListener("click", () => {
    setAppPage("messages");
    closeGamesSection();
    currentDirectUser = null;
    $("call-controls").classList.add("hidden");
    currentConversation = button.dataset.room;
    clearConversationUnread(currentConversation);
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
    await loadConversations();
  } catch (error) { addSystemMessage(error.message); }
}
function openGroup(group) {
  setAppPage("messages");
  closeGamesSection();
  currentDirectUser = null;
  $("call-controls").classList.add("hidden");
  currentConversation = `group:${group.id}`;
  clearConversationUnread(currentConversation);
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
  const button = $("google-fallback");
  const label = $("google-button-label");
  const spinner = $("google-button-spinner");
  const status = $("auth-status");
  if (!supabaseClient) {
    status.className = "auth-error";
    status.textContent = "Sign-in is not configured yet. Add the Supabase project URL and public key, then restart the server.";
    return;
  }
  if (button.disabled) return;
  button.disabled = true;
  button.classList.add("is-loading");
  button.setAttribute("aria-busy", "true");
  label.textContent = "Connecting to Google…";
  spinner.classList.remove("hidden");
  status.className = "auth-loading";
  status.textContent = "Opening secure sign-in. Keep this page open for a moment.";
  const restoreButton = () => {
    button.disabled = false;
    button.classList.remove("is-loading");
    button.removeAttribute("aria-busy");
    label.textContent = "Continue with Google";
    spinner.classList.add("hidden");
  };
  const redirectWait = window.setTimeout(() => {
    if (loginScreen.classList.contains("hidden") || !button.disabled) return;
    restoreButton();
    status.className = "auth-error";
    status.textContent = "Google sign-in did not open. Check your connection and try again.";
  }, 15000);
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    if (error) throw error;
  } catch (error) {
    window.clearTimeout(redirectWait);
    restoreButton();
    status.className = "auth-error";
    status.textContent = error.message || "Could not start Google sign-in. Please try again.";
  }
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
  contactsCache = contactsCache.map((member) => member.id === update.userId ? { ...member, avatar: update.avatar || member.avatar } : member);
  conversationCache = conversationCache.map((item) => item.userId === update.userId ? { ...item, avatar: update.avatar || item.avatar } : item);
  if (currentDirectUser?.id === update.userId) currentDirectUser.avatar = update.avatar || currentDirectUser.avatar;
  myGroups = myGroups.map((group) => ({ ...group, members: (group.members || []).map((member) => member.id === update.userId ? { ...member, avatar: update.avatar || member.avatar } : member) }));
  if (update.userId === currentUserId && currentProfile) {
    currentProfile.avatar = update.avatar || currentProfile.googleAvatar;
    currentProfile.avatarId = update.avatar?.match(/avatar-(\d+)\.svg$/)?.[0]?.replace(".svg", "") || "";
    updateProfilePanel();
  }
  renderMessages();
  renderConversationList();
  if (!$("contacts-section").classList.contains("hidden")) renderContacts();
  updateDetailsPanel();
});
$("profile-btn").addEventListener("click", () => { markAppPageActive("settings"); updateProfilePanel(); $("settings-status").textContent = ""; $("settings-modal").classList.remove("hidden"); });
function closeSettings() {
  $("settings-modal").classList.add("hidden");
  markAppPageActive("messages");
}
$("settings-close").addEventListener("click", closeSettings);
$("settings-modal").addEventListener("click", (event) => { if (event.target === $("settings-modal")) closeSettings(); });
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
  conversationCache = conversationCache.map((item) => {
    const online = onlineUserCache.find((member) => member.id === item.userId);
    return online ? { ...item, avatar: online.avatar || item.avatar } : item;
  });
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
      setAppPage("messages");
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
  renderConversationList();
  if (!$("contacts-section").classList.contains("hidden")) renderContacts();
  if (!$("games-section").classList.contains("hidden") && !currentDirectUser) renderGamesView();
});

function renderContacts() {
  const list = $("contacts-list");
  const query = $("contacts-filter").value.trim().toLocaleLowerCase();
  const onlineById = new Map(onlineUserCache.map((person) => [person.id, person]));
  const contacts = contactsCache.filter((person) => person.name.toLocaleLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name));
  list.replaceChildren();
  if (!contacts.length) {
    const empty = document.createElement("p");
    empty.className = "contacts-empty";
    empty.textContent = query ? "No contacts match that name." : "No contacts to show yet.";
    list.append(empty);
    return;
  }
  const byInitial = new Map();
  contacts.forEach((person) => {
    const initial = person.name.trim().charAt(0).toLocaleUpperCase() || "#";
    if (!byInitial.has(initial)) byInitial.set(initial, []);
    byInitial.get(initial).push(person);
  });
  [...byInitial.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([initial, people]) => {
    const section = document.createElement("section");
    section.className = "contact-letter-group";
    const heading = document.createElement("h2");
    heading.textContent = initial;
    section.append(heading);
    people.forEach((person) => {
      const online = onlineById.get(person.id);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "contact-row";
      row.append(createAvatar(person.name, online?.avatar || person.avatar, "avatar contact-avatar"));
      const info = document.createElement("span");
      info.className = "contact-info";
      const name = document.createElement("strong");
      name.textContent = person.name;
      const status = document.createElement("small");
      status.textContent = online ? "Available now" : "Chatly contact";
      info.append(name, status);
      const statusDot = document.createElement("span");
      statusDot.className = online ? "contact-online" : "contact-offline";
      statusDot.setAttribute("aria-label", online ? "Online" : "Offline");
      row.append(info, statusDot);
      row.addEventListener("click", () => {
        setAppPage("messages");
        socket.emit("open direct", person.id);
      });
      section.append(row);
    });
    list.append(section);
  });
}
async function loadContacts() {
  if (!authToken) return;
  try {
    const response = await fetch("/api/group-members", { headers: { Authorization: `Bearer ${authToken}` } });
    const members = await response.json();
    if (!response.ok) throw new Error(members.error || "Could not load contacts.");
    contactsCache = members;
    renderContacts();
  } catch (error) {
    $("contacts-list").textContent = error.message;
  }
}
function markAppPageActive(page) {
  document.querySelectorAll("[data-page]").forEach((button) => {
    const active = button.dataset.page === page;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
}
function setAppPage(page) {
  markAppPageActive(page);
  sidebar.classList.remove("open");
  if (page === "contacts") {
    closeGamesSection();
    $("conversation-view").classList.add("hidden");
    $("contacts-section").classList.remove("hidden");
    loadContacts();
  } else if (page === "messages") {
    closeGamesSection();
    $("contacts-section").classList.add("hidden");
    $("conversation-view").classList.remove("hidden");
  } else if (page === "aura") {
    setAppPage("messages");
    markAppPageActive("aura");
    openAuraPanel();
  } else if (page === "settings") {
    setAppPage("messages");
    markAppPageActive("settings");
    updateProfilePanel();
    $("settings-status").textContent = "";
    $("settings-modal").classList.remove("hidden");
  }
}
document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => setAppPage(button.dataset.page)));
$("contacts-filter").addEventListener("input", renderContacts);
$("focus-toggle").addEventListener("click", () => setFocusMode(!isFocusModeActive()));
$("settings-focus-toggle").addEventListener("click", () => setFocusMode(!isFocusModeActive()));
$("settings-aura-open").addEventListener("click", () => {
  $("settings-modal").classList.add("hidden");
  setAppPage("aura");
});

function openConversationResult(conversation) {
  setAppPage("messages");
  const roomButton = [...document.querySelectorAll(".room-button[data-room]")].find((button) => button.dataset.room === conversation);
  if (roomButton) return roomButton.click();
  if (conversation.startsWith("group:")) {
    const group = myGroups.find((item) => item.id === conversation.slice(6));
    if (group) return openGroup(group);
  }
  if (conversation.startsWith("dm:")) {
    const peerId = conversation.slice(3).split(":").find((id) => id !== currentUserId);
    if (peerId) socket.emit("open direct", peerId);
  }
}
function sidebarTime(time) {
  if (!time) return "";
  const date = new Date(time);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function addConversationSection(root, title, items) {
  if (!items.length) return;
  const section = document.createElement("section");
  section.className = "conversation-list-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "conversation-item" + (item.id === currentConversation ? " active" : "");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "conversation-open";
    open.setAttribute("aria-label", `Open ${item.name} conversation`);
    open.append(createAvatar(item.name, item.avatar, "avatar conversation-list-avatar"));
    const details = document.createElement("span");
    details.className = "conversation-list-copy";
    const top = document.createElement("span");
    top.className = "conversation-list-top";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const time = document.createElement("time");
    time.textContent = sidebarTime(item.lastMessage?.time);
    const preview = document.createElement("small");
    preview.textContent = item.lastMessage?.text || (item.type === "room" ? "Start a conversation" : item.type === "group" ? "Group conversation" : "Open direct message");
    top.append(name, time);
    details.append(top, preview);
    open.append(details);
    open.addEventListener("click", () => openConversationResult(item.id));
    const count = unreadByConversation.get(item.id) || 0;
    if (count) {
      const badge = document.createElement("span");
      badge.className = "conversation-unread";
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.setAttribute("aria-label", `${count} unread`);
      open.append(badge);
    }
    const pin = document.createElement("button");
    pin.type = "button";
    const isPinned = pinnedConversationIds.includes(item.id);
    pin.className = "conversation-pin" + (isPinned ? " pinned" : "");
    pin.textContent = isPinned ? "★" : "☆";
    pin.setAttribute("aria-label", isPinned ? `Unpin ${item.name}` : `Pin ${item.name}`);
    pin.setAttribute("aria-pressed", String(isPinned));
    pin.addEventListener("click", (event) => {
      event.stopPropagation();
      pinnedConversationIds = isPinned ? pinnedConversationIds.filter((id) => id !== item.id) : [...pinnedConversationIds, item.id];
      try { localStorage.setItem("chatly-pinned-conversations", JSON.stringify(pinnedConversationIds)); } catch {}
      renderConversationList();
    });
    row.append(open, pin);
    section.append(row);
  });
  root.append(section);
}
function renderConversationList() {
  const root = $("conversation-list");
  if (!root) return;
  root.replaceChildren();
  const filtered = conversationCache.filter((item) => activeInboxFilter === "all"
    || (activeInboxFilter === "unread" && (unreadByConversation.get(item.id) || 0) > 0)
    || (activeInboxFilter === "groups" && item.type === "group"));
  const pinned = filtered.filter((item) => pinnedConversationIds.includes(item.id));
  const others = filtered.filter((item) => !pinnedConversationIds.includes(item.id));
  addConversationSection(root, "Pinned", pinned);
  addConversationSection(root, activeInboxFilter === "groups" ? "Groups" : "All", others);
  if (!root.children.length) {
    const empty = document.createElement("p");
    empty.className = "conversation-empty";
    empty.textContent = activeInboxFilter === "unread" ? "You’re all caught up." : activeInboxFilter === "groups" ? "No groups yet." : "Your conversations will appear here.";
    root.append(empty);
  }
}
async function loadConversations() {
  if (!authToken) return;
  try {
    const response = await fetch("/api/conversations", { headers: { Authorization: `Bearer ${authToken}` } });
    const items = await response.json();
    if (!response.ok) throw new Error(items.error || "Could not load conversations.");
    conversationCache = items;
    renderConversationList();
  } catch (error) {
    $("conversation-list").textContent = error.message;
  }
}
function updateConversationPreview(message) {
  const listedConversation = conversationCache.find((item) => item.id === message.conversation);
  if (!listedConversation) return loadConversations();
  if (!listedConversation.lastMessage || message.time >= listedConversation.lastMessage.time) {
    listedConversation.lastMessage = { text: message.text || message.attachment?.name || "Shared an attachment", time: message.time, sender: message.user };
  }
  conversationCache.sort((a, b) => (b.lastMessage?.time || 0) - (a.lastMessage?.time || 0) || a.name.localeCompare(b.name));
  renderConversationList();
}
function markConversationUnread(conversation) {
  unreadByConversation.set(conversation, (unreadByConversation.get(conversation) || 0) + 1);
  renderConversationList();
}
function clearConversationUnread(conversation) {
  unreadByConversation.delete(conversation);
  renderConversationList();
}
document.querySelectorAll("[data-inbox-filter]").forEach((button) => button.addEventListener("click", () => {
  activeInboxFilter = button.dataset.inboxFilter;
  document.querySelectorAll("[data-inbox-filter]").forEach((tab) => {
    const active = tab === button;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  renderConversationList();
}));
function addSearchResultGroup(root, title, items, labelFor, activate) {
  if (!items.length) return;
  const section = document.createElement("section");
  section.className = "search-result-group";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result-row";
    const label = labelFor(item);
    const primary = document.createElement("strong");
    primary.textContent = label.primary;
    const secondary = document.createElement("small");
    secondary.textContent = label.secondary;
    button.append(primary, secondary);
    button.addEventListener("click", () => activate(item));
    section.append(button);
  });
  root.append(section);
}
function renderGlobalSearch(data) {
  const root = $("global-search-results");
  root.replaceChildren();
  addSearchResultGroup(root, "PEOPLE", data.people, (person) => ({ primary: person.name, secondary: "Open a direct conversation" }), (person) => {
    $("global-search-modal").classList.add("hidden");
    setAppPage("messages");
    socket.emit("open direct", person.id);
  });
  addSearchResultGroup(root, "MESSAGES", data.messages, (message) => ({ primary: message.user, secondary: message.text || message.attachment?.name || "Shared a file" }), (message) => {
    $("global-search-modal").classList.add("hidden");
    openConversationResult(message.conversation);
  });
  addSearchResultGroup(root, "FILES", data.files, (file) => ({ primary: file.attachment?.name || "Shared file", secondary: `${file.user} · ${new Date(file.time).toLocaleDateString()}` }), (file) => {
    $("global-search-modal").classList.add("hidden");
    openConversationResult(file.conversation);
  });
  addSearchResultGroup(root, "LINKS", data.links, (link) => ({ primary: link.url, secondary: `${link.user} · ${new Date(link.time).toLocaleDateString()}` }), (link) => {
    $("global-search-modal").classList.add("hidden");
    openConversationResult(link.conversation);
    try {
      const url = new URL(link.url);
      if (url.protocol === "https:" || url.protocol === "http:") window.open(url.href, "_blank", "noopener,noreferrer");
    } catch {}
  });
  if (!root.children.length) {
    const empty = document.createElement("p");
    empty.className = "search-empty";
    empty.textContent = "No matches found.";
    root.append(empty);
  }
}
async function searchChatly(query) {
  const sequence = ++globalSearchSequence;
  const root = $("global-search-results");
  if (query.trim().length < 2) {
    root.innerHTML = '<p class="search-empty">Enter at least two characters to search.</p>';
    return;
  }
  root.innerHTML = '<p class="search-empty">Searching your conversations…</p>';
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { headers: { Authorization: `Bearer ${authToken}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Search is unavailable.");
    if (sequence === globalSearchSequence) renderGlobalSearch(data);
  } catch (error) {
    if (sequence === globalSearchSequence) root.textContent = error.message;
  }
}
function openGlobalSearch() {
  $("global-search-modal").classList.remove("hidden");
  $("global-search-input").focus();
}
function closeGlobalSearch() { $("global-search-modal").classList.add("hidden"); }
$("global-search-open").addEventListener("click", openGlobalSearch);
$("sidebar-search-btn").addEventListener("click", openGlobalSearch);
$("global-search-close").addEventListener("click", closeGlobalSearch);
$("global-search-modal").addEventListener("click", (event) => { if (event.target === $("global-search-modal")) closeGlobalSearch(); });
$("global-search-input").addEventListener("input", () => {
  clearTimeout(globalSearchTimer);
  globalSearchTimer = setTimeout(() => searchChatly($("global-search-input").value), 220);
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openGlobalSearch();
  }
  if (event.key === "Escape") closeGlobalSearch();
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
  if (window.innerWidth > 900) $("chat").classList.toggle("details-open");
  else $("details-panel").classList.add("open");
});
$("conversation-details-btn").addEventListener("click", () => {
  if (window.innerWidth > 900) $("chat").classList.toggle("details-open");
  else $("details-panel").classList.add("open");
});
$("details-close").addEventListener("click", () => {
  if (window.innerWidth > 900) $("chat").classList.remove("details-open");
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
  const resolved = theme === "system" ? (window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = theme;
  $("theme-btn").textContent = resolved === "dark" ? "☀️" : "☾";
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const active = button.dataset.themeChoice === theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  try { localStorage.setItem("chatly-theme-v2", theme); } catch (e) {}
}
let saved = "light";
try { saved = localStorage.getItem("chatly-theme-v2") || saved; } catch (e) {}
setTheme(saved);
$("theme-btn").addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});
document.querySelectorAll("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => setTheme(button.dataset.themeChoice)));
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (document.documentElement.dataset.themePreference === "system") setTheme("system");
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
  showCall("Waiting for device access…");
  requestMediaPermission({
    kind: "call", video,
    onGranted: (stream) => placeOutgoingCall(stream, callId),
    onCancel: () => endCall("cancelled", false)
  });
}
async function placeOutgoingCall(stream, callId) {
  if (!activeCall || activeCall.callId !== callId) { stream.getTracks().forEach((track) => track.stop()); return; }
  const video = activeCall.video;
  try {
    localCallStream = stream;
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
  } catch {
    addSystemMessage("Could not start the call. Check your microphone and camera, then try again.");
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
function acceptCall() {
  if (!activeCall || activeCall.initiator) return;
  const call = activeCall;
  $("incoming-call-actions").classList.add("hidden");
  requestMediaPermission({
    kind: "call", video: call.video,
    onGranted: (stream) => answerIncomingCall(call, stream),
    onCancel: () => { if (activeCall?.callId === call.callId) showCall(`Incoming ${call.video ? "video" : "voice"} call from ${call.peerName}`, true); }
  });
}
async function answerIncomingCall(call, stream) {
  if (!activeCall || activeCall.callId !== call.callId) { stream.getTracks().forEach((track) => track.stop()); return; }
  try {
    localCallStream = stream;
    $("local-video").srcObject = localCallStream;
    createPeerConnection();
    localCallStream.getTracks().forEach((track) => peerConnection.addTrack(track, localCallStream));
    await peerConnection.setRemoteDescription(call.offer);
    await flushIceCandidates();
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("call answer", { toId: call.peerId, callId: call.callId, answer });
    showCall(`Connecting to ${call.peerName}…`);
  } catch {
    addSystemMessage("Could not answer the call. Check your microphone and camera, then try again.");
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
  if (pendingMediaRequest?.kind === "call") {
    pendingMediaRequest = null;
    $("media-permission-modal").classList.add("hidden");
  }
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
  $("mute-call-btn").innerHTML = micIconSvg + ' <span>Mute</span>';
  $("mute-call-btn").setAttribute("aria-label", "Mute microphone");
  $("camera-call-btn").innerHTML = cameraIconSvg + ' <span>Camera off</span>';
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
  $("mute-call-btn").innerHTML = muted ? micIconSvg + ' <span>Unmute</span>' : micIconSvg + ' <span>Mute</span>';
  $("mute-call-btn").setAttribute("aria-label", muted ? "Unmute microphone" : "Mute microphone");
});
$("camera-call-btn").addEventListener("click", () => {
  const tracks = localCallStream?.getVideoTracks() || [];
  if (!tracks.length) return;
  const enabled = tracks[0].enabled;
  tracks.forEach((track) => { track.enabled = !enabled; });
  $("camera-call-btn").innerHTML = enabled ? cameraIconSvg + ' <span>Camera on</span>' : cameraIconSvg + ' <span>Camera off</span>';
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
