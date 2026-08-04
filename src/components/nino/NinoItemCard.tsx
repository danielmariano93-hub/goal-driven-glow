import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import {
  KIND_LABEL,
  MATURITY_LABEL,
  actionLabel,
  recordNinoExposure,
  safeRoute,
  useNinoAct,
  useNinoFeedback,
  type NinoItem,
} from "@/lib/nino/intelligence";

function toneFor(severity: string) {
  if (severity === "critical") return { bg: "var(--home-danger-soft, rgba(255,107,95,0.12))", fg: "var(--home-danger, #FF6B5F)" };
  if (severity === "attention" || severity === "high") return { bg: "rgba(255,107,95,0.10)", fg: "#B8452F" };
  return { bg: "var(--home-surface-neutral)", fg: "var(--home-text-2)" };
}

function fmtDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
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
  const tone = toneFor(item.severity);
  const evidence = (item.evidence ?? {}) as Record<string, unknown>;
  const maturity = typeof evidence.maturity === "string" ? MATURITY_LABEL[evidence.maturity] : null;
  const how = evidence.how_we_calculate as Record<string, unknown> | undefined;
  const validUntil = fmtDate(item.valid_until);

  useEffect(() => {
    if (item.id) void recordNinoExposure(item.id, surface, rank, `kind=${item.kind};priority=${item.priority ?? 0}`);
  }, [item.id, item.kind, item.priority, rank, surface]);

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
      className="rounded-[18px] bg-[color:var(--home-surface)] p-4"
      style={{ border: "1px solid var(--home-hairline)" }}
    >
      <div className="flex items-center gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
          style={{ background: tone.bg, color: tone.fg, letterSpacing: "0.08em" }}
        >
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

      <h3 className="mt-2 text-[14px] font-bold leading-snug" style={{ color: "var(--home-text-1)" }}>
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
            className="inline-flex items-center rounded-full px-4 text-[12px] font-semibold text-white transition hover:opacity-95"
            style={{ background: "var(--home-brand-ink)", height: 36 }}
          >
            {actionLabel(item.primary_action)}
          </Link>
        )}
        {item.id && (
          <>
            <button
              type="button"
              onClick={() => void onFeedback("useful")}
              className="inline-flex items-center gap-1 text-[12px] font-semibold hover:underline"
              style={{ color: "var(--home-text-2)" }}
            >
              <ThumbsUp className="h-3.5 w-3.5" /> Útil
            </button>
            <button
              type="button"
              onClick={() => void onFeedback("not_useful")}
              className="inline-flex items-center gap-1 text-[12px] font-semibold hover:underline"
              style={{ color: "var(--home-text-2)" }}
            >
              <ThumbsDown className="h-3.5 w-3.5" /> Não ajudou
            </button>
          </>
        )}
      </div>

      {(how || Object.keys(evidence).length > 0) && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold"
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
              {how &&
                Object.entries(how).map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3">
                    <dt style={{ color: "var(--home-text-3)" }}>{k}</dt>
                    <dd className="text-right font-medium tabular-nums" style={{ color: "var(--home-text-2)" }}>
                      {typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "—")}
                    </dd>
                  </div>
                ))}
              {item.confidence != null && (
                <div className="flex items-center justify-between gap-3">
                  <dt style={{ color: "var(--home-text-3)" }}>confiança</dt>
                  <dd className="font-medium tabular-nums" style={{ color: "var(--home-text-2)" }}>
                    {Math.round((item.confidence ?? 0) * 100)}%
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}
    </article>
  );
}
