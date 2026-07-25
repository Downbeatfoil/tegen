import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Pages serves the app from /<repo>/, local dev serves from /.
// Set BASE_PATH in CI to override.
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: false,
  },
});
