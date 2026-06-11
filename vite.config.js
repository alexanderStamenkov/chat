import { defineConfig } from "vite";

console.log("=== NETLIFY ENV DEBUGGER ===");
console.log("Netlify URL:", process.env.VITE_SUPABASE_URL);
console.log("=============================");

export default defineConfig({
  // Без root: "frontend" – оставаме в главната папка CHAT
  build: {
    outDir: "dist", // Билдва директно в CHAT/dist
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: "index.html", // Намира се в CHAT/index.html
        auth: "frontend/auth/auth.html", // Намира се във frontend/auth/
        chat: "frontend/chat/chat.html", // Намира се във frontend/chat/
      },
    },
  },
});
