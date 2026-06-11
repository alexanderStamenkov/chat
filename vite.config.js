import { defineConfig } from "vite";

// Този лог ще се появи в терминала на Netlify по време на билда!
console.log("=== NETLIFY ENV DEBBUGER ===");
console.log("Netlify URL:", process.env.VITE_SUPABASE_URL);
console.log("=============================");

export default defineConfig({
  root: "frontend",
  envDir: "../", // Търси локалния .env една папка нагоре (в CHAT)
  build: {
    outDir: "../dist", // Създава папка dist една папка нагоре (в CHAT)
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: "index.html", // Спрямо root (frontend/index.html)
        auth: "auth/auth.html", // Спрямо root (frontend/auth/auth.html)
        chat: "chat/chat.html", // Спрямо root (frontend/chat/chat.html)
      },
    },
  },
});
