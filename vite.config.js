import { defineConfig } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: resolve(__dirname, "frontend"),
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
