import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // loadEnv автоматично събира променливите от .env файловете И от системата на Netlify
  const env = loadEnv(mode, process.cwd(), "");

  console.log("=== NETLIFY ENV DEBUGGER ===");
  console.log("Netlify URL:", env.VITE_SUPABASE_URL);
  console.log("=============================");

  return {
    root: "frontend", // Тъй като index.html е вътре във frontend папка
    envDir: "../", // Търси локалните .env файлове една папка нагоре (в CHAT)
    build: {
      outDir: "../dist", // Създава папка dist в главната директория CHAT
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: "index.html", // Търси се в frontend/index.html
          auth: "auth/auth.html", // Търси се в frontend/auth/auth.html
          chat: "chat/chat.html", // Търси се в frontend/chat/chat.html
        },
      },
    },
  };
});
