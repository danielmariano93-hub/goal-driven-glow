/** Parser do formato legado financial_ecosystem_v2 do MeuNino (ex-NoControle.ia, ex-Mindful Money). */

export interface LegacyPreview {
  lancamentos: number;
  metas: number;
  aportes: number;
  dividas: number;
  investimentos: number;
  emocoes: number;
  contasFixas: number;
  categoriasCustom: number;
  issues: { entity: string; line: number; reason: string }[];
  normalized: Record<string, unknown>;
}

const TIPO_MAP: Record<string, "income" | "expense" | "transfer"> = {
  receita: "income",
  entrada: "income",
  ganho: "income",
  despesa: "expense",
  saida: "expense",
  gasto: "expense",
  transferencia: "transfer",
};

function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  let s = String(v).replace(/[^\d,.-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // BR dd/mm/yyyy
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

export function parseLegacyPayload(raw: unknown): LegacyPreview {
  const issues: LegacyPreview["issues"] = [];
  const p = (raw ?? {}) as Record<string, unknown>;

  const lancamentos = Array.isArray(p.lancamentos) ? (p.lancamentos as any[]) : [];
  const metas = Array.isArray(p.metas) ? (p.metas as any[]) : [];
  const aportes = Array.isArray(p.aportes) ? (p.aportes as any[]) : [];
  const dividas = Array.isArray(p.dividas) ? (p.dividas as any[]) : [];
  const investimentos = Array.isArray(p.investimentos) ? (p.investimentos as any[]) : [];
  const emocoes = Array.isArray(p.emocoes) ? (p.emocoes as any[]) : [];
  const contasFixas = Array.isArray(p.contasFixas) ? (p.contasFixas as any[]) : [];
  const categoriasCustom = Array.isArray(p.categoriasCustom)
    ? (p.categoriasCustom as unknown[]).filter((c) => typeof c === "string")
    : [];

  const normLancamentos = lancamentos.map((it, i) => {
    const valor = toNumber(it.valor ?? it.amount);
    const data = toDate(it.data ?? it.occurred_at);
    const tipoRaw = String(it.tipo ?? it.type ?? "despesa").toLowerCase();
    const tipo = TIPO_MAP[tipoRaw] ?? "expense";
    if (valor == null) issues.push({ entity: "lancamentos", line: i, reason: "valor_invalido" });
    if (data == null) issues.push({ entity: "lancamentos", line: i, reason: "data_invalida" });
    return {
      id: it.id,
      tipo,
      valor: valor != null ? Math.abs(valor) : null,
      data,
      descricao: it.descricao ?? it.description ?? null,
      categoria: it.categoria ?? it.category_name ?? null,
      contaNome: it.contaNome ?? it.conta ?? it.account_name ?? null,
    };
  });

  const normMetas = metas.map((it, i) => {
    const alvo = toNumber(it.valorAlvo ?? it.valor_objetivo ?? it.target_amount);
    if (alvo == null) issues.push({ entity: "metas", line: i, reason: "valor_alvo_invalido" });
    return {
      id: it.id,
      nome: it.nome ?? it.name ?? "Meta",
      valorAlvo: alvo,
      dataAlvo: toDate(it.dataAlvo ?? it.prazo ?? it.target_date),
      prioridade: Number(it.prioridade ?? 3),
    };
  });

  const normAportes = aportes.map((it, i) => {
    const valor = toNumber(it.valor ?? it.amount);
    if (valor == null) issues.push({ entity: "aportes", line: i, reason: "valor_invalido" });
    return {
      id: it.id,
      metaNome: it.metaNome ?? it.meta_nome ?? null,
      metaId: it.metaId ?? it.meta_id ?? null,
      valor,
      data: toDate(it.data ?? it.occurred_at),
    };
  });

  const normDividas = dividas.map((it, i) => {
    const original = toNumber(it.valorOriginal ?? it.original_amount ?? it.valor_original);
    if (original == null) issues.push({ entity: "dividas", line: i, reason: "valor_original_invalido" });
    return {
      id: it.id,
      nome: it.nome ?? it.name ?? "Dívida",
      credor: it.credor ?? it.creditor ?? null,
      valorOriginal: original,
      saldoDevedor: toNumber(it.saldoDevedor ?? it.outstanding_balance) ?? original,
      parcela: toNumber(it.parcela ?? it.installment_amount),
      diaVencimento: Number(it.diaVencimento ?? it.due_day) || null,
    };
  });

  const normInvestimentos = investimentos.map((it, i) => {
    const atual = toNumber(it.valorAtual ?? it.current_value ?? it.valor_atual);
    const invested = toNumber(it.valorInvestido ?? it.invested_amount);
    if (atual == null && invested == null) issues.push({ entity: "investimentos", line: i, reason: "valores_ausentes" });
    return {
      id: it.id,
      nome: it.nome ?? it.name ?? "Investimento",
      valorAtual: atual ?? 0,
      valorInvestido: invested ?? 0,
    };
  });

  const normEmocoes = emocoes.map((it) => ({
    id: it.id,
    data: it.data ?? it.occurred_at ?? null,
    humor: it.humor ?? it.mood ?? "neutro",
    nota: it.nota ?? it.notes ?? null,
  }));

  const normContasFixas = contasFixas.map((it) => ({
    id: it.id,
    nome: it.nome ?? it.name,
    valor: toNumber(it.valor ?? it.amount),
    dia: Number(it.dia ?? it.day) || null,
    tipo: String(it.tipo ?? "despesa").toLowerCase(),
  }));

  return {
    lancamentos: normLancamentos.length,
    metas: normMetas.length,
    aportes: normAportes.length,
    dividas: normDividas.length,
    investimentos: normInvestimentos.length,
    emocoes: normEmocoes.length,
    contasFixas: normContasFixas.length,
    categoriasCustom: categoriasCustom.length,
    issues,
    normalized: {
      lancamentos: normLancamentos,
      metas: normMetas,
      aportes: normAportes,
      dividas: normDividas,
      investimentos: normInvestimentos,
      emocoes: normEmocoes,
      contasFixas: normContasFixas,
      categoriasCustom,
    },
  };
}
