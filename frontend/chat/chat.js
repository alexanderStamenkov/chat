import { sb } from "../shared/supabase.js";
import { state } from "../shared/state.js";
import { getColor, initials, timeStr, escapeHtml } from "../shared/utils.js";
import { showToast } from "../shared/toast.js";
import {
  getUser,
  logout,
  getProfiles,
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
  loadUsers();
});

// ── Users ─────────────────────────────────────────────────────
async function loadUsers() {
  const { data, error } = await getProfiles();

  if (error) {
    showToast("error", "Грешка", "Не можах да заредя потребителите");
    return;
  }

  const container = document.getElementById("users");
  container.innerHTML = data
    .filter((u) => u.id !== state.currentUser.id)
    .map((u) => {
      const color = getColor(u.id);
      return `
        <div class="user" id="user-${u.id}" onclick="selectUser('${u.id}','${u.email}')">
          <div class="user-avatar" style="background:${color}22;color:${color}">${initials(u.email)}</div>
          <div class="user-info">
            <div class="user-name">${u.email}</div>
            <div class="user-hint">Натисни за чат</div>
          </div>
        </div>
      `;
    })
    .join("");
}

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
