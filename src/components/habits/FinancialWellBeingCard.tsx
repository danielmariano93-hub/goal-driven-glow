import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HeartPulse } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { notifyError, notifySuccess } from "@/lib/ui/feedback";
import {
  FWB_CADENCE_DAYS, FWB_ITEMS, FWB_OPTIONS, FWB_RELIABLE_CHANGE, FWB_VERSION, fwbChange, fwbDaysUntilDue, fwbTrend, scoreFinancialWellBeing,
  type FwbAgeBand,
} from "@/lib/engine/financialWellBeing";

type Row = { answered_at: string; score: number; total: number };
type Db = { from: (t: string) => any };

const KEY = "financial-wellbeing";

function useResponses() {
  const { user } = useAuth();
  return useQuery<Row[]>({
    queryKey: [KEY, user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as Db).from("financial_wellbeing_responses")
        .select("answered_at,score,total").order("answered_at", { ascending: false }).limit(6);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
}

/** Questionário de bem-estar financeiro (escala CFPB, 10 perguntas), a cada 15 dias. */
export function FinancialWellBeingCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data } = useResponses();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Array<number | null>>(() => FWB_ITEMS.map(() => null));
  const [age, setAge] = useState<FwbAgeBand>("18-61");
  const [saving, setSaving] = useState(false);

  const last = data?.[0] ?? null;
  const previous = data?.[1] ?? null;
  const daysLeft = fwbDaysUntilDue(last?.answered_at);
  const due = daysLeft === 0;
  const result = scoreFinancialWellBeing(answers, age);
  const change = last ? fwbChange(last.score, previous?.score) : null;
  const trend = fwbTrend((data ?? []).map((r) => r.score));

  async function submit() {
    if (!result || !user) return;
    setSaving(true);
    try {
      const { error } = await (supabase as unknown as Db).from("financial_wellbeing_responses").insert({
        user_id: user.id, scale_version: FWB_VERSION, age_band: age, options: answers, total: result.total, score: result.score,
      });
      if (error) throw error;
      notifySuccess("Respostas salvas.");
      setOpen(false);
      setAnswers(FWB_ITEMS.map(() => null));
      await qc.invalidateQueries({ queryKey: [KEY] });
    } catch {
      notifyError("Não consegui salvar agora. Tente de novo em instantes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Bem-estar financeiro" className="rounded-[22px] border border-border bg-card p-4 shadow-card">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        <HeartPulse size={13} aria-hidden /> Bem-estar financeiro
      </p>

      {last ? (
        <div className="mt-2">
          <p className="font-display text-2xl font-bold tabular-nums">{last.score}<span className="text-sm font-medium text-muted-foreground"> de 100</span></p>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
            {change == null ? "Esta é a sua primeira medição."
              : change.direction === "same" ? "Parecido com a medição anterior. Esta nota oscila alguns pontos sem que nada tenha mudado de verdade."
              : change.direction === "up" ? `Subiu ${change.delta} pontos desde a medição anterior, mais do que a medida costuma oscilar.`
              : `Caiu ${Math.abs(change.delta)} pontos desde a medição anterior, mais do que a medida costuma oscilar.`}
            {" "}Quanto maior, melhor.
            {trend && trend.direction !== "same" ? ` Olhando as últimas medições, a tendência é de ${trend.direction === "up" ? "alta" : "queda"}.` : ""}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[13px] leading-snug">Dez perguntas rápidas sobre como você se sente em relação ao seu dinheiro. Leva cerca de 2 minutos.</p>
      )}

      {!open ? (
        due ? (
          <button type="button" onClick={() => setOpen(true)} className="mt-3 min-h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
            {last ? "Responder de novo" : "Responder agora"}
          </button>
        ) : (
          <p className="mt-2 text-[12px] text-muted-foreground">Próxima medição em {daysLeft} {daysLeft === 1 ? "dia" : "dias"}. Repito a cada {FWB_CADENCE_DAYS} dias para ver a sua evolução.</p>
        )
      ) : (
        <form className="mt-3 space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <fieldset className="text-[13px]">
            <legend className="font-semibold">Sua idade</legend>
            <div className="mt-1 flex gap-2">
              {(["18-61", "62+"] as const).map((b) => (
                <label key={b} className={`flex min-h-11 items-center rounded-full border px-4 ${age === b ? "border-primary bg-primary/10 font-semibold" : "border-border"}`}>
                  <input type="radio" name="fwb-age" className="sr-only" checked={age === b} onChange={() => setAge(b)} />
                  {b === "18-61" ? "De 18 a 61 anos" : "62 anos ou mais"}
                </label>
              ))}
            </div>
          </fieldset>
          {FWB_ITEMS.map((item, i) => (
            <fieldset key={item.id}>
              <legend className="text-[13px] font-semibold leading-snug">
                {i === 0 ? <span className="mb-1 block text-[11px] font-normal uppercase tracking-wider text-muted-foreground">Quanto cada frase descreve você ou a sua situação?</span> : null}
                {i === 6 ? <span className="mb-1 block text-[11px] font-normal uppercase tracking-wider text-muted-foreground">Com que frequência cada frase acontece com você?</span> : null}
                {item.id}. {item.text}
              </legend>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {FWB_OPTIONS[item.format].map((label, opt) => (
                  <label key={label} className={`flex min-h-11 items-center rounded-full border px-3 text-[12px] ${answers[i] === opt ? "border-primary bg-primary/10 font-semibold" : "border-border"}`}>
                    <input type="radio" name={`fwb-${item.id}`} className="sr-only" checked={answers[i] === opt} onChange={() => setAnswers((a) => a.map((v, j) => (j === i ? opt : v)))} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={!result || saving} className="min-h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {saving ? "Salvando…" : "Salvar respostas"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-3 text-sm text-muted-foreground">Cancelar</button>
          </div>
          {!result ? <p className="text-[11px] text-muted-foreground">Responda as 10 perguntas para salvar.</p> : null}
        </form>
      )}

      <details className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        <summary className="cursor-pointer font-semibold text-foreground">De onde vem esta nota</summary>
        <p className="mt-1">
          É a Escala de Bem-Estar Financeiro do CFPB, órgão de proteção ao consumidor dos EUA, com 10 perguntas e pontuação oficial (de 14 a 95). Existe uma adaptação brasileira validada com 834 pessoas (Howat-Rodrigues e colegas, 2021). Três das dez frases usam a redação da versão brasileira validada; as outras sete são tradução minha. A escala não define o que é uma nota boa ou ruim. Variações menores que cerca de {FWB_RELIABLE_CHANGE} pontos entre duas medições ficam dentro do erro da própria escala, por isso só falo em mudança acima disso. Não é diagnóstico.
        </p>
      </details>
    </section>
  );
}
