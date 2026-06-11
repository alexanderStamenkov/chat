import { sb } from "../shared/supabase.js";

let currentTab = "login";

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

  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password,
  });

  if (error) return alert(error.message);

  // гарантира profile ред дори ако trigger-ът е пропуснал
  await sb
    .from("profiles")
    .upsert({ id: data.user.id, email: data.user.email }, { onConflict: "id" });

  window.location.href = "../chat/chat.html";
};

window.handleRegister = async function () {
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPass").value;

  const { data, error } = await sb.auth.signUp({
    email,
    password,
  });

  if (error) return alert(error.message);

  // trigger-ът ще го направи, но upsert-ваме и тук за сигурност
  if (data.user) {
    await sb
      .from("profiles")
      .upsert(
        { id: data.user.id, email: data.user.email },
        { onConflict: "id" },
      );
  }

  alert("Провери имейла си за потвърждение");
};

window.handleOAuth = async function () {
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + "/chat/chat.html",
    },
  });

  if (error) alert(error.message);
};
