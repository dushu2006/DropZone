import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { hostingPlugin } from "./scripts/hosting.mjs";

export default defineConfig(({ mode }) => ({
  plugins: [react(), hostingPlugin(loadEnv(mode, process.cwd(), "VITE_"))],
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
  build: {
    manifest: true,
    // The XLSX parser is a separate lazy-loaded chunk used only by roster import.
    chunkSizeWarningLimit: 550,
  },
}));
