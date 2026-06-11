import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  // Превръщаме пътя до frontend в абсолютен
  root: resolve(__dirname, "frontend"),
  build: {
    // Казваме на Vite да създаде dist директно в корена на главната папка Chat
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Абсолютни пътища до всеки един от HTML файловете ти
        main: resolve(__dirname, "frontend/index.html"),
        auth: resolve(__dirname, "frontend/auth/auth.html"),
        chat: resolve(__dirname, "frontend/chat/chat.html"),
      },
    },
  },
});
