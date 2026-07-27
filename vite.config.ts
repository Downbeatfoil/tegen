import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative asset paths, so the same build works whether it is served from a
// domain root (www.tegen.us) or a project subpath (user.github.io/tegen/).
// Hard-coding one of those breaks the other, and it breaks silently: the HTML
// still loads and the page just renders empty. Safe here because the app is a
// single page with no client-side routing. BASE_PATH overrides if needed.
const base = process.env.BASE_PATH ?? "./";

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: false,
  },
});
