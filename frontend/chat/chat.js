import { sb } from "../shared/supabase.js";
import { state } from "../shared/state.js";
import { getColor, initials, timeStr, escapeHtml } from "../shared/utils.js";
import { showToast } from "../shared/toast.js";
import {
  getUser,
  logout,
  getFriends,
  getPendingInvites,
  sendFriendRequest,
  respondToFriendRequest,
  searchProfiles,
  subscribeToFriendRequests,
  getMessages,
  sendMessage,
  sendImageMessage,
  uploadImage,
  subscribeToConversation,
  unsubscribe,
} from "../shared/api.js";
import { createPicker } from "picmo";

// ── Emoji picker ──────────────────────────────────────────────
let pickerVisible = false;

function initEmojiPicker() {
  const container = document.getElementById("picker-container");
  const trigger = document.getElementById("emoji-btn");
  const picker = createPicker({ rootElement: container });

  picker.addEventListener("emoji:select", (e) => {
    const input = document.getElementById("msgInput");
    input.value += e.emoji;
    input.focus();
  });

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePicker(!pickerVisible);
  });

  document.addEventListener("click", (e) => {
    if (
      pickerVisible &&
      !container.contains(e.target) &&
      e.target !== trigger
    ) {
      togglePicker(false);
    }
  });
}

function togglePicker(show) {
  pickerVisible = show;
  document.getElementById("picker-container").classList.toggle("open", show);
}

// ── Typing indicator ──────────────────────────────────────────
let typingChannel = null;
let typingTimeout = null;

function initTypingIndicator(me, other) {
  unsubscribe(typingChannel);
  const id = [me, other].sort().join("-");
  typingChannel = sb.channel(`typing:${id}`, {
    config: { broadcast: { self: false } },
  });

  typingChannel
    .on("broadcast", { event: "typing" }, (payload) => {
      if (payload.payload.userId !== other) return;
      const isTyping = payload.payload.typing === true;
      document.getElementById("typingIndicator").style.display = isTyping
        ? "flex"
        : "none";
      if (isTyping) scrollToBottom();
    })
    .subscribe();
}

function trackTyping(typing) {
  if (!typingChannel || !state.currentUser) return;
  typingChannel.send({
    type: "broadcast",
    event: "typing",
    payload: { userId: state.currentUser.id, typing },
  });
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const { data } = await getUser();
  if (!data.user) {
    window.location.href = "../auth/auth.html";
    return;
  }

  state.currentUser = data.user;
  document.getElementById("meEmail").textContent = state.currentUser.email;
  document.getElementById("meAvatar").textContent = initials(
    state.currentUser.email,
  );

  const msgInput = document.getElementById("msgInput");
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      window.sendMessage();
    }
  });
  msgInput.addEventListener("input", () => {
    trackTyping(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => trackTyping(false), 1500);
  });

  initEmojiPicker();
  loadFriends();
  loadPendingInvites();
  subscribeToFriendRequests(state.currentUser.id, onNewFriendRequest);
});

// ── Friends ───────────────────────────────────────────────────
async function loadFriends() {
  const { data, error } = await getFriends(state.currentUser.id);
  if (error) {
    showToast("error", "Грешка", "Не можах да заредя приятелите");
    return;
  }

  const container = document.getElementById("users");
  if (!data.length) {
    container.innerHTML = `<div class="no-friends">Нямаш приятели още.<br/>Добави някого с бутона +</div>`;
    return;
  }

  container.innerHTML = data
    .map((f) => {
      const friend =
        f.sender_id === state.currentUser.id ? f.receiver : f.sender;
      const color = getColor(friend.id);
      return `
      <div class="user" id="user-${friend.id}" onclick="selectUser('${friend.id}','${friend.email}')">
        <div class="user-avatar" style="background:${color}22;color:${color}">${initials(friend.email)}</div>
        <div class="user-info">
          <div class="user-name">${friend.email}</div>
          <div class="user-hint">Натисни за чат</div>
        </div>
      </div>
    `;
    })
    .join("");
}

