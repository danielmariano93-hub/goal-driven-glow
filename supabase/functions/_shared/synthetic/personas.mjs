// Perfis financeiros sintéticos do Nino. Tudo é determinístico: mesma persona + mesma data de referência
// => mesmos lançamentos. O gabarito (`buildTruth`) sai da PRÓPRIA lista semeada, não do código do Nino.
// Só categorias globais (as mesmas que toda conta tem). Sem cartão de crédito nesta versão (ver docs).

export function rng(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const ch of String(seed)) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const monthKey = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
/** Mês relativo: offset 0 = mês de `ref`, 1 = anterior, ... */
export function monthAt(ref, offset) {
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - offset, 1));
}
export const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const monthName = (ref, offset) => MONTH_NAMES[monthAt(ref, offset).getUTCMonth()];

const round2 = (n) => Math.round(n * 100) / 100;

// Definições: cada linha recorrente = [descrição, categoria, dia do mês, valor base, variação (0..1)].
export const PERSONAS = [
  { id: "clt_estavel", nome: "Marina (CLT estável)", desc: "salário fixo, aluguel, rotina previsível",
    income: [["Salário", "Salário", 5, 5200, 0]], fixed: [["Aluguel", "Moradia", 8, 1400, 0], ["Internet", "Serviços", 12, 110, 0], ["Netflix", "Assinaturas", 15, 55, 0]],
    variable: [["Mercado", "Mercado", 6, 420, 0.4], ["Uber", "Transporte", 5, 38, 0.6], ["iFood", "Alimentação", 6, 52, 0.5], ["Cinema", "Lazer", 1, 70, 0.3]],
    goals: [{ name: "Reserva de emergência", target_amount: 15000 }] },
  { id: "autonomo_irregular", nome: "Rafael (autônomo)", desc: "renda que oscila de mês a mês",
    income: [["Projeto site", "Renda Extra", 9, 3200, 0.8], ["Projeto logo", "Renda Extra", 21, 1800, 0.9]], fixed: [["Aluguel", "Moradia", 5, 1100, 0]],
    variable: [["Mercado", "Mercado", 5, 380, 0.5], ["Gasolina", "Transporte", 5, 150, 0.4], ["Almoço", "Alimentação", 14, 38, 0.5]], goals: [] },
  { id: "endividada", nome: "Carla (com dívidas)", desc: "salário baixo e duas dívidas ativas",
    income: [["Salário", "Salário", 5, 3100, 0]], fixed: [["Aluguel", "Moradia", 10, 950, 0], ["Luz", "Serviços", 15, 160, 0.2]],
    variable: [["Mercado", "Mercado", 6, 520, 0.3], ["Farmácia", "Saúde", 3, 90, 0.7], ["Ônibus", "Transporte", 20, 140, 0.1]],
    debts: [{ name: "Empréstimo pessoal", creditor: "Banco Azul", original_amount: 9000, outstanding_balance: 6400, installment_amount: 450, installments_total: 24, installments_paid: 8, due_day: 12, interest_rate_pct: 3.2 },
            { name: "Financiamento moto", creditor: "Financeira Sol", original_amount: 14000, outstanding_balance: 9800, installment_amount: 620, installments_total: 30, installments_paid: 10, due_day: 20, interest_rate_pct: 1.9 }], goals: [] },
  { id: "conta_vazia", nome: "Novo usuário (conta vazia)", desc: "acabou de criar a conta, nenhum lançamento",
    income: [], fixed: [], variable: [], goals: [] },
  { id: "poucos_dados", nome: "Beto (poucos dados)", desc: "só três lançamentos no total",
    income: [], fixed: [], variable: [], extra: [["Salário", "Salário", 5, 2500, 0, 0], ["Mercado", "Mercado", 8, 310, 0, 0], ["Uber", "Transporte", 9, 27.5, 0, 0]], goals: [] },
  { id: "casal_alta_renda", nome: "Helena e Pedro (alta renda)", desc: "duas rendas, muitas categorias, meta de viagem",
    income: [["Salário Helena", "Salário", 5, 9800, 0], ["Salário Pedro", "Salário", 7, 8400, 0], ["Dividendos", "Rendimento de Investimentos", 20, 900, 0.5]],
    fixed: [["Aluguel", "Moradia", 8, 4200, 0], ["Escola", "Educação", 10, 2100, 0], ["Plano de saúde", "Saúde", 12, 1350, 0], ["Streaming", "Assinaturas", 15, 130, 0]],
    variable: [["Mercado", "Mercado", 4, 1900, 0.3], ["Restaurante", "Alimentação", 6, 240, 0.6], ["Viagem fim de semana", "Lazer", 30, 1200, 0.9], ["Pet shop", "Pets", 25, 260, 0.4], ["Roupas", "Vestuário", 40, 450, 0.8]],
    goals: [{ name: "Viagem Europa", target_amount: 40000 }] },
  { id: "estudante", nome: "Lia (estudante)", desc: "mesada e freelas, gastos pequenos, muito delivery",
    income: [["Mesada", "Presente Recebido", 1, 1200, 0], ["Freela", "Renda Extra", 18, 450, 0.9]], fixed: [["Celular", "Serviços", 10, 45, 0], ["Spotify", "Assinaturas", 14, 21.9, 0]],
    variable: [["iFood", "Alimentação", 8, 36, 0.6], ["Lanche", "Alimentação", 12, 18, 0.5], ["Show", "Lazer", 2, 120, 0.8], ["Xerox", "Educação", 3, 25, 0.5]], goals: [{ name: "Notebook", target_amount: 3500 }] },
  { id: "aposentado", nome: "Seu Antônio (aposentado)", desc: "aposentadoria fixa, gasto forte com saúde",
    income: [["Aposentadoria", "Salário", 5, 3800, 0]], fixed: [["Plano de saúde", "Saúde", 8, 780, 0], ["Condomínio", "Moradia", 10, 620, 0]],
    variable: [["Farmácia", "Saúde", 2, 210, 0.5], ["Mercado", "Mercado", 6, 560, 0.3], ["Presente neto", "Presentes", 20, 90, 0.8]], goals: [] },
  { id: "poupador", nome: "Diego (poupador)", desc: "gasta menos da metade do que ganha",
    income: [["Salário", "Salário", 5, 8000, 0]], fixed: [["Aluguel", "Moradia", 8, 1500, 0]],
    variable: [["Mercado", "Mercado", 6, 600, 0.3], ["Transporte", "Transporte", 5, 120, 0.4], ["Lazer", "Lazer", 2, 200, 0.7]], goals: [{ name: "Apartamento", target_amount: 120000 }] },
  { id: "gastador_lazer", nome: "Bia (gasta com lazer)", desc: "lazer e restaurantes dominam o orçamento",
    income: [["Salário", "Salário", 5, 6000, 0]], fixed: [["Aluguel", "Moradia", 8, 1600, 0]],
    variable: [["Balada", "Lazer", 3, 260, 0.6], ["Restaurante", "Alimentação", 4, 170, 0.5], ["Bar", "Lazer", 6, 140, 0.6], ["Mercado", "Mercado", 8, 380, 0.3]], goals: [] },
  { id: "mes_no_vermelho", nome: "Júlio (no vermelho)", desc: "gasta mais do que ganha todo mês",
    income: [["Salário", "Salário", 5, 2800, 0]], fixed: [["Aluguel", "Moradia", 8, 1300, 0]],
    variable: [["Mercado", "Mercado", 6, 700, 0.2], ["Delivery", "Alimentação", 5, 90, 0.4], ["Roupas", "Vestuário", 25, 380, 0.6], ["Lazer", "Lazer", 15, 450, 0.5]], goals: [] },
  { id: "dono_de_pet", nome: "Sofia (tutora de pets)", desc: "gastos recorrentes com pets e saúde",
    income: [["Salário", "Salário", 5, 4500, 0]], fixed: [["Aluguel", "Moradia", 8, 1300, 0]],
    variable: [["Ração", "Pets", 10, 210, 0.2], ["Veterinário", "Pets", 18, 320, 0.8], ["Mercado", "Mercado", 6, 450, 0.3], ["Consulta", "Saúde", 22, 180, 0.7]], goals: [] },
];

