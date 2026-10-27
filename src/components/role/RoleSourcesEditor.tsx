import { Plus, Trash2 } from "lucide-react";
import { formatBRL } from "@/lib/split/math";
import { sourcesBalance, type FlowSourceKind } from "@/lib/split/roleFlow";

export type SourceRow = {
  kind: FlowSourceKind;
  ref_id: string;
  amount: string;
  /** false = o gasto já está (ou vai entrar) pela fatura/extrato: não lançar de novo. */
  register_transaction: boolean;
  installments: string;
  first_due: string;
};

type Option = { id: string; name: string; active?: boolean };

const money = (value: string) => Number(String(value || "0").replace(/\./g, "").replace(",", "."));

export const emptySource = (kind: FlowSourceKind = "account"): SourceRow => ({
  kind, ref_id: "", amount: "", register_transaction: kind !== "debt", installments: "", first_due: "",
});

export function sourcesToRpc(rows: SourceRow[]) {
  return rows.map((r) => ({
    kind: r.kind,
    ref_id: r.ref_id,
    amount: money(r.amount),
    register_transaction: r.kind === "debt" ? false : r.register_transaction,
    installments: r.installments ? Number(r.installments) : null,
    first_due: r.first_due || null,
  }));
}

export function RoleSourcesEditor({
  total, rows, onChange, accounts, cards, debts,
}: {
  total: number;
  rows: SourceRow[];
  onChange: (rows: SourceRow[]) => void;
  accounts: Option[];
  cards: Option[];
  debts: Option[];
}) {
  const balance = sourcesBalance(total, rows.map((r) => money(r.amount)));
  const update = (i: number, patch: Partial<SourceRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const optionsFor = (kind: FlowSourceKind) => (kind === "account" ? accounts : kind === "credit_card" ? cards : debts).filter((o) => o.active !== false);
  const ledgerCount = rows.filter((r) => r.kind !== "debt").length;

  return (
    <div className="space-y-3" data-testid="role-sources-editor">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">De onde saiu o valor? *</p>
      {rows.map((r, i) => (
        <div key={i} className="space-y-2 rounded-xl border p-3">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <select
              aria-label="Tipo de origem"
              value={r.kind}
              onChange={(e) => update(i, { ...emptySource(e.target.value as FlowSourceKind), amount: r.amount })}
              className="input"
            >
              <option value="account">Conta bancária</option>
              <option value="credit_card">Cartão de crédito</option>
              <option value="debt">Dívida (ex.: cartão de outra pessoa)</option>
            </select>
            {rows.length > 1 && (
              <button type="button" aria-label="Remover origem" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="text-destructive">
                <Trash2 size={15} />
              </button>
            )}
          </div>
          <div className="grid grid-cols-[1fr_8rem] gap-2">
            <select aria-label="Qual" value={r.ref_id} onChange={(e) => update(i, { ref_id: e.target.value })} className="input">
              <option value="">Selecione</option>
              {optionsFor(r.kind).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <input aria-label="Valor desta origem" inputMode="decimal" placeholder="Valor" value={r.amount} onChange={(e) => update(i, { amount: e.target.value })} className="input" />
          </div>
          {r.kind === "credit_card" && (
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="Parcelas no cartão" inputMode="numeric" placeholder="Parcelas (ex.: 6)" value={r.installments} onChange={(e) => update(i, { installments: e.target.value.replace(/\D/g, "") })} className="input" />
              <input aria-label="Primeira fatura" type="date" value={r.first_due} onChange={(e) => update(i, { first_due: e.target.value })} className="input" />
            </div>
          )}
          {r.kind !== "debt" && (
            <label className="flex gap-2 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={!r.register_transaction} onChange={(e) => update(i, { register_transaction: !e.target.checked })} />
              Não lançar de novo: este gasto já está (ou vai entrar) pela fatura/extrato
            </label>
          )}
          {r.kind === "debt" && <p className="text-[11px] text-muted-foreground">Dívida não gera gasto novo: só entra no fluxo do rolê.</p>}
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => onChange([...rows, emptySource("debt")])} className="inline-flex items-center gap-1 text-xs text-primary">
          <Plus size={13} /> Adicionar outra origem
        </button>
        <p className={`text-xs ${balance.ok ? "text-success" : "text-destructive"}`}>
          {balance.ok ? "Origens fecham com o total" : balance.remaining > 0 ? `Faltam ${formatBRL(balance.remaining)}` : `Passou ${formatBRL(-balance.remaining)}`}
        </p>
      </div>
      {ledgerCount > 1 && <p className="text-[11px] text-destructive">Use no máximo um cartão ou conta (podem ser várias dívidas).</p>}
    </div>
  );
}
