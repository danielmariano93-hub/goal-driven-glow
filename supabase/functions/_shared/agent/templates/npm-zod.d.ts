// Type bridge for the Deno `npm:` specifier used at runtime.
// In the Vite/Vitest bundler, `npm:zod@3.23.8` is aliased to the local `zod`
// package (see vitest.config.ts). This ambient declaration mirrors that alias
// for TypeScript so the shared module type-checks in both environments.
declare module "npm:zod@3.23.8" {
  export * from "zod";
}
