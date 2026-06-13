import { sb } from "../shared/supabase.js";
import { state } from "../shared/state.js";
import { getColor, initials, timeStr, escapeHtml } from "../shared/utils.js";
import { createPicker } from "picmo";

// ── Emoji picker ──────────────────────────────────────────────
let pickerInstance = null;
let pickerVisible = false;

function initEmojiPicker() {
  const container = document.getElementById("picker-container");
  const trigger = document.getElementById("emoji-btn");

  pickerInstance = createPicker({ rootElement: container });

  pickerInstance.addEventListener("emoji:select", (e) => {
    const input = document.getElementById("msgInput");
    input.value += e.emoji;
    input.focus();
    // togglePicker(false);
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
  const container = document.getElementById("picker-container");
  container.classList.toggle("open", show);
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const { data } = await sb.auth.getUser();
  if (!data.user) {
    window.location.href = "../auth/auth.html";
    return;
  }

  state.currentUser = data.user;
  document.getElementById("meEmail").textContent = state.currentUser.email;
  document.getElementById("meAvatar").textContent = initials(
    state.currentUser.email,
  );

  document.getElementById("msgInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  initEmojiPicker();
  loadUsers();
  subscribeToMessages();
});

// ── Users ─────────────────────────────────────────────────────
async function loadUsers() {
  const { data } = await sb.from("profiles").select("*");
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
window.selectUser = async function (id, email) {
  state.selectedUser = id;
  closeSidebar();
  togglePicker(false);

  document
    .querySelectorAll(".user")
    .forEach((el) => el.classList.remove("active"));
  document.getElementById(`user-${id}`)?.classList.add("active");

  document.getElementById("emptyState").style.display = "none";
  document.getElementById("activeChat").style.display = "flex";

  const color = getColor(id);
  const av = document.getElementById("chatAvatar");
  av.textContent = initials(email);
  av.style.background = color + "22";
  av.style.color = color;
  document.getElementById("chatName").textContent = email;

  const { data, error } = await sb
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${state.currentUser.id},receiver_id.eq.${id}),and(sender_id.eq.${id},receiver_id.eq.${state.currentUser.id})`,
    )
    .order("created_at");

  if (error) {
    console.error(error);
    return;
  }

  state.messages = data || [];
  renderMessages();
  requestAnimationFrame(() => scrollToBottom());
};

// ── Send message ──────────────────────────────────────────────
window.sendMessage = async function () {
  const input = document.getElementById("msgInput");
  const content = input.value.trim();
  if (!content || !state.selectedUser) return;

  input.value = "";

  const { data, error } = await sb
    .from("messages")
    .insert({
      sender_id: state.currentUser.id,
      receiver_id: state.selectedUser,
      content,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
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
  const imgBtn = document.querySelector(".img-btn");
  imgBtn.classList.add("loading");

  const ext = file.name.split(".").pop();
  const path = `${state.currentUser.id}/${Date.now()}.${ext}`;

  const { error: uploadError } = await sb.storage
    .from("chat-images")
    .upload(path, file, { contentType: file.type });

  if (uploadError) {
    console.error(uploadError);
    imgBtn.classList.remove("loading");
    return;
  }

  const { data: urlData } = sb.storage.from("chat-images").getPublicUrl(path);

  const { data, error } = await sb
    .from("messages")
    .insert({
      sender_id: state.currentUser.id,
      receiver_id: state.selectedUser,
      content: null,
      image_url: urlData.publicUrl,
    })
    .select()
    .single();

  imgBtn.classList.remove("loading");
  if (error) {
    console.error(error);
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

// ── Realtime ──────────────────────────────────────────────────
function subscribeToMessages() {
  sb.channel("messages")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        const msg = payload.new;
        const isRelevant =
          (msg.sender_id === state.currentUser.id &&
            msg.receiver_id === state.selectedUser) ||
          (msg.sender_id === state.selectedUser &&
            msg.receiver_id === state.currentUser.id);
        if (!isRelevant) return;
        if (state.messages.some((m) => m.id === msg.id)) return;
        state.messages.push(msg);
        renderMessages();
        requestAnimationFrame(() => scrollToBottom());
      },
    )
    .subscribe();
}

// ── Auth ──────────────────────────────────────────────────────
window.handleLogout = async function () {
  await sb.auth.signOut();
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
