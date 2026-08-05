import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { useNinoExposure } from "@/hooks/useNinoExposure";
import { brl } from "@/lib/nino/format";
import {
  actionLabel,
  safeRoute,
  useNinoDuplicateDecision,
  type NinoDuplicatePair,
  type NinoItem,
} from "@/lib/nino/intelligence";

function pairsOf(item: NinoItem): NinoDuplicatePair[] {
  const raw = (item.evidence ?? {}) as Record<string, unknown>;
  const list = Array.isArray(raw.pairs) ? raw.pairs : [];
  return list
    .map((p) => p as Record<string, unknown>)
    .filter((p) => typeof p.pair_key === "string")
    .map((p) => ({
      pair_key: String(p.pair_key),
      merchant: String(p.merchant ?? "Lançamento"),
      amount: Number(p.amount ?? 0),
      occurred_at: (p.occurred_at as string | null) ?? null,
      count: Number(p.count ?? 2),
    }));
}

/**
 * Pendências operacionais agrupadas (duplicidades, itens sem categoria).
 * Não competem com a inteligência: peso visual neutro e ação direta.
 */
export function NinoOperationalSummaryCard({ item, surface, rank }: { item: NinoItem; surface: string; rank: number }) {
  const [open, setOpen] = useState(false);
  const decide = useNinoDuplicateDecision();
  const ref = useNinoExposure(item.id, surface, rank, `operational;topic=${item.logical_topic_key ?? ""}`);
  const pairs = pairsOf(item);

  const onDecide = async (pairKey: string, decision: "distinct" | "duplicate") => {
    try {
      await decide.mutateAsync({ pairKey, decision });
      toast.success(decision === "distinct" ? "Anotado: são compras diferentes." : "Marcado como duplicado para revisão.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className="rounded-[18px] p-4"
      style={{ border: "1px solid var(--home-hairline)", background: "var(--home-surface-neutral)" }}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-full p-1.5" style={{ background: "var(--home-surface)" }}>
          <ClipboardList className="h-4 w-4" style={{ color: "var(--home-text-2)" }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold" style={{ color: "var(--home-text-1)" }}>
            {item.title}
          </p>
          {item.summary && (
            <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--home-text-3)" }}>
              {item.summary}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {item.primary_action && (
          <Link
            to={safeRoute(item.primary_action, "/app/lancamentos")}
            className="inline-flex min-h-[40px] items-center rounded-full px-4 text-[12px] font-semibold"
            style={{ border: "1px solid var(--home-hairline)", background: "var(--home-surface)", color: "var(--home-text-1)" }}
          >
            {actionLabel(item.primary_action, "Resolver", item.kind)}
          </Link>
        )}
        {pairs.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex min-h-[40px] items-center gap-1 text-[11.5px] font-semibold"
            style={{ color: "var(--home-text-2)" }}
          >
            {open ? "Ocultar pares" : `Ver os ${pairs.length} pares`}
            <ChevronDown className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {open && pairs.length > 0 && (
        <ul className="mt-3 space-y-2">
          {pairs.map((p) => (
            <li
              key={p.pair_key}
              className="rounded-[14px] p-3"
              style={{ background: "var(--home-surface)", border: "1px solid var(--home-hairline)" }}
            >
              <p className="text-[12.5px] font-semibold" style={{ color: "var(--home-text-1)" }}>
                {p.merchant} · {brl(p.amount)}
              </p>
              <p className="text-[11px]" style={{ color: "var(--home-text-3)" }}>
                {p.count ?? 2} lançamentos iguais
                {p.occurred_at ? ` em ${new Date(p.occurred_at).toLocaleDateString("pt-BR")}` : ""}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={decide.isPending}
                  onClick={() => void onDecide(p.pair_key, "duplicate")}
                  className="min-h-[36px] rounded-full px-3 text-[11.5px] font-semibold text-white disabled:opacity-60"
                  style={{ background: "var(--home-brand-ink)" }}
                >
                  É duplicado
                </button>
                <button
                  type="button"
                  disabled={decide.isPending}
                  onClick={() => void onDecide(p.pair_key, "distinct")}
                  className="min-h-[36px] rounded-full px-3 text-[11.5px] font-semibold disabled:opacity-60"
                  style={{ border: "1px solid var(--home-hairline)", color: "var(--home-text-2)" }}
                >
                  São diferentes
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
