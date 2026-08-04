import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarClock,
  ChevronDown,
  Lightbulb,
  ThumbsDown,
  ThumbsUp,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { useNinoExposure } from "@/hooks/useNinoExposure";
import { brl } from "@/lib/nino/format";
import {
  KIND_LABEL,
  MATURITY_LABEL,
  actionLabel,
  safeRoute,
  useNinoAct,
  useNinoFeedback,
  type NinoItem,
} from "@/lib/nino/intelligence";

type Tone = { bg: string; fg: string; accent: string; icon: typeof AlertTriangle };

function toneFor(item: NinoItem): Tone {
  const critical = item.severity === "critical";
  if (item.kind === "risk" || critical)
    return { bg: "rgba(255,107,95,0.12)", fg: "#B8452F", accent: "#FF6B5F", icon: AlertTriangle };
  if (item.kind === "achievement")
    return { bg: "rgba(47,201,154,0.14)", fg: "#126B52", accent: "#2FC99A", icon: Trophy };
  if (item.kind === "change")
    return { bg: "rgba(67,56,255,0.10)", fg: "#3B32C7", accent: "#4338FF", icon: ArrowLeftRight };
  if (item.kind === "pattern")
    return { bg: "rgba(109,74,255,0.10)", fg: "#4C34C4", accent: "#6D4AFF", icon: Lightbulb };
  if (item.kind === "projection" || item.kind === "commitment")
    return { bg: "rgba(109,74,255,0.08)", fg: "#4C34C4", accent: "#6D4AFF", icon: CalendarClock };
  return { bg: "var(--home-surface-neutral)", fg: "var(--home-text-2)", accent: "var(--home-hairline)", icon: Lightbulb };
}

function fmtDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

const HUMAN_LABEL: Record<string, string> = {
  sample_size: "dias considerados",
  observations: "observações",
  window_days: "janela analisada",
  baseline: "média de referência",
  current: "valor atual",
  delta: "diferença",
  percentage_delta: "variação",
  absolute_delta: "diferença",
  current_value: "período atual",
  comparison_value: "período anterior",
  savings_rate: "taxa de poupança",
};

const MONEY_KEYS = new Set(["baseline", "current", "delta", "absolute_delta", "current_value", "comparison_value"]);

function humanValue(key: string, value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number") {
    if (MONEY_KEYS.has(key)) return brl(value);
    if (key.includes("percentage") || key === "savings_rate") return `${(value * (Math.abs(value) <= 1 ? 100 : 1)).toFixed(0)}%`;
    return String(value);
  }
  if (typeof value === "object") return "—";
  return String(value);
}