const MONTHS_BACK = 6;

/** Gera accounts/transactions/debts/goals da persona. `ref` = data de referência (hoje, UTC). */
export function buildSpec(persona, ref = new Date()) {
  const r = rng(`${persona.id}`);
  const txs = [];
  const today = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  const add = (desc, category, type, day, base, variation, monthOffset) => {
    const m = monthAt(ref, monthOffset);
    const last = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)).getUTCDate();
    const date = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), Math.min(day, last)));
    if (date.getTime() > today) return; // nada no futuro
    const amount = round2(base * (1 + (r() * 2 - 1) * variation));
    txs.push({ date: ymd(date), type, amount: Math.max(1, amount), category, description: desc, account: "Conta corrente", status: "confirmed" });
  };
  for (let off = MONTHS_BACK; off >= 0; off--) {
    for (const [d, c, day, base, v] of persona.income ?? []) add(d, c, "income", day, base, v, off);
    for (const [d, c, day, base, v] of persona.fixed ?? []) add(d, c, "expense", day, base, v, off);
    for (const [d, c, day, base, v] of persona.variable ?? []) {
      // variáveis: 2 a 4 ocorrências por mês, espalhadas
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) add(d, c, "expense", Math.max(1, Math.min(28, day + i * 6 + Math.floor(r() * 3))), base / (n / 2), v, off);
    }
  }
  for (const [d, c, day, base] of persona.extra ?? []) add(d, c, c === "Salário" ? "income" : "expense", day, base, 0, 1);
  txs.sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description));
  return {
    display_name: persona.nome,
    reference_date: ymd(ref),
    accounts: [{ name: "Conta corrente", type: "checking", institution: "Banco Teste", opening_balance: 0 }],
    transactions: txs,
    debts: persona.debts ?? [],
    goals: (persona.goals ?? []).map((g) => ({ ...g, kind: "savings", target_date: ymd(new Date(Date.UTC(ref.getUTCFullYear() + 1, 11, 31))) })),
  };
}

