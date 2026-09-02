// Nino Spotlight — a orientação mais relevante do momento, uma por vez.
// Anatomia fixa (nino_home_editorial.v3): eyebrow, headline, contexto causal,
// conselho do Nino, valor único, CTA, ação secundária e o controle terciário
// "Outra orientação". Nenhum número é calculado aqui.
import { useEffect, useRef } from "react";
import { ArrowsClockwise, ArrowRight, CheckCircle, SpinnerGap, Target, TrendUp, Warning } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/engine/facts";
import { trackNinoEditorial, trackNinoEditorialOnce } from "@/lib/analytics/ninoEditorial";
import type { NinoEditorialTone, NinoSpotlightItem } from "@/lib/nino/homeEditorial";
import { cn } from "@/lib/utils";

const TONE: Record<NinoEditorialTone, { accent: string; text: string; Icon: typeof Warning; label: string }> = {
  critical: { accent: "bg-destructive", text: "text-destructive", Icon: Warning, label: "Risco" },
  attention: { accent: "bg-warning", text: "text-warning", Icon: Warning, label: "Atenção" },
  decision: { accent: "bg-primary", text: "text-primary", Icon: Target, label: "Decisão" },
  opportunity: { accent: "bg-primary", text: "text-primary", Icon: TrendUp, label: "Oportunidade" },
  progress: { accent: "bg-success", text: "text-success", Icon: CheckCircle, label: "Progresso" },
  neutral: { accent: "bg-border", text: "text-muted-foreground", Icon: Target, label: "Leitura" },
};

type Props = {
  item: NinoSpotlightItem;
  accepting?: boolean;
  onAccept?: () => void;
  acceptedMessage?: string | null;
  surface?: string;
  /** Rotação editorial: só aparece quando existe alternativa relevante. */
  canRequestNext?: boolean;
  onRequestNext?: () => void;
  requestNextNotice?: string | null;
};

export function NinoSpotlightCard({
  item,
  accepting,
  onAccept,
  acceptedMessage,
  surface = "home",
  canRequestNext,
  onRequestNext,
  requestNextNotice,
}: Props) {
  const tone = TONE[item.tone];
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          trackNinoEditorialOnce("nino_spotlight_impression", {
            item_id: item.id,
            semantic_type: item.semanticType,
            priority: item.priority,
            surface,
          });
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [item.id, item.priority, item.semanticType, surface]);

  const primary = item.primaryAction;
  const secondary = item.secondaryAction;

  const trackPrimary = () =>
    trackNinoEditorial("nino_spotlight_primary_action", {
      item_id: item.id,
      semantic_type: item.semanticType,
      priority: item.priority,
      surface,
      action: primary?.kind,
    });

  return (
    <section
      ref={ref}
      aria-label="Orientação do Nino"
      aria-live="polite"
      className="relative flex flex-col overflow-hidden rounded-[18px] border border-border bg-card px-4 py-4 pl-[18px] shadow-[0_1px_2px_hsl(var(--foreground)/0.03)]"
    >
      <span className={cn("absolute inset-y-0 left-0 w-[2px] opacity-70", tone.accent)} aria-hidden="true" />

      {/* key por item: a troca refaz o conteúdo com fade, no próprio lugar. */}
      <div key={item.id} className="flex flex-col animate-fade-in">
        <div className="flex items-center gap-1.5">
          <tone.Icon size={13} weight="duotone" className={tone.text} aria-hidden="true" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{item.eyebrow}</p>
          <span className="sr-only">{tone.label}</span>
        </div>

        <h2 className="mt-1.5 line-clamp-2 font-display text-[16px] font-semibold leading-[21px] tracking-[-0.01em] text-foreground">
          {item.headline}
        </h2>

        {item.contextText ? (
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-[17px] text-muted-foreground">{item.contextText}</p>
        ) : item.supportingText ? (
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-[17px] text-muted-foreground">{item.supportingText}</p>
        ) : null}

        {item.recommendation ? (
          <p className="mt-1.5 line-clamp-1 text-[12.5px] font-semibold leading-[17px] text-foreground">{item.recommendation}</p>
        ) : null}

        {item.mainValue !== null ? (
          <p className="mt-2 font-display text-[21px] font-semibold leading-none tabular-nums text-foreground">
            {formatBRL(item.mainValue)}
            {item.mainValueSuffix ? (
              <span className="ml-1 align-middle text-[11px] font-medium text-muted-foreground">{item.mainValueSuffix}</span>
            ) : null}
          </p>
        ) : null}

        {acceptedMessage ? (
          <p className="mt-2.5 text-[13px] font-medium leading-[18px] text-success">{acceptedMessage}</p>
        ) : (
          // Uma única linha de ações em peso de link: o card não ocupa a Home
          // com botão cheio. A ação principal continua sendo a primeira.
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {primary ? (
              primary.kind === "accept" ? (
                <button
                  type="button"
                  disabled={accepting}
                  aria-label={primary.label}
                  onClick={() => {
                    trackPrimary();
                    onAccept?.();
                  }}
                  className="inline-flex min-h-[28px] items-center gap-1 text-[13px] font-semibold text-primary underline-offset-4 hover:underline disabled:opacity-60"
                >
                  {accepting ? <SpinnerGap className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                  {primary.label}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : (
                <Link
                  to={primary.route ?? "/app/nino"}
                  aria-label={primary.label}
                  onClick={trackPrimary}
                  className="inline-flex min-h-[28px] items-center gap-1 text-[13px] font-semibold text-primary underline-offset-4 hover:underline"
                >
                  {primary.label}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              )
            ) : null}

            {secondary ? (
              <Link
                to={secondary.route ?? "/app/nino"}
                aria-label={secondary.label}
                onClick={() =>
                  trackNinoEditorial("nino_spotlight_secondary_action", {
                    item_id: item.id,
                    semantic_type: item.semanticType,
                    priority: item.priority,
                    surface,
                    action: secondary.kind,
                  })
                }
                className="inline-flex min-h-[28px] items-center text-[13px] font-medium text-muted-foreground underline-offset-4 hover:underline"
              >
                {secondary.label}
              </Link>
            ) : null}

            {/* Peso terciário: explorar outra leitura nunca compete com a ação. */}
            {onRequestNext && canRequestNext ? (
              <button
                type="button"
                data-testid="nino-spotlight-next"
                aria-label="Mostrar outra orientação do Nino"
                onClick={onRequestNext}
                className="inline-flex min-h-[28px] items-center gap-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowsClockwise size={14} weight="bold" aria-hidden="true" />
                Outra orientação
              </button>
            ) : null}
          </div>
        )}
      </div>

      {requestNextNotice ? (
        <p className="mt-1 text-[12px] leading-[16px] text-muted-foreground" role="status">
          {requestNextNotice}
        </p>
      ) : null}
    </section>

  );
}

