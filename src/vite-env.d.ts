/// <reference types="vite/client" />

// Bridge Deno `npm:` specifiers used by _shared edge modules so vitest/tsc
// can resolve them via the project's npm zod. Runtime resolution in tests
// is handled by the alias in vitest.config.ts.
declare module "npm:zod@3.23.8" {
  export * from "zod";
}
