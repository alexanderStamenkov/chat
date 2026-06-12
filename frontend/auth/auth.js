import { sb } from "../shared/supabase.js";

let currentTab = "login";

// ── Toast system ──────────────────────────────────────────────
function showToast(type, title, msg) {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const icons = { success: "✓", error: "✕", info: "i" };
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || "i"}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${msg ? `<div class="toast-msg">${msg}</div>` : ""}
    </div>
    <button class="toast-close" onclick="this.closest('.toast').remove()">×</button>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("removing");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── Auth ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const { data } = await sb.auth.getSession();

  if (data.session) {
    window.location.href = "../chat/chat.html";
  }
});

window.switchTab = function (tab) {
  currentTab = tab;

  const isLogin = tab === "login";

  document.getElementById("loginForm").style.display = isLogin
    ? "block"
    : "none";
  document.getElementById("registerForm").style.display = isLogin
    ? "none"
    : "block";

  document.getElementById("tabLogin").classList.toggle("active", isLogin);
  document.getElementById("tabRegister").classList.toggle("active", !isLogin);
};

window.handleLogin = async function () {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPass").value;
  const btn = document.querySelector("#loginForm button");

  if (!email || !password) {
    showToast("error", "Грешка", "Попълни имейл и парола");
    return;
  }

  btn.classList.add("loading");
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.classList.remove("loading");

  if (error) {
    showToast("error", "Грешка при вход", error.message);
    return;
  }

  await sb
    .from("profiles")
    .upsert({ id: data.user.id, email: data.user.email }, { onConflict: "id" });

  showToast("success", "Добре дошъл!", "Влизаш в приложението...");
  setTimeout(() => {
    window.location.href = "../chat/chat.html";
  }, 800);
};

window.handleRegister = async function () {
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPass").value;
  const btn = document.querySelector("#registerForm button");

  if (!email || !password) {
    showToast("error", "Грешка", "Попълни имейл и парола");
    return;
  }
  if (password.length < 6) {
    showToast("error", "Паролата е кратка", "Минимум 6 символа");
    return;
  }

  btn.classList.add("loading");
  const { error } = await sb.auth.signUp({ email, password });
  btn.classList.remove("loading");

  if (error) {
    showToast("error", "Грешка при регистрация", error.message);
    return;
  }

  showToast(
    "success",
    "Акаунтът е създаден!",
    "Провери имейла си за потвърждение",
  );
};

window.handleOAuth = async function () {
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + "/chat/chat.html" },
  });
  if (error) showToast("error", "Грешка", error.message);
};
