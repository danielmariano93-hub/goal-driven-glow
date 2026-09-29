import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { CategorySelect } from "@/components/CategorySelect";
import { formatBRL } from "@/lib/engine/facts";
import { invalidateFinancialQueries } from "@/lib/db/invalidation";
import { notifyError, notifySuccess, humanizeError } from "@/lib/ui/feedback";
import { parseCounterpartyGroups, type CounterpartyGroup } from "@/lib/categories/counterparties";

/**
 * nino_counterparty_categorize.v1 — "os 11 Pix para a Pamela são de quê?".
 * Uma escolha por favorecido categoriza todos os lançamentos dele e ensina o
 * Nino para os próximos.
 */
export function CounterpartyCategorizer() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const groups = useQuery<CounterpartyGroup[]>({
    queryKey: ["uncategorized-counterparties", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any).call(supabase, "my_uncategorized_counterparties", { _limit: 12 });
      if (error) throw error;
      return parseCounterpartyGroups(data);
    },
  });
  const [choice, setChoice] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const items = (groups.data ?? []).filter((group) => group.transactions >= 2);
  if (!items.length) return null;

  const apply = async (group: CounterpartyGroup) => {
    const categoryId = choice[group.id];
    if (!categoryId) return;
    setSaving(group.id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any).call(supabase, "categorize_counterparty", {
        _key: group.counterparty_key,
        _type: group.transaction_type,
        _category_id: categoryId,
      });
      if (error) throw error;
      const count = Number(data ?? 0);
      notifySuccess(
        `${count} lançamento${count === 1 ? "" : "s"} categorizado${count === 1 ? "" : "s"}`,
        "Os próximos desse nome já chegam com essa categoria.",
      );
      invalidateFinancialQueries(qc);
      await qc.invalidateQueries({ queryKey: ["uncategorized-counterparties"] });
    } catch (e) {
      notifyError("Não consegui categorizar esse grupo", humanizeError(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="mb-4 rounded-2xl border border-border bg-card p-3" aria-label="Organizar por favorecido">
      <header className="mb-2 flex items-start gap-2">
        <Users size={16} className="mt-0.5 text-primary" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">Organizar por favorecido</p>
          <p className="text-xs text-muted-foreground">Escolha uma vez e todos os lançamentos desse nome ficam categorizados, inclusive os próximos.</p>
        </div>
      </header>
      <ul className="divide-y divide-border">
        {items.map((group) => (
          <li key={group.id} className="flex flex-wrap items-center gap-2 py-2">
            <div className="min-w-0 flex-1 basis-[180px]">
              <p className="truncate text-sm font-medium" title={group.label}>{group.display_name}</p>
              <p className="text-[11px] text-muted-foreground">
                {group.transactions} {group.direction === "recebido" ? "recebimentos" : "pagamentos"} · {formatBRL(group.total)}
              </p>
            </div>
            <CategorySelect
              value={choice[group.id] ?? null}
              onChange={(id) => setChoice((current) => ({ ...current, [group.id]: id }))}
              type={group.transaction_type}
              className="min-w-[150px] flex-1 basis-[150px] sm:flex-none"
            />
            <button
              type="button"
              disabled={!choice[group.id] || saving === group.id}
              onClick={() => apply(group)}
              className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving === group.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Aplicar a todos
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
