import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// MediaPipe's wasm assets are loaded at runtime from the package; excluding the
// package from dependency pre-bundling avoids Vite mangling its asset URLs.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@mediapipe/tasks-vision"],
  },
});
