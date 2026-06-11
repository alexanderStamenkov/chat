import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  envDir: path.resolve(__dirname),
  build: {
    outDir: "../dist",
    rollupOptions: {
      input: {
        main: "index.html",
        auth: "auth/auth.html",
        chat: "chat/chat.html",
      },
    },
  },
});
