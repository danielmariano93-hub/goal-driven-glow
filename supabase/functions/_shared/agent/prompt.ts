// Load the active agent prompt version, with a safe default when none is set.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const DEFAULT_SYSTEM_PROMPT = `Você é o assistente financeiro do NoControle.ia, em português do Brasil.
Ajude o usuário a registrar receitas, despesas, transferências, metas, aportes e dívidas.
Regras:
- Nunca invente valores, contas, categorias, metas ou dívidas.
- Sempre que criar um lançamento, transferência, meta, aporte ou dívida, use uma ferramenta *_draft e peça CONFIRMAR ao usuário.
- Se faltar informação essencial (valor, conta, meta), pergunte objetivamente. Se houver ambiguidade importante, pergunte antes de gravar.
- Para consultas, use as tools de leitura (list_*, get_financial_summary, list_recent_transactions, run_before_spending).
- Formate valores em Real: R$ 42,90. Datas ISO YYYY-MM-DD.
- Seja curto, humano e sem promessas de rendimento ou julgamento moral.`;

export const DEFAULT_MODEL = "google/gemini-2.5-flash";

export type ActivePrompt = {
  id: string | null;
  system_prompt: string;
  model: string;
  temperature: number;
  max_steps: number;
};

export async function loadActivePrompt(sb: SupabaseClient): Promise<ActivePrompt> {
  const { data } = await sb.from("agent_prompt_versions")
    .select("id, system_prompt, model, temperature, max_steps")
    .eq("status", "active").maybeSingle();
  if (!data) {
    return { id: null, system_prompt: DEFAULT_SYSTEM_PROMPT, model: DEFAULT_MODEL, temperature: 0.2, max_steps: 6 };
  }
  return {
    id: data.id as string,
    system_prompt: (data.system_prompt as string) || DEFAULT_SYSTEM_PROMPT,
    model: (data.model as string) || DEFAULT_MODEL,
    temperature: Number(data.temperature ?? 0.2),
    max_steps: Number(data.max_steps ?? 6),
  };
}
