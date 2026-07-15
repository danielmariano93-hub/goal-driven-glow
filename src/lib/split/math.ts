export interface SplitParticipantInput {
  name: string;
  phone_e164?: string | null;
  amount_due?: number;
}

export interface SplitResult {
  name: string;
  amount_due: number; // reais (2 casas)
  is_owner: boolean;
}

/** Divisão igual com distribuição do centavo residual. Determinística. */
export function splitEqual(
  total: number,
  participants: { name: string; is_owner?: boolean }[],
): SplitResult[] {
  if (!(total > 0)) throw new Error("total inválido");
  if (participants.length === 0) throw new Error("sem participantes");
  const totalCents = Math.round(total * 100);
  const n = participants.length;
  const base = Math.floor(totalCents / n);
  let remainder = totalCents - base * n;

  // Ordem: dono primeiro (recebe primeiro os centavos), depois alfabética estável
  const ordered = [...participants].sort((a, b) => {
    if ((a.is_owner ? 0 : 1) !== (b.is_owner ? 0 : 1)) {
      return (a.is_owner ? 0 : 1) - (b.is_owner ? 0 : 1);
    }
    return a.name.localeCompare(b.name, "pt-BR");
  });

  return ordered.map((p) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder = Math.max(0, remainder - 1);
    return {
      name: p.name,
      amount_due: (base + extra) / 100,
      is_owner: !!p.is_owner,
    };
  });
}

/** Valida soma de divisão personalizada com tolerância de 1 centavo. */
export function validateCustomSplit(total: number, values: number[]): { ok: boolean; sum: number } {
  const sum = values.reduce((a, b) => a + Math.round(b * 100), 0) / 100;
  return { ok: Math.abs(sum - total) < 0.005, sum };
}

export function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
