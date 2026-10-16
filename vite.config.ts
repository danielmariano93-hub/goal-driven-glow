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
  build: {
    rollupOptions: {
      output: {
        // Bibliotecas estáveis em arquivos próprios: baixam em paralelo e ficam em cache entre os deploys
        // (um deploy só invalida o código do app, não ~1 MB de bibliotecas).
        manualChunks(id: string) {
          // helper de interop CJS é usado pelo app inteiro: se caísse no chunk de gráficos, ele viraria dependência de partida
          if (id.includes("commonjsHelpers")) return "vendor-react";
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run|clsx|tailwind-merge|class-variance-authority|react-is|prop-types|@babel|use-sync-external-store|tslib|object-assign)[\\/]/.test(id)) return "vendor-react";
          if (/[\\/]node_modules[\\/](recharts|recharts-scale|victory-vendor|d3-[^\\/]+|internmap|decimal\.js-light)[\\/]/.test(id)) return "vendor-charts";
          if (/[\\/]node_modules[\\/]@supabase[\\/]/.test(id)) return "vendor-supabase";
          if (/[\\/]node_modules[\\/](@radix-ui|cmdk|sonner|vaul|@floating-ui)[\\/]/.test(id)) return "vendor-ui";
          return undefined;
        },
      },
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
