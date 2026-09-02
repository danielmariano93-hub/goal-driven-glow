// Insight compacto do Insight Stack: uma linha (64–76px), sem card grande.
// O corpo abre o detalhe; o menu "•••" troca somente esta leitura.
import { useEffect, useRef } from "react";
import { CaretRight, CheckCircle, DotsThree, Info, Lightbulb, Warning } from "@phosphor-icons/react";
import { Link, useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

type Props = {
  item: NinoSupportingItem;
  surface?: string;
  canRequestNext?: boolean;
  onRequestNext?: () => void;
  notice?: string | null;
};

export function NinoInsightRow({ item, surface = "home", canRequestNext, onRequestNext, notice }: Props) {
  const tone = TONE[item.tone];
  const ref = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

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

  const trackOpen = () =>
    trackNinoEditorial("nino_supporting_insight_open", {
      item_id: item.id,
      semantic_type: item.semanticType,
      priority: item.priority,
      surface,
    });

  return (
    <div ref={ref} className="relative">
      <div className="grid min-h-[64px] max-h-[76px] w-full grid-cols-[auto_1fr_auto_auto] items-center gap-2 pl-4 pr-1">
        <tone.Icon size={20} weight="duotone" className={cn("shrink-0", tone.text)} aria-hidden="true" />
        <Link
          key={item.id}
          to={item.route}
          aria-label={item.title}
          onClick={trackOpen}
          className="min-w-0 animate-fade-in py-3 text-left"
        >
          <span className="block truncate text-[15px] font-semibold leading-[20px] text-foreground">{item.title}</span>
          {item.supportingText ? (
            <span className="mt-0.5 block truncate text-[13px] leading-[17px] text-muted-foreground">{item.supportingText}</span>
          ) : null}
        </Link>
        <CaretRight size={16} weight="bold" className="shrink-0 self-center text-muted-foreground" aria-hidden="true" />

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Mais opções para ${item.title}`}
            data-testid="nino-supporting-menu"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <DotsThree size={18} weight="bold" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[184px]">
            {canRequestNext && onRequestNext ? (
              <DropdownMenuItem
                aria-label={`Mostrar outra dica no lugar de ${item.title}`}
                onSelect={() => onRequestNext()}
              >
                Mostrar outra
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => { trackOpen(); navigate(item.route); }}>Ver detalhes</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {notice ? (
        <p className="px-4 pb-2 text-[12px] leading-[16px] text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
