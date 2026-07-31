import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { brl, errorResult, ok, requireUser } from "../shared";

export default defineTool({
  name: "list_accounts_and_categories",
  title: "Listar contas e categorias",
  description:
    "Lista as contas ativas e as categorias do usuário autenticado, com seus identificadores. Use antes de registrar um lançamento para escolher conta e categoria.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!requireUser(ctx)) return errorResult("Não autenticado.");
    const supabase = supabaseForUser(ctx);

    const [accRes, catRes] = await Promise.all([
      supabase.from("accounts").select("id, name, institution, type, opening_balance, active").eq("active", true),
      supabase.from("categories").select("id, name, type, archived_at").is("archived_at", null),
    ]);
    if (accRes.error) return errorResult(accRes.error.message);
    if (catRes.error) return errorResult(catRes.error.message);

    const accounts = (accRes.data ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      institution: a.institution,
      type: a.type,
    }));
    const categories = (catRes.data ?? []).map((c) => ({ id: c.id, name: c.name, type: c.type }));

    const text = [
      accounts.length ? "Contas:" : "Nenhuma conta cadastrada.",
      ...accounts.map((a) => `- ${a.name}${a.institution ? ` (${a.institution})` : ""} · ${a.id}`),
      "",
      categories.length ? "Categorias:" : "Nenhuma categoria cadastrada.",
      ...categories.map((c) => `- ${c.name} [${c.type}] · ${c.id}`),
    ].join("\n");

    return ok(text, { accounts, categories });
  },
});

export const _brl = brl;
