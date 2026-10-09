import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

// Identificação da versão publicada (aparece no rodapé da tela de hábitos): serve para
// saber, sem adivinhar, qual build a pessoa está vendo.
const BUILD_SHA = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "local").slice(0, 7);
const BUILD_AT = new Date().toISOString();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __APP_BUILD_AT__: JSON.stringify(BUILD_AT),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mcpPlugin(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "npm:@ai-sdk/openai-compatible": "@ai-sdk/openai-compatible",
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
