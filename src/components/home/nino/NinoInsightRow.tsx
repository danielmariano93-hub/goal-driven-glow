// Insight compacto do Insight Stack: uma linha, sem feedback, sem card grande.
import { useEffect, useRef } from "react";
import { CaretRight, CheckCircle, Info, Lightbulb, Warning } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { trackNinoEditorial, trackNinoEditorialOnce } from "@/lib/analytics/ninoEditorial";
import type { NinoEditorialTone, NinoSupportingItem } from "@/lib/nino/homeEditorial";
import { cn } from "@/lib/utils";

const TONE: Record<NinoEditorialTone, { text: string; Icon: typeof Warning }> = {
  critical: { text: "text-destructive", Icon: Warning },
  attention: { text: "text-warning", Icon: Warning },
  decision: { text: "text-primary", Icon: Lightbulb },
  opportunity: { text: "text-primary", Icon: Lightbulb },
  progress: { text: "text-success", Icon: CheckCircle },
  neutral: { text: "text-muted-foreground", Icon: Info },
};

export function NinoInsightRow({ item, surface = "home" }: { item: NinoSupportingItem; surface?: string }) {
  const tone = TONE[item.tone];
  const ref = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          trackNinoEditorialOnce("nino_supporting_insight_impression", {
            item_id: item.id,
            semantic_type: item.semanticType,
            priority: item.priority,
            surface,
          });
          observer.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [item.id, item.priority, item.semanticType, surface]);

  return (
    <Link
      ref={ref}
      to={item.route}
      aria-label={item.title}
      onClick={() =>
        trackNinoEditorial("nino_supporting_insight_open", {
          item_id: item.id,
          semantic_type: item.semanticType,
          priority: item.priority,
          surface,
        })
      }
      className="grid min-h-[64px] max-h-[76px] w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 text-left transition-colors first:rounded-t-[16px] last:rounded-b-[16px] hover:bg-secondary/50"
    >
      <tone.Icon size={20} weight="duotone" className={cn("shrink-0", tone.text)} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold leading-[20px] text-foreground">{item.title}</span>
        {item.supportingText ? (
          <span className="mt-0.5 block truncate text-[13px] leading-[17px] text-muted-foreground">{item.supportingText}</span>
        ) : null}
      </span>
      <CaretRight size={16} weight="bold" className="shrink-0 self-center text-muted-foreground" aria-hidden="true" />
    </Link>

  );
}
