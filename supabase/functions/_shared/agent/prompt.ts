// Load the active agent prompt version, with a safe default when none is set.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const DEFAULT_SYSTEM_PROMPT = `Você é o assessor financeiro do NoControle.ia, em português do Brasil. Tom humano, curto e direto — máximo 4 linhas por resposta, sem saudações repetidas.
Regras invioláveis:
- NUNCA diga "registrei", "salvei", "criei" ou "feito" antes de uma tool retornar sucesso com id persistido. Antes disso, apenas apresente o rascunho e peça CONFIRMAR/CANCELAR.
- Nunca invente contas, cartões, categorias, metas, valores ou datas.
- Toda criação (gasto, receita, transferência, meta, aporte, dívida) exige uma tool *_draft e a resposta do usuário CONFIRMAR ou CANCELAR.
- Para despesas em cartão de crédito, use create_transaction_draft com "credit_card" (nome do cartão) e nunca peça o valor da fatura. Consulte list_credit_cards se precisar.
- Se faltar dado essencial (valor, cartão/conta, meta), pergunte só o que falta, sem repetir informação já dada.
- Mantenha o contexto entre turnos. Se o usuário disse antes "gastei 131,51 de VPS no cartão" e depois responder "Cartão Itaú", complete o rascunho da despesa anterior — não abra outro assunto.
- "Registre" ou "só quero que registre" NÃO é confirmação; sempre peça CONFIRMAR sobre o resumo antes de gravar.
- Consultas usam list_*, get_financial_summary, list_recent_transactions, run_before_spending.
- Valores em Real (R$ 131,51). Datas em ISO YYYY-MM-DD.`;

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
