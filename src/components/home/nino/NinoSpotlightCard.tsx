// Nino Spotlight — a orientação mais relevante do momento, uma por vez.
// Anatomia fixa: eyebrow, headline, texto de apoio, valor único, CTA e ação
// secundária opcional. Nenhum número é calculado aqui.
import { useEffect, useRef } from "react";
import { ArrowRight, CheckCircle, SpinnerGap, Target, TrendUp, Warning } from "@phosphor-icons/react";
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
};

export function NinoSpotlightCard({ item, accepting, onAccept, acceptedMessage, surface = "home" }: Props) {
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
      className="relative overflow-hidden rounded-[20px] border border-border bg-card p-5 pl-6 shadow-sm animate-fade-in"
    >
      <span className={cn("absolute inset-y-0 left-0 w-[3px] opacity-80", tone.accent)} aria-hidden="true" />

      <div className="flex items-center gap-2">
        <tone.Icon size={16} weight="duotone" className={tone.text} aria-hidden="true" />
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{item.eyebrow}</p>
        <span className="sr-only">{tone.label}</span>
      </div>

      <h2 className="mt-2 font-display text-[21px] font-bold leading-[27px] text-foreground">{item.headline}</h2>

      {item.supportingText ? (
        <p className="mt-2 text-[15px] leading-[21px] text-muted-foreground">{item.supportingText}</p>
      ) : null}

      {item.mainValue !== null ? (
        <p className="mt-4 font-display text-[29px] font-semibold leading-none tabular-nums text-foreground">
          {formatBRL(item.mainValue)}
          {item.mainValueSuffix ? (
            <span className="ml-1.5 align-middle text-[13px] font-medium text-muted-foreground">{item.mainValueSuffix}</span>
          ) : null}
        </p>
      ) : null}

      {acceptedMessage ? (
        <p className="mt-4 text-[15px] font-medium leading-[21px] text-success">{acceptedMessage}</p>
      ) : primary ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
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
    </section>
  );
}
