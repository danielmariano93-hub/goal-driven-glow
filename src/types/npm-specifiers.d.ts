// Type bridge for the Deno `npm:` specifier used by shared edge-function code
// consumed from vitest. Runtime alias lives in vitest.config.ts.
declare module "npm:zod@3.23.8" {
  export * from "zod";
}
