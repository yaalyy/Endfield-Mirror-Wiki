import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: process.env.SITE_BASE || "/Endfield-Mirror-Wiki/",
  plugins: [react()],
  publicDir: false,
  build: { target: "es2023" },
  server: { host: "127.0.0.1" },
});
