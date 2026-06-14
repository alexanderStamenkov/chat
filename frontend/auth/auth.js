import {
  getSession,
  login,
  register,
  loginWithGoogle,
  upsertProfile,
} from "../shared/api.js";
import { showToast } from "../shared/toast.js";

let currentTab = "login";

document.addEventListener("DOMContentLoaded", async () => {
  const { data } = await getSession();
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

  if (!isValidEmail(email)) {
    showToast("error", "Невалиден имейл", "Провери формата на имейла");
    return;
  }

  btn.classList.add("loading");
  const { data, error } = await login(email, password);
  btn.classList.remove("loading");

  if (error) {
    showToast("error", "Грешка при вход", error.message);
    return;
  }

  await upsertProfile(data.user.id, data.user.email);

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

  if (!isValidEmail(email)) {
    showToast("error", "Невалиден имейл", "Провери формата на имейла");
    return;
  }

  if (password.length < 6) {
    showToast("error", "Паролата е кратка", "Минимум 6 символа");
    return;
  }

  btn.classList.add("loading");
  const { error } = await register(email, password);
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
  const { error } = await loginWithGoogle(
    window.location.origin + "/chat/chat.html",
  );
  if (error) showToast("error", "Грешка", error.message);
};

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
