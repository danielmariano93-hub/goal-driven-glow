// Type bridge for the Deno `npm:` specifier used by shared edge-function code
// consumed from vitest. Runtime alias lives in vitest.config.ts.
declare module "npm:zod@3.23.8" {
  export * from "zod";
}

declare module "https://esm.sh/@supabase/supabase-js@2.45.4" {
  export type { SupabaseClient } from "@supabase/supabase-js";
  export { createClient } from "@supabase/supabase-js";
}
