import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/split/math";
import { computeRoleFlow, type FlowReceivable, type FlowSource } from "@/lib/split/roleFlow";

type SourceRecord = {
  kind: "debt" | "credit_card" | "account";
  amount: number | string;
  installments: number | null;
  first_due: string | null;
  debt_id: string | null;
  credit_card_id: string | null;
  account_id: string | null;
};

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

/** Visão só do dono: de onde veio o valor e como entra/sai o caixa mês a mês. Os participantes nunca recebem isto. */
export function RoleFlowCard({ expenseId, occurredAt, receivables }: { expenseId: string; occurredAt: string; receivables: FlowReceivable[] }) {
  const [sources, setSources] = useState<FlowSource[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from("shared_expense_sources" as never).select("*").eq("shared_expense_id" as never, expenseId as never);
      const rows = (data ?? []) as unknown as SourceRecord[];
      if (!alive) return;
      if (!rows.length) { setSources([]); return; }
      const debtIds = rows.map((r) => r.debt_id).filter(Boolean) as string[];
      const cardIds = rows.map((r) => r.credit_card_id).filter(Boolean) as string[];
      const accIds = rows.map((r) => r.account_id).filter(Boolean) as string[];
      const [debts, cards, accs] = await Promise.all([
        debtIds.length ? supabase.from("debts").select("id,name,creditor,installments_total,installments_paid,first_due_date,due_day").in("id", debtIds) : Promise.resolve({ data: [] as any[] }),
        cardIds.length ? supabase.from("credit_cards").select("id,name").in("id", cardIds) : Promise.resolve({ data: [] as any[] }),
        accIds.length ? supabase.from("accounts").select("id,name").in("id", accIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const debtById = new Map(((debts.data ?? []) as any[]).map((d) => [d.id, d]));
      const label: Record<string, string> = {};
      ((cards.data ?? []) as any[]).forEach((c) => { label[c.id] = c.name; });
      ((accs.data ?? []) as any[]).forEach((a) => { label[a.id] = a.name; });
      debtById.forEach((d: any, id) => { label[id] = d.name; });
      if (!alive) return;
      setNames(label);
      setSources(rows.map((r) => {
        const debt = r.debt_id ? debtById.get(r.debt_id) : null;
        return {
          kind: r.kind, amount: Number(r.amount), installments: r.installments, first_due: r.first_due,
          label: label[r.debt_id ?? r.credit_card_id ?? r.account_id ?? ""] ?? undefined,
          debt: debt ? { installments_total: debt.installments_total, installments_paid: debt.installments_paid, first_due_date: debt.first_due_date, due_day: debt.due_day } : null,
        } as FlowSource;
      }));
    })();
    return () => { alive = false; };
  }, [expenseId]);

  const flow = useMemo(() => computeRoleFlow(sources ?? [], receivables, occurredAt), [sources, receivables, occurredAt]);
  if (!sources || sources.length === 0) return null;
  const kindLabel = { debt: "Dívida", credit_card: "Cartão", account: "Conta" } as const;

  return (
    <section className="surface-card space-y-3 p-4" aria-label="Fluxo do rolê (só você vê)">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Fluxo do rolê · só você vê</p>
        <ul className="mt-2 space-y-1 text-xs">
          {sources.map((s, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span>{kindLabel[s.kind]}{s.label ? ` · ${s.label}` : ""}</span>
              <strong className="tabular-nums">{formatBRL(s.amount)}</strong>
            </li>
          ))}
        </ul>
      </div>
      {flow.months.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] tabular-nums">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2 font-medium">Mês</th><th className="px-1 text-right font-medium">Entra</th><th className="px-1 text-right font-medium">Sai</th><th className="px-1 text-right font-medium">Mês</th><th className="pl-1 text-right font-medium">Acumulado</th></tr></thead>
              <tbody>
                {flow.months.map((m) => (
                  <tr key={m.month} className="border-t border-border">
                    <td className="py-1 pr-2">{monthLabel(m.month)}</td>
                    <td className="px-1 text-right text-success">{formatBRL(m.inflow)}</td>
                    <td className="px-1 text-right">{formatBRL(m.outflow)}</td>
                    <td className={`px-1 text-right ${m.net < 0 ? "text-destructive" : "text-success"}`}>{formatBRL(m.net)}</td>
                    <td className={`pl-1 text-right ${m.cumulative < 0 ? "text-destructive" : "text-success"}`}>{formatBRL(m.cumulative)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {flow.peakExposure > 0 && (
            <p className="text-xs text-muted-foreground">
              Você chega a ter <strong className="text-foreground">{formatBRL(flow.peakExposure)}</strong> adiantados em {monthLabel(flow.peakMonth!)}
              {flow.endBalance < 0 ? <> e termina em <strong className="text-foreground">{formatBRL(-flow.endBalance)}</strong>, que é a sua parte.</> : "."}
            </p>
          )}
        </>
      )}
    </section>
  );
}
