import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { notifyError } from "@/lib/ui/feedback";
import { MAPA_QUERY_KEY } from "@/lib/mapa/client";
import type { MapaQuestionDue } from "@/lib/engine/mapaContracts";
import { QUESTION_LATER_DAYS } from "@/lib/engine/mapaThresholds";

export type QuestionKind = MapaQuestionDue["kind"];
export type Resolution = "answered" | "skipped" | "later";

type Db = { from: (t: string) => any };

/** Registra a resposta, o "pular" ou o "depois" de uma pergunta em `map_questions` (alimenta o orçamento de atenção). */
export function useResolveQuestion() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { kind: QuestionKind; how: Resolution; payload?: Record<string, unknown> }) => {
      const now = new Date();
      const row: Record<string, unknown> = {
        user_id: user!.id, kind: v.kind, asked_at: now.toISOString(), channel: "app", payload: v.payload ?? {},
        due_at: v.how === "later" ? new Date(now.getTime() + QUESTION_LATER_DAYS * 86_400_000).toISOString() : now.toISOString(),
      };
      if (v.how === "answered") row.answered_at = now.toISOString();
      if (v.how === "skipped") row.skipped_at = now.toISOString();
      const { error } = await (supabase as unknown as Db).from("map_questions").insert(row);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [MAPA_QUERY_KEY] }),
    onError: () => notifyError("Não consegui salvar agora. Tente de novo em instantes."),
  });
}

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Mês anterior ao de `asOf` (YYYY-MM) e o nome dele. */
export function previousMonthOf(asOf: string): { ym: string; name: string } {
  const y = Number(asOf.slice(0, 4)), m = Number(asOf.slice(5, 7));
  const idx = y * 12 + (m - 1) - 1;
  const py = Math.floor(idx / 12), pm = (idx % 12) + 1;
  return { ym: `${py}-${String(pm).padStart(2, "0")}`, name: MONTH_NAMES[pm - 1] };
}

/** "3.500", "3500,50" → número. Vazio ou inválido → null. */
export function parseMoney(raw: string): number | null {
  const t = raw.replace(/[^\d.,]/g, "").trim();
  if (!t) return null;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : null;
}