/** Gabarito calculado da lista semeada (confirmados; transferências não existem aqui). Chaves: exp:M0, inc:M1,
 *  cat:M1:Mercado, net:M1, top:M1 (nome da maior categoria), topval:M1, debt:total, debt:installments, cnt:M0.
 *  Derivados (só com M1..M3 preenchidos): sum3:exp|inc|net, avg3:exp, diff12:exp, catsum12:<categoria>. */
export function buildTruth(spec, ref = new Date()) {
  const t = {};
  const idx = (offset) => monthKey(monthAt(ref, offset));
  const byMonth = {};
  for (const tx of spec.transactions) {
    if (tx.status !== "confirmed") continue;
    const k = tx.date.slice(0, 7);
    (byMonth[k] ??= []).push(tx);
  }
  for (let off = 0; off <= MONTHS_BACK; off++) {
    const k = idx(off);
    const list = byMonth[k] ?? [];
    const exp = list.filter((x) => x.type === "expense");
    const inc = list.filter((x) => x.type === "income");
    const sum = (a) => round2(a.reduce((s, x) => s + x.amount, 0));
    t[`exp:M${off}`] = sum(exp);
    t[`inc:M${off}`] = sum(inc);
    t[`net:M${off}`] = round2(sum(inc) - sum(exp));
    t[`cnt:M${off}`] = list.length;
    const cats = {};
    for (const x of exp) cats[x.category] = round2((cats[x.category] ?? 0) + x.amount);
    for (const [c, v] of Object.entries(cats)) t[`cat:M${off}:${c}`] = v;
    const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
    if (top) { t[`top:M${off}`] = top[0]; t[`topval:M${off}`] = top[1]; }
  }
  // Derivados (perguntas de vários passos): somas e médias de M3..M1, diferença M1 x M2, categoria somada em M1 e M2.
  if (["exp", "inc"].every((k) => [1, 2, 3].every((m) => typeof t[`${k}:M${m}`] === "number"))) {
    const sum3 = (k) => round2([1, 2, 3].reduce((a, m) => a + t[`${k}:M${m}`], 0));
    t["sum3:exp"] = sum3("exp");
    t["avg3:exp"] = round2(sum3("exp") / 3);
    t["sum3:inc"] = sum3("inc");
    t["sum3:net"] = round2(sum3("inc") - sum3("exp"));
    t["diff12:exp"] = round2(Math.abs(t["exp:M1"] - t["exp:M2"]));
    for (const key of Object.keys(t)) {
      const m = key.match(/^cat:M1:(.+)$/);
      if (m && typeof t[`cat:M2:${m[1]}`] === "number") t[`catsum12:${m[1]}`] = round2(t[key] + t[`cat:M2:${m[1]}`]);
    }
  }
  t["debt:total"] = round2((spec.debts ?? []).reduce((s, d) => s + d.outstanding_balance, 0));
  t["debt:installments"] = round2((spec.debts ?? []).reduce((s, d) => s + d.installment_amount, 0));
  return t;
}

/** Todo valor que existe de verdade nos dados da persona: lançamentos, somas por dia, por mês e por categoria,
 *  resultado do mês, metas e dívidas. Serve para separar "palpite de contexto" (valor real) de valor inventado. */
export function knownValues(spec, ref = new Date()) {
  const out = new Set();
  const add = (v) => { if (Number.isFinite(v) && v !== 0) out.add(Math.abs(round2(v))); };
  const daily = {}, cat = {};
  for (const t of spec.transactions) {
    if (t.status !== "confirmed") continue;
    add(t.amount);
    const dk = `${t.type}|${t.date}`;
    daily[dk] = (daily[dk] ?? 0) + t.amount;
    const ck = `${t.type}|${t.date.slice(0, 7)}|${t.category}`;
    cat[ck] = (cat[ck] ?? 0) + t.amount;
  }
  Object.values(daily).forEach(add);
  Object.values(cat).forEach(add);
  for (const v of Object.values(buildTruth(spec, ref))) if (typeof v === "number") add(v);
  for (const g of spec.goals ?? []) { add(g.target_amount); }
  for (const d of spec.debts ?? []) { add(d.original_amount); add(d.outstanding_balance); add(d.installment_amount); }
  return [...out];
}
