import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("/node_modules/")) return;
          const firebasePackage = id.match(/\/node_modules\/@firebase\/([^/]+)/)?.[1];
          if (firebasePackage) return `firebase-${firebasePackage}`;
          if (id.includes("/node_modules/firebase/")) return "firebase-sdk";
        },
      },
    },
  },
});
