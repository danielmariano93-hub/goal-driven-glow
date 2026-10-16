import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { notifySuccess } from "@/lib/ui/feedback";
import { parseMoney, previousMonthOf, useResolveQuestion } from "@/lib/mapa/questions";

type Db = { from: (t: string) => any };

function useExpenseCategories() {
  const { user } = useAuth();
  return useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["mapa-expense-categories", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as Db).from("categories").select("id,name").eq("type", "expense").is("archived_at", null).order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });
}

/**
 * Pergunta mensal (exploratória): quanto você acha que gastou no mês passado?
 * O gasto real NUNCA aparece aqui; a comparação só vem depois de duas respostas.
 */
export function MapaEstimateCard({ asOf }: { asOf: string }) {
  const month = previousMonthOf(asOf);
  const resolve = useResolveQuestion();
  const { data: cats } = useExpenseCategories();
  const [raw, setRaw] = useState("");
  const [top, setTop] = useState("");
  const value = parseMoney(raw);

  return (
    <section aria-label="Pergunta do mês" className="rounded-[22px] border border-border bg-card p-4 shadow-card">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Uma pergunta rápida · em teste</p>
      <p className="mt-2 text-sm font-semibold leading-snug">Quanto você acha que gastou em {month.name}?</p>
      <p className="mt-1 text-[13px] leading-snug text-muted-foreground">Responda de cabeça, sem olhar o app. Não mostro o valor real agora, para a comparação ser justa. Com duas respostas, eu comparo.</p>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-sm" aria-hidden>R$</span>
        <input inputMode="decimal" aria-label={`Quanto você gastou em ${month.name}, em reais`} placeholder="Ex.: 4.500" value={raw} onChange={(e) => setRaw(e.target.value)}
          className="min-h-11 w-36 rounded-xl border border-border bg-background px-3 text-sm" />
      </div>
      <label className="mt-3 block text-[13px] font-semibold">
        E qual categoria mais pesou?
        <select value={top} onChange={(e) => setTop(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal">
          <option value="">Não sei</option>
          {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-1">
        <button type="button" disabled={resolve.isPending || value === null}
          onClick={() => resolve.mutate({ kind: "estimativa_mensal", how: "answered", payload: { month: month.ym, estimate: value, top_category_id: top || null } }, { onSuccess: () => notifySuccess("Anotado. Obrigado!") })}
          className="min-h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {resolve.isPending ? "Salvando…" : "Responder"}
        </button>
        <button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate({ kind: "estimativa_mensal", how: "later" })} className="min-h-11 px-3 text-[13px] font-semibold text-muted-foreground">Depois</button>
        <button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate({ kind: "estimativa_mensal", how: "skipped" })} className="min-h-11 px-3 text-[13px] font-semibold text-muted-foreground">Pular</button>
      </div>
    </section>
  );
}
