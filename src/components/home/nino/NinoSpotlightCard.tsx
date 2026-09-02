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
      className="relative flex flex-col overflow-hidden rounded-[22px] border border-border bg-card px-5 py-[18px] pl-6 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]"
    >
      <span className={cn("absolute inset-y-0 left-0 w-[3px] opacity-80", tone.accent)} aria-hidden="true" />

      {/* key por item: a troca refaz o conteúdo com fade, no próprio lugar. */}
      <div key={item.id} className="flex flex-col animate-fade-in">
        <div className="flex items-center gap-2">
          <tone.Icon size={15} weight="duotone" className={tone.text} aria-hidden="true" />
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{item.eyebrow}</p>
          <span className="sr-only">{tone.label}</span>
        </div>

        <h2 className="mt-2 line-clamp-3 font-display text-[19px] font-bold leading-[24px] text-foreground">{item.headline}</h2>

        {item.contextText ? (
          <p className="mt-1.5 line-clamp-3 text-[14px] leading-[20px] text-muted-foreground">{item.contextText}</p>
        ) : item.supportingText ? (
          <p className="mt-1.5 line-clamp-3 text-[14px] leading-[20px] text-muted-foreground">{item.supportingText}</p>
        ) : null}

        {item.recommendation ? (
          <p className="mt-2 line-clamp-2 text-[14px] font-semibold leading-[20px] text-foreground">{item.recommendation}</p>
        ) : null}

        {item.mainValue !== null ? (
          <p className="mt-3 font-display text-[29px] font-semibold leading-none tabular-nums text-foreground">
            {formatBRL(item.mainValue)}
            {item.mainValueSuffix ? (
              <span className="ml-1.5 align-middle text-[13px] font-medium text-muted-foreground">{item.mainValueSuffix}</span>
            ) : null}
          </p>
        ) : null}

        {acceptedMessage ? (
          <p className="mt-3 text-[15px] font-medium leading-[21px] text-success">{acceptedMessage}</p>
        ) : primary ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {primary.kind === "accept" ? (
              <Button
                type="button"
                className="h-11 rounded-full px-5 text-[15px]"
                disabled={accepting}
                aria-label={primary.label}
                onClick={() => {
                  trackPrimary();
                  onAccept?.();
                }}
              >
                {accepting ? <SpinnerGap className="mr-1.5 animate-spin" aria-hidden="true" /> : null}
                {primary.label}
              </Button>
            ) : (
              <Button asChild className="h-11 rounded-full px-5 text-[15px]">
                <Link to={primary.route ?? "/app/nino"} aria-label={primary.label} onClick={trackPrimary}>
                  {primary.label}
                  <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            )}
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
                className="inline-flex min-h-[44px] items-center text-[15px] font-medium text-muted-foreground underline-offset-4 hover:underline"
              >
                {secondary.label}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Peso terciário: explorar outra leitura nunca compete com a ação. */}
      {onRequestNext && canRequestNext ? (
        <button
          type="button"
          data-testid="nino-spotlight-next"
          aria-label="Mostrar outra orientação do Nino"
          onClick={onRequestNext}
          className="mt-1 -ml-1 inline-flex min-h-[44px] w-fit items-center gap-1.5 self-start rounded-full px-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowsClockwise size={18} weight="bold" aria-hidden="true" />
          Outra orientação
        </button>
      ) : null}

      {requestNextNotice ? (
        <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground" role="status">
          {requestNextNotice}
        </p>
      ) : null}
    </section>
  );
}
