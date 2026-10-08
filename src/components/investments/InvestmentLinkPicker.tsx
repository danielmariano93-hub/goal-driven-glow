import { formatBRL } from "@/lib/engine/facts";

export type LinkableInvestment = { id: string; name: string; current_value: number | string; reference_date?: string | null };

/**
 * Escolhe qual investimento um resgate/aplicação movimenta e mostra, ANTES de salvar, o efeito na posição.
 * `alreadyApplied`: o lançamento já está vinculado, então o valor atual do investimento já o considera.
 */
export function InvestmentLinkPicker({ kind, amount, occurredAt, value, investments, disabled, alreadyApplied, onChange }: {
  kind: "investment_redemption" | "investment_application";
  amount: number | string;
  occurredAt: string | null | undefined;
  value: string | null | undefined;
  investments: LinkableInvestment[];
  disabled?: boolean;
  alreadyApplied?: boolean;
  onChange: (id: string | null) => void;
}) {
  const redemption = kind === "investment_redemption";
  const total = Math.abs(Number(amount));
  const chosen = investments.find((i) => i.id === value) ?? null;
  const current = chosen ? Number(chosen.current_value) : 0;
  const beforeAnchor = Boolean(chosen?.reference_date && occurredAt && occurredAt.slice(0, 10) <= String(chosen.reference_date).slice(0, 10));
  const after = redemption ? current - total : current + total;
  const tooBig = redemption && total > current + 0.01;
  return (
    <div className="rounded-lg bg-primary/5 px-2 py-1.5 text-[11px]">
      <p className="text-muted-foreground">
        {redemption ? "Resgate: sai do investimento e entra na conta. Seu patrimônio não muda." : "Aplicação: sai da conta e entra no investimento. Seu patrimônio não muda."}
      </p>
      <label className="mt-1 flex items-center gap-2">
        <span className="shrink-0 font-medium">{redemption ? "Resgatado de" : "Aplicado em"}</span>
        <select value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} className="input-base min-w-0 flex-1 text-xs">
          <option value="">Escolha o investimento</option>
          {investments.map((i) => <option key={i.id} value={i.id}>{i.name} · {formatBRL(Number(i.current_value))}</option>)}
        </select>
      </label>
      {investments.length === 0 && <p className="mt-1 text-warning">Cadastre primeiro o investimento na aba Patrimônio.</p>}
      {chosen && alreadyApplied && <p className="mt-1 text-muted-foreground">Vinculado: o valor atual de {chosen.name} já considera este {redemption ? "resgate" : "aporte"}.</p>}
      {chosen && !alreadyApplied && beforeAnchor && <p className="mt-1 text-muted-foreground">Movimento anterior à data de referência da posição: fica vinculado, sem alterar o valor atual.</p>}
      {chosen && !alreadyApplied && !beforeAnchor && tooBig && <p className="mt-1 text-warning">Maior que a posição registrada ({formatBRL(current)}): fica pendente de conferência, sem zerar o investimento.</p>}
      {chosen && !alreadyApplied && !beforeAnchor && !tooBig && <p className="mt-1 tabular-nums">{chosen.name}: {formatBRL(current)} → <strong>{formatBRL(Math.max(0, after))}</strong></p>}
      {!chosen && <p className="mt-1 text-muted-foreground">Sem escolher, este {redemption ? "resgate" : "aporte"} não altera nenhum investimento.</p>}
    </div>
  );
}