// ── Pending invites ───────────────────────────────────────────
async function loadPendingInvites() {
  const { data, error } = await getPendingInvites(state.currentUser.id);
  if (error) return;

  const badge = document.getElementById("inviteBadge");
  badge.style.display = data.length ? "flex" : "none";
  badge.textContent = data.length;

  const list = document.getElementById("inviteList");
  if (!data.length) {
    list.innerHTML = `<div class="no-invites">Няма чакащи покани</div>`;
    return;
  }

  list.innerHTML = data
    .map(
      (f) => `
    <div class="invite-item">
      <div class="invite-avatar" style="background:${getColor(f.sender.id)}22;color:${getColor(f.sender.id)}">${initials(f.sender.email)}</div>
      <div class="invite-email">${f.sender.email}</div>
      <div class="invite-actions">
        <button class="btn-accept" onclick="acceptInvite('${f.id}')">✓</button>
        <button class="btn-decline" onclick="declineInvite('${f.id}')">✕</button>
      </div>
    </div>
  `,
    )
    .join("");
}

function onNewFriendRequest(request) {
  showToast("info", "Нова покана!", `Получи покана за приятелство`);
  loadPendingInvites();
}

window.acceptInvite = async function (id) {
  const { error } = await respondToFriendRequest(id, "accepted");
  if (error) {
    showToast("error", "Грешка", "Не можах да приема поканата");
    return;
  }
  showToast("success", "Приятел добавен!", "");
  loadPendingInvites();
  loadFriends();
};

window.declineInvite = async function (id) {
  const { error } = await respondToFriendRequest(id, "declined");
  if (error) {
    showToast("error", "Грешка", "Не можах да откажа поканата");
    return;
  }
  loadPendingInvites();
};

// ── Add friend ────────────────────────────────────────────────
let searchTimeout = null;

window.toggleAddFriend = function () {
  const panel = document.getElementById("addFriendPanel");
  const isOpen = panel.style.display !== "none";
  panel.style.display = isOpen ? "none" : "block";
  document.getElementById("invitePanel").style.display = "none";
  if (!isOpen) document.getElementById("friendSearch").focus();
};

window.toggleInvitePanel = function () {
  const panel = document.getElementById("invitePanel");
  const isOpen = panel.style.display !== "none";
  panel.style.display = isOpen ? "none" : "block";
  document.getElementById("addFriendPanel").style.display = "none";
};

window.searchFriends = function (value) {
  clearTimeout(searchTimeout);
  if (!value.trim()) {
    document.getElementById("searchResults").innerHTML = "";
    return;
  }
  searchTimeout = setTimeout(() => doSearch(value), 300);
};

async function doSearch(email) {
  const { data, error } = await searchProfiles(email, state.currentUser.id);
  const container = document.getElementById("searchResults");

  if (error || !data.length) {
    container.innerHTML = `<div class="no-results">Няма резултати</div>`;
    return;
  }

  container.innerHTML = data
    .map(
      (u) => `
    <div class="search-result">
      <div class="user-avatar" style="background:${getColor(u.id)}22;color:${getColor(u.id)};width:30px;height:30px;font-size:11px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:Syne,sans-serif;font-weight:700;flex-shrink:0">${initials(u.email)}</div>
      <div class="search-result-email">${u.email}</div>
      <button class="btn-add-friend" onclick="addFriend('${u.id}')">+</button>
    </div>
  `,
    )
    .join("");
}

window.addFriend = async function (receiverId) {
  const { error } = await sendFriendRequest(state.currentUser.id, receiverId);
  if (error) {
    showToast("error", "Грешка", "Не можах да изпратя покана");
    return;
  }
  showToast("success", "Поканата е изпратена!", "");
  document.getElementById("addFriendPanel").style.display = "none";
  document.getElementById("friendSearch").value = "";
  document.getElementById("searchResults").innerHTML = "";
};

// ── Select user ───────────────────────────────────────────────
let activeChannel = null;

