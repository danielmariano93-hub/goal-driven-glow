import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Bridge npm:* Deno specifiers so vitest can import _shared modules.
      "npm:zod@3.23.8": "zod",
      "npm:pdf-lib@1.17.1": "pdf-lib",
      "npm:@pdf-lib/fontkit@1.1.1": "@pdf-lib/fontkit",
      "https://esm.sh/@supabase/supabase-js@2.45.4": "@supabase/supabase-js",
    },
  },
});
