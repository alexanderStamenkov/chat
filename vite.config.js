import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname, "frontend"),
  // ТОВА КАЗВА НА VITE ДА ТЪРСИ .ENV ФАЙЛОВЕТЕ В ГЛАВНАТА ПАПКА CHAT:
  envDir: resolve(__dirname),
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "frontend/index.html"),
        auth: resolve(__dirname, "frontend/auth/auth.html"),
        chat: resolve(__dirname, "frontend/chat/chat.html"),
      },
    },
  },
});