export function NinoItemCard({
  item,
  surface,
  rank,
  compact = false,
}: {
  item: NinoItem;
  surface: string;
  rank?: number;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const feedback = useNinoFeedback();
  const act = useNinoAct();
  const tone = toneFor(item);
  const Icon = tone.icon;
  const evidence = (item.evidence ?? {}) as Record<string, unknown>;
  const maturity = typeof evidence.maturity === "string" ? MATURITY_LABEL[evidence.maturity] : null;
  const how = evidence.how_we_calculate as Record<string, unknown> | undefined;
  const validUntil = fmtDate(item.valid_until);
  const exposureRef = useNinoExposure(item.id, surface, rank, `kind=${item.kind};priority=${item.priority ?? 0}`);

  const humanRows = Object.entries({ ...(how ?? {}), ...evidence }).filter(
    ([k, v]) => HUMAN_LABEL[k] && (typeof v === "number" || typeof v === "string"),
  );

  const onFeedback = async (kind: "useful" | "not_useful" | "dismiss") => {
    if (!item.id) return;
    try {
      await feedback.mutateAsync({ itemId: item.id, feedback: kind, surface });
      toast.success(kind === "useful" ? "Obrigado, isso ajuda o Nino." : "Anotado. O Nino ajusta as próximas leituras.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <article
      ref={exposureRef as React.RefObject<HTMLElement>}
      className="overflow-hidden rounded-[18px] bg-[color:var(--home-surface)]"
      style={{ border: "1px solid var(--home-hairline)", borderLeft: `3px solid ${tone.accent}` }}
    >
      <div className="p-4">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
            style={{ background: tone.bg, color: tone.fg, letterSpacing: "0.08em" }}
          >
            <Icon className="h-3 w-3" />
            {KIND_LABEL[item.kind] ?? "Leitura"}
          </span>
          {maturity && (
            <span className="text-[10px] font-semibold uppercase" style={{ color: "var(--home-text-3)", letterSpacing: "0.08em" }}>
              {maturity}
            </span>
          )}
          {validUntil && (
            <span className="ml-auto text-[10px] font-medium" style={{ color: "var(--home-text-3)" }}>
              válido até {validUntil}
            </span>
          )}
        </div>

        <h3
          className={`mt-2 font-bold leading-snug ${item.severity === "critical" ? "text-[15px]" : "text-[14px]"}`}
          style={{ color: "var(--home-text-1)" }}
        >
          {item.title}
        </h3>
        {item.summary && (
          <p className="mt-0.5 text-[12px] font-medium" style={{ color: "var(--home-text-3)" }}>
            {item.summary}
          </p>
        )}
        {item.explanation && (
          <p className={`mt-1.5 text-[12px] leading-snug ${compact ? "line-clamp-3" : ""}`} style={{ color: "var(--home-text-2)" }}>
            {item.explanation}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {item.primary_action && (
            <Link
              to={safeRoute(item.primary_action)}
              onClick={() => item.id && act.mutate({ itemId: item.id, surface })}
              className="inline-flex min-h-[40px] items-center rounded-full px-4 text-[12px] font-semibold text-white transition active:scale-[0.98] hover:opacity-95"
              style={{ background: "var(--home-brand-ink)" }}
            >
              {actionLabel(item.primary_action, "Abrir", item.kind)}
            </Link>
          )}
          {item.id && (
            <>
              <button
                type="button"
                onClick={() => void onFeedback("useful")}
                className="inline-flex min-h-[40px] items-center gap-1 text-[12px] font-semibold hover:underline"
                style={{ color: "var(--home-text-2)" }}
              >
                <ThumbsUp className="h-3.5 w-3.5" /> Útil
              </button>
              <button
                type="button"
                onClick={() => void onFeedback("not_useful")}
                className="inline-flex min-h-[40px] items-center gap-1 text-[12px] font-semibold hover:underline"
                style={{ color: "var(--home-text-2)" }}
              >
                <ThumbsDown className="h-3.5 w-3.5" /> Não ajudou
              </button>
            </>
          )}
        </div>

        {(typeof evidence.plain_language_reason === "string" || humanRows.length > 0 || item.confidence != null) && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="inline-flex min-h-[36px] items-center gap-1 text-[11px] font-semibold"
              style={{ color: "var(--home-text-3)" }}
            >
              Como o Nino chegou aqui
              <ChevronDown className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <dl className="mt-2 space-y-1 rounded-xl p-3 text-[11px]" style={{ background: "var(--home-surface-neutral)" }}>
                {typeof evidence.plain_language_reason === "string" && (
                  <p style={{ color: "var(--home-text-2)" }}>{evidence.plain_language_reason}</p>
                )}
                {typeof evidence.next_validation_condition === "string" && (
                  <p style={{ color: "var(--home-text-3)" }}>{evidence.next_validation_condition}</p>
                )}
                {humanRows.map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3">
                    <dt style={{ color: "var(--home-text-3)" }}>{HUMAN_LABEL[k]}</dt>
                    <dd className="text-right font-medium tabular-nums" style={{ color: "var(--home-text-2)" }}>
                      {humanValue(k, v)}
                    </dd>
                  </div>
                ))}
                {item.confidence != null && (
                  <div className="flex items-center justify-between gap-3">
                    <dt style={{ color: "var(--home-text-3)" }}>confiança do Nino</dt>
                    <dd className="font-medium tabular-nums" style={{ color: "var(--home-text-2)" }}>
                      {Math.round((item.confidence ?? 0) * 100)}%
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
