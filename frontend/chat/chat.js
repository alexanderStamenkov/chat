import { sb } from "../shared/supabase.js";

let currentUser = null;
let selectedUser = null;
let messages = [];

document.addEventListener("DOMContentLoaded", async () => {
  const { data } = await sb.auth.getUser();

  if (!data.user) {
    window.location.href = "../auth/auth.html";
    return;
  }

  currentUser = data.user;

  // Enter за изпращане
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
    .map(
      (u) => `
      <div class="user" onclick="selectUser('${u.id}', '${u.email}')">
        ${u.email}
      </div>
    `,
    )
    .join("");
}

window.selectUser = async function (id, email) {
  selectedUser = id;
  document.getElementById("messages").innerHTML = "";

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
    .insert({
      sender_id: currentUser.id,
      receiver_id: selectedUser,
      content,
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    input.value = content; // върни текста ако е гръмнало
    return;
  }

  // добави веднага без да чакаме real-time
  messages.push(data);
  renderMessages();
  scrollToBottom();
};

function renderMessages() {
  const container = document.getElementById("messages");

  container.innerHTML = messages
    .map((m) => {
      const isMine = m.sender_id === currentUser.id;
      return `<div class="msg ${isMine ? "mine" : ""}">${m.content}</div>`;
    })
    .join("");
}

function scrollToBottom() {
  const container = document.getElementById("messages");
  container.scrollTop = container.scrollHeight;
}

function subscribeToMessages() {
  sb.channel("messages")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
      },
      (payload) => {
        const msg = payload.new;

        // само съобщения от активния разговор
        const isRelevant =
          (msg.sender_id === currentUser.id &&
            msg.receiver_id === selectedUser) ||
          (msg.sender_id === selectedUser &&
            msg.receiver_id === currentUser.id);

        if (!isRelevant) return;

        // не добавяй ако вече го има (пратено от нас)
        const exists = messages.some((m) => m.id === msg.id);
        if (exists) return;

        messages.push(msg);
        renderMessages();
        scrollToBottom();
      },
    )
    .subscribe();
}
