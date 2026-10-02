import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    // Use Vite's default dev port to avoid conflicts
    port: 5173,
    /**
     * Proxy target is 127.0.0.1, not localhost — deliberately.
     *
     * The API server binds 0.0.0.0, which is IPv4 only. On Windows with
     * Node 17+, "localhost" resolves to the IPv6 ::1 first, so the proxy
     * intermittently tried an address nothing was listening on and Vite
     * answered with its own 500. The requests never reached Express, which
     * is why the server log showed nothing for them. Symptom was random
     * 500s on /api/* at page load, several routes failing at once.
     *
     * Pinning IPv4 removes the race entirely.
     */
    proxy: {
      "/api": { target: "http://127.0.0.1:5000", changeOrigin: true },
      "/uploads": { target: "http://127.0.0.1:5000", changeOrigin: true },
      "/login": { target: "http://127.0.0.1:5000", changeOrigin: true },
      "/register": { target: "http://127.0.0.1:5000", changeOrigin: true },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
