import { sb } from "../shared/supabase.js";

let currentUser = null;
let selectedUser = null;
let messages = [];

const COLORS = [
  "#7b61ff",
  "#f97316",
  "#06b6d4",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#6366f1",
];
function getColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}
function initials(email) {
  return email ? email.substring(0, 2).toUpperCase() : "??";
}
function timeStr(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const { data } = await sb.auth.getUser();
  if (!data.user) {
    window.location.href = "../auth/auth.html";
    return;
  }
  currentUser = data.user;

  document.getElementById("meEmail").textContent = currentUser.email;
  document.getElementById("meAvatar").textContent = initials(currentUser.email);

  document.getElementById("msgInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  loadUsers();
  subscribeToMessages();
});

async function loadUsers() {
  const { data } = await sb.from("profiles").select("*");
  const container = document.getElementById("users");

  container.innerHTML = data
    .filter((u) => u.id !== currentUser.id)
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

window.selectUser = async function (id, email) {
  selectedUser = id;
  closeSidebar();

  // Mark active
  document
    .querySelectorAll(".user")
    .forEach((el) => el.classList.remove("active"));
  document.getElementById(`user-${id}`)?.classList.add("active");

  // Show chat
  document.getElementById("emptyState").style.display = "none";
  const activeChat = document.getElementById("activeChat");
  activeChat.style.display = "flex";

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
      `and(sender_id.eq.${currentUser.id},receiver_id.eq.${id}),and(sender_id.eq.${id},receiver_id.eq.${currentUser.id})`,
    )
    .order("created_at");

  if (error) {
    console.error(error);
    return;
  }

  messages = data || [];
  renderMessages();
  scrollToBottom();
};

window.sendMessage = async function () {
  const input = document.getElementById("msgInput");
  const content = input.value.trim();
  if (!content || !selectedUser) return;

  input.value = "";

  const { data, error } = await sb
    .from("messages")
    .insert({ sender_id: currentUser.id, receiver_id: selectedUser, content })
    .select()
    .single();

  if (error) {
    console.error(error);
    input.value = content;
    return;
  }

  messages.push(data);
  renderMessages();
  scrollToBottom();
};

function renderMessages() {
  const container = document.getElementById("messages");
  container.innerHTML = messages
    .map((m) => {
      const isMine = m.sender_id === currentUser.id;
      const color = isMine ? "var(--accent)" : getColor(m.sender_id);
      const ini = isMine
        ? initials(currentUser.email)
        : initials(document.getElementById("chatName")?.textContent || "");
      return `
      <div class="msg-row ${isMine ? "mine" : ""}">
        <div class="msg-avatar" style="background:${color}22;color:${color}">${ini}</div>
        <div>
          <div class="msg-bubble">${escapeHtml(m.content)}</div>
          <div class="msg-time">${timeStr(m.created_at)}</div>
        </div>
      </div>
    `;
    })
    .join("");
}

function scrollToBottom() {
  const c = document.getElementById("messages");
  if (c) c.scrollTop = c.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function subscribeToMessages() {
  sb.channel("messages")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        const msg = payload.new;
        const isRelevant =
          (msg.sender_id === currentUser.id &&
            msg.receiver_id === selectedUser) ||
          (msg.sender_id === selectedUser &&
            msg.receiver_id === currentUser.id);
        if (!isRelevant) return;
        if (messages.some((m) => m.id === msg.id)) return;
        messages.push(msg);
        renderMessages();
        scrollToBottom();
      },
    )
    .subscribe();
}

window.handleLogout = async function () {
  await sb.auth.signOut();
  window.location.href = "../auth/auth.html";
};

// Mobile sidebar
window.openSidebar = function () {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebarOverlay").classList.add("visible");
};
window.closeSidebar = function () {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarOverlay").classList.remove("visible");
};
