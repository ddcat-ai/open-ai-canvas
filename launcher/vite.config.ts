import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], clearScreen: false, server: { strictPort: true }, envPrefix: ["VITE_"] });
