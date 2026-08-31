import { useQuery } from "@tanstack/react-query";
import { Brain, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { formatBRL } from "@/lib/split/math";
import { EMOTION_CATALOG, resolveEmotion } from "@/lib/emotions/catalog";
import {
  computeEmotionFinance,
  type EmotionCheckinRow,
  type EmotionPattern,
} from "@/lib/engine/emotionFinance";
import type { TransactionRow } from "@/lib/engine/facts";
import { fetchAllPages } from "@/lib/db/pagedSelect";

const TX_SELECT =
  "id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,refund_of_transaction_id";

type EngineSettings = {
  window_days: number;
  min_sample: number;
  min_composite_sample: number;
  min_uplift_pct: number;
  min_delta_abs: number;
  lookback_days: number;
};

function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function shift(day: string, days: number): string {
  return new Date(new Date(`${day}T12:00:00Z`).getTime() + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "base sólida",
  medium: "base razoável",
  low: "base inicial",
  insufficient_data: "sem base ainda",
};

/**
 * Padrões do histórico: cruza emoção registrada com gasto flexível, sempre
 * contra o padrão pessoal do mesmo dia da semana. Associação, nunca causa.
 */
export function EmotionFinancePatterns() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["emotion_finance_patterns", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const settingsResp = await supabase.rpc("emotion_finance_settings");
      const cfg = (settingsResp.data ?? {}) as Partial<EngineSettings>;
      const lookback = Number(cfg.lookback_days ?? 120);
      const to = todayISO();
      const from = shift(to, -(lookback - 1));

      const [txResp, checkinResp, catResp, cardResp] = await Promise.all([
        // Paginado: `.limit(4000)` era cortado em 1.000 linhas em silêncio.
        fetchAllPages<any>((a, b) => supabase.from("transactions").select(TX_SELECT)
          .gte("occurred_at", from).lte("occurred_at", to)
          .order("occurred_at", { ascending: true }).order("id", { ascending: true })
          .range(a, b), { source: "transactions" }).then((data) => ({ data, error: null })),
        supabase.from("emotional_checkins").select("occurred_at,mood,emotion_key,trigger_label")
          .gte("occurred_at", `${from}T00:00:00`).order("occurred_at", { ascending: false }).limit(400),
        supabase.from("categories").select("id,name"),
        supabase.from("credit_cards").select("closing_day"),
      ]);

      const txs = ((txResp.data ?? []) as any[]).map((t) => ({ ...t, amount: Number(t.amount) })) as TransactionRow[];
      const checkins = (checkinResp.data ?? []) as unknown as EmotionCheckinRow[];
      const categoryNames = Object.fromEntries(
        ((catResp.data ?? []) as any[]).map((c) => [String(c.id), String(c.name)]),
      );
      const cardCloseDays = ((cardResp.data ?? []) as any[])
        .map((c) => Number(c.closing_day))
        .filter((d) => Number.isFinite(d) && d >= 1 && d <= 31);

      return computeEmotionFinance({
        txs,
        checkins,
        period: { from, to },
        categoryNames,
        resolveEmotionKey: (value, mood) => {
          const option = resolveEmotion(value)
            ?? (mood != null ? EMOTION_CATALOG.find((e) => e.mood === Number(mood)) ?? null : null);
          return option ? { key: option.key, label: option.label } : null;
        },
        minSample: Number(cfg.min_sample ?? 5),
        minCompositeSample: Number(cfg.min_composite_sample ?? 4),
        minUpliftPct: Number(cfg.min_uplift_pct ?? 15),
        minDeltaAbs: Number(cfg.min_delta_abs ?? 30),
        windowDays: Number(cfg.window_days ?? 1),
        cardCloseDays,
      });
    },
  });

  if (isLoading || !data) return null;

  const material = data.facts.patterns.filter((p) => p.facts.material);
  const others = data.facts.patterns.filter((p) => !p.facts.material).slice(0, 3);

  return (
    <section className="mt-6">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        <Brain size={15} className="text-primary" /> Padrões do seu histórico
      </h2>
      <p className="mb-3 text-[10px] leading-relaxed text-muted-foreground">
        Comparo os dias em que você registrou uma emoção com o seu próprio padrão de gasto flexível
        para o mesmo dia da semana. É co-ocorrência observada — não é diagnóstico nem causa.
      </p>

      {material.length === 0 ? (
        <div className="surface-card p-4 text-xs text-muted-foreground">
          {data.facts.episodes_considered > 0
            ? `Já cruzei ${data.facts.episodes_considered} registro${data.facts.episodes_considered > 1 ? "s" : ""} com seus gastos e ainda não há diferença consistente o bastante para eu apontar um padrão. Prefiro dizer isso do que arriscar uma leitura frágil.`
            : "Registre como você se sentiu em alguns dias. Com histórico suficiente, mostro aqui o que costuma acontecer no seu gasto por perto desses registros."}
          {others.length > 0 && (
            <ul className="mt-3 space-y-1">
              {others.map((p) => (
                <li key={p.facts.emotion_key} className="text-[11px]">
                  • {p.sentence}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {material.slice(0, 5).map((p) => (
            <PatternRow key={`${p.facts.emotion_key}-${p.context ?? "base"}`} pattern={p} />
          ))}
          {data.facts.composites.slice(0, 2).map((p) => (
            <PatternRow key={`comp-${p.facts.emotion_key}-${p.context}`} pattern={p} composite />
          ))}
        </div>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
        <Info size={12} className="mt-0.5 shrink-0" />
        Transferências, investimentos, pagamentos de fatura e dias atípicos ficam fora da conta.
        Dias sem gasto contam como zero, para o padrão não ficar inflado.
      </p>
    </section>
  );
}

function PatternRow({ pattern, composite }: { pattern: EmotionPattern; composite?: boolean }) {
  const f = pattern.facts;
  const up = f.direction === "acima";
  return (
    <article className="surface-card p-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {f.emotion_label}
            {composite && pattern.context_label ? (
              <span className="text-muted-foreground"> · {pattern.context_label}</span>
            ) : null}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {f.sample_size} registro{f.sample_size > 1 ? "s" : ""} · {f.consistency_hits} de{" "}
            {f.sample_size} acima do padrão · {CONFIDENCE_LABEL[pattern.confidence] ?? pattern.confidence}
          </p>
        </div>
        <span
          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            up ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"
          }`}
        >
          {up ? "+" : "−"}
          {Math.abs(Math.round(f.uplift_pct ?? 0))}%
        </span>
      </header>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{pattern.sentence}</p>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Nesses dias: {formatBRL(f.observed_avg)} · seu padrão para o mesmo dia da semana:{" "}
        {formatBRL(f.expected_avg)}
      </p>
    </article>
  );
}