window.selectUser = async function (id, email) {
  unsubscribe(activeChannel);
  activeChannel = null;

  state.selectedUser = id;
  closeSidebar();
  togglePicker(false);

  document
    .querySelectorAll(".user")
    .forEach((el) => el.classList.remove("active"));
  document.getElementById(`user-${id}`)?.classList.add("active");

  document.getElementById("emptyState").style.display = "none";
  document.getElementById("activeChat").style.display = "flex";
  document.getElementById("typingIndicator").style.display = "none";

  const color = getColor(id);
  const av = document.getElementById("chatAvatar");
  av.textContent = initials(email);
  av.style.background = color + "22";
  av.style.color = color;
  document.getElementById("chatName").textContent = email;

  const { data, error } = await getMessages(state.currentUser.id, id);
  if (error) {
    showToast("error", "Грешка", "Не можах да заредя съобщенията");
    return;
  }

  state.messages = data || [];
  renderMessages();
  requestAnimationFrame(() => scrollToBottom());

  activeChannel = subscribeToConversation(state.currentUser.id, id, (msg) => {
    if (state.messages.some((m) => m.id === msg.id)) return;
    state.messages.push(msg);
    renderMessages();
    requestAnimationFrame(() => scrollToBottom());
  });

  initTypingIndicator(state.currentUser.id, id);
};

// ── Send message ──────────────────────────────────────────────
window.sendMessage = async function () {
  const input = document.getElementById("msgInput");
  const content = input.value.trim();
  if (!content || !state.selectedUser) return;

  input.value = "";
  trackTyping(false);
  clearTimeout(typingTimeout);

  const { data, error } = await sendMessage(
    state.currentUser.id,
    state.selectedUser,
    content,
  );
  if (error) {
    showToast("error", "Грешка", "Съобщението не беше изпратено");
    input.value = content;
    return;
  }

  state.messages.push(data);
  renderMessages();
  scrollToBottom();
};

// ── Image upload ──────────────────────────────────────────────
window.handleImageUpload = async function (event) {
  const file = event.target.files[0];
  if (!file || !state.selectedUser) return;
  event.target.value = "";

  if (file.size > 5 * 1024 * 1024) {
    showToast("error", "Файлът е твърде голям", "Максимум 5MB");
    return;
  }

  const imgBtn = document.querySelector(".img-btn");
  imgBtn.classList.add("loading");

  const { url, error: uploadError } = await uploadImage(
    state.currentUser.id,
    file,
  );
  if (uploadError) {
    showToast("error", "Грешка при качване", "Снимката не беше качена");
    imgBtn.classList.remove("loading");
    return;
  }

  const { data, error } = await sendImageMessage(
    state.currentUser.id,
    state.selectedUser,
    url,
  );
  imgBtn.classList.remove("loading");
  if (error) {
    showToast("error", "Грешка", "Съобщението не беше записано");
    return;
  }

  state.messages.push(data);
  renderMessages();
  scrollToBottom();
};

// ── Render ────────────────────────────────────────────────────
function renderMessages() {
  const container = document.getElementById("messages");
  const chatName = document.getElementById("chatName")?.textContent || "";

  container.innerHTML = state.messages
    .map((m) => {
      const isMine = m.sender_id === state.currentUser.id;
      const color = isMine ? "var(--accent)" : getColor(m.sender_id);
      const ini = isMine
        ? initials(state.currentUser.email)
        : initials(chatName);
      const bubbleContent = m.image_url
        ? `<img src="${m.image_url}" class="msg-image" onclick="openImage('${m.image_url}')" />`
        : escapeHtml(m.content || "");

      return `
      <div class="msg-row ${isMine ? "mine" : ""}">
        <div class="msg-avatar" style="background:${color}22;color:${color}">${ini}</div>
        <div>
          <div class="msg-bubble ${m.image_url ? "image-bubble" : ""}">${bubbleContent}</div>
          <div class="msg-time">${timeStr(m.created_at)}</div>
        </div>
      </div>
    `;
    })
    .join("");
}

window.openImage = (url) => window.open(url, "_blank");

function scrollToBottom() {
  const c = document.getElementById("messages");
  if (c) c.scrollTop = c.scrollHeight;
}

// ── Auth ──────────────────────────────────────────────────────
window.handleLogout = async function () {
  const { error } = await logout();
  if (error) {
    showToast("error", "Грешка", "Не можах да те изпиша");
    return;
  }
  window.location.href = "../auth/auth.html";
};

// ── Mobile sidebar ────────────────────────────────────────────
window.openSidebar = function () {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebarOverlay").classList.add("visible");
};
window.closeSidebar = function () {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarOverlay").classList.remove("visible");
};
