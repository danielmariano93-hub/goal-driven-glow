import { Link } from "react-router-dom";
import { useState } from "react";
import { AlertTriangle, ArrowLeftRight, ChevronDown, Lightbulb, ThumbsDown, ThumbsUp, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useNinoExposure } from "@/hooks/useNinoExposure";
import { brl } from "@/lib/nino/format";
import { KIND_LABEL, actionLabel, safeRoute, useNinoAct, useNinoFeedback, type NinoItem } from "@/lib/nino/intelligence";

function tone(item: NinoItem) {
  if (item.kind === "risk" && item.severity === "critical")
    return { bg: "rgba(255,107,95,0.12)", fg: "#B8452F", icon: AlertTriangle };
  if (item.kind === "risk") return { bg: "rgba(255,183,77,0.16)", fg: "#8A5A11", icon: AlertTriangle };
  if (item.kind === "achievement") return { bg: "rgba(47,201,154,0.14)", fg: "#126B52", icon: Trophy };
  if (item.kind === "change") return { bg: "rgba(67,56,255,0.10)", fg: "#3B32C7", icon: ArrowLeftRight };
  return { bg: "rgba(109,74,255,0.10)", fg: "#4C34C4", icon: Lightbulb };
}

/**
 * Card do item principal: uma única leitura em destaque, com valor de impacto,
 * ação por intenção e explicação traduzida.
 */
export function NinoPrimaryInsightCard({ item, surface }: { item: NinoItem; surface: string }) {
  const [open, setOpen] = useState(false);
  const feedback = useNinoFeedback();
  const act = useNinoAct();
  const t = tone(item);
  const Icon = t.icon;
  const ref = useNinoExposure(item.id, surface, 1, `primary;kind=${item.kind};priority=${item.priority ?? 0}`);
  const impact = typeof item.impact_amount === "number" && item.impact_amount > 0 ? item.impact_amount : null;
  const reason = (item.evidence ?? {}) as Record<string, unknown>;

  const send = async (kind: "useful" | "not_useful") => {
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
      ref={ref as React.RefObject<HTMLElement>}
      className="rounded-[22px] p-5"
      style={{ border: "1px solid var(--home-hairline)", background: "var(--home-surface)" }}
    >
      <span
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase"
        style={{ background: t.bg, color: t.fg, letterSpacing: "0.08em" }}
      >
        <Icon className="h-3 w-3" />
        {KIND_LABEL[item.kind] ?? "Leitura"} · o que mais importa agora
      </span>

      <h2 className="mt-2.5 font-display text-[19px] font-bold leading-tight" style={{ color: "var(--home-text-1)" }}>
        {item.title}
      </h2>
      {impact && (
        <p className="mt-1 text-[13px] font-semibold tabular-nums" style={{ color: t.fg }}>
          Impacto estimado: {brl(impact)}
        </p>
      )}
      {item.summary && (
        <p className="mt-1 text-[12.5px] font-medium" style={{ color: "var(--home-text-3)" }}>
          {item.summary}
        </p>
      )}
      {item.explanation && (
        <p className="mt-2 text-[13px] leading-snug" style={{ color: "var(--home-text-2)" }}>
          {item.explanation}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {item.primary_action && (
          <Link
            to={safeRoute(item.primary_action)}
            onClick={() => item.id && act.mutate({ itemId: item.id, surface })}
            className="inline-flex min-h-[46px] flex-1 items-center justify-center rounded-full px-5 text-[13px] font-semibold text-white transition active:scale-[0.98]"
            style={{ background: "var(--home-brand-ink)" }}
          >
            {actionLabel(item.primary_action, "Resolver agora", item.kind)}
          </Link>
        )}
      </div>

      <div className="mt-3 flex items-center gap-4">
        {item.id && (
          <>
            <button
              type="button"
              onClick={() => void send("useful")}
              className="inline-flex min-h-[36px] items-center gap-1 text-[11.5px] font-semibold"
              style={{ color: "var(--home-text-3)" }}
            >
              <ThumbsUp className="h-3.5 w-3.5" /> Fez sentido
            </button>
            <button
              type="button"
              onClick={() => void send("not_useful")}
              className="inline-flex min-h-[36px] items-center gap-1 text-[11.5px] font-semibold"
              style={{ color: "var(--home-text-3)" }}
            >
              <ThumbsDown className="h-3.5 w-3.5" /> Não se aplica
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto inline-flex min-h-[36px] items-center gap-1 text-[11.5px] font-semibold"
          style={{ color: "var(--home-text-3)" }}
        >
          Como calculamos
          <ChevronDown className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-1 rounded-2xl p-3 text-[11.5px]" style={{ background: "var(--home-surface-neutral)" }}>
          {item.period?.start && item.period?.end && (
            <p style={{ color: "var(--home-text-2)" }}>
              Período analisado: {new Date(item.period.start).toLocaleDateString("pt-BR")} a{" "}
              {new Date(item.period.end).toLocaleDateString("pt-BR")}
            </p>
          )}
          {typeof reason.plain_language_reason === "string" && (
            <p style={{ color: "var(--home-text-2)" }}>{reason.plain_language_reason}</p>
          )}
          <p style={{ color: "var(--home-text-3)" }}>
            Confiança do Nino: {Math.round((item.confidence ?? 0.5) * 100)}% · leitura {item.kind === "pattern" ? "de padrão" : "do período atual"}.
          </p>
        </div>
      )}
    </article>
  );
}
