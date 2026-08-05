import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useNinoExposure } from "@/hooks/useNinoExposure";
import { brl } from "@/lib/nino/format";
import { actionLabel, safeRoute, type NinoItem } from "@/lib/nino/intelligence";

/** Linha compacta para leituras secundárias — sem borda colorida, sem competir com o principal. */
export function NinoChangeRow({ item, surface, rank }: { item: NinoItem; surface: string; rank: number }) {
  const ref = useNinoExposure(item.id, surface, rank, `secondary;kind=${item.kind}`);
  const impact = typeof item.impact_amount === "number" && item.impact_amount > 0 ? item.impact_amount : null;
  return (
    <Link
      ref={ref as React.RefObject<HTMLAnchorElement>}
      to={safeRoute(item.primary_action)}
      className="flex min-h-[56px] items-center gap-3 rounded-[16px] px-4 py-3 transition active:scale-[0.99]"
      style={{ border: "1px solid var(--home-hairline)", background: "var(--home-surface)" }}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold" style={{ color: "var(--home-text-1)" }}>
          {item.title}
        </p>
        <p className="truncate text-[11.5px]" style={{ color: "var(--home-text-3)" }}>
          {impact ? `${brl(impact)} · ` : ""}
          {item.summary || actionLabel(item.primary_action, "Abrir", item.kind)}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--home-text-3)" }} />
    </Link>
  );
}
