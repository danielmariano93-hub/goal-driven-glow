// Benchmark real dos modelos candidatos para o interpretador semântico V3 do Nino.
// Roda em CI (workflow manual) com a chave do provedor; não usa dados de usuário.
// Mede: contrato válido, acerto semântico, latência e tokens por modelo.
import { interpretSemanticTurnV3 } from "../supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts";

type Turn = any;
type Case = { text: string; history?: string; check: (turn: Turn) => boolean; label: string };

const task = (t: Turn, kind: string) => (t?.tasks ?? []).find((x: any) => x.kind === kind);
const fin = (t: Turn) => task(t, "financial_query");
const kindIs = (k: string) => (t: Turn) => t?.kind === k;

const CASES: Case[] = [
  { label: "saldo", text: "qual meu saldo?", check: (t) => fin(t)?.metric === "balance" },
  { label: "meta específica", text: "como está minha meta de alimentação?", check: (t) => task(t, "goal_query")?.operation === "progress" && /aliment/i.test(task(t, "goal_query")?.goal?.value ?? "") },
  { label: "metas geral", text: "quais minhas metas?", check: (t) => task(t, "goal_query")?.operation === "overview" },
  { label: "gasto do mês", text: "quanto gastei esse mês?", check: (t) => fin(t)?.metric === "expense_amount" },
  { label: "follow-up lazer", text: "e com lazer?", history: "Usuário: quanto gastei esse mês?\nNino: Você gastou R$ 1.889,90 neste mês.", check: (t) => (fin(t)?.filters ?? []).some((f: any) => f.field === "category" && /lazer/i.test(f.entity?.value ?? "")) },
  { label: "comparação", text: "compara setembro com agosto", check: (t) => fin(t)?.operation === "compare" },
  { label: "registro", text: "gastei 35 no almoço hoje", check: (t) => task(t, "financial_write")?.action === "transaction.create" },
  { label: "projeção", text: "quanto sobra até o fim do mês?", check: (t) => fin(t)?.operation === "forecast" },
  { label: "patrimônio", text: "qual meu patrimônio?", check: (t) => fin(t)?.metric === "net_worth" },
  { label: "dívidas", text: "quais minhas dívidas?", check: (t) => fin(t)?.metric === "debt_balance" },
  { label: "parcelas", text: "quanto ainda devo de parcelas futuras?", check: (t) => fin(t)?.metric === "future_installments" },
  { label: "saúde financeira", text: "como está minha saúde financeira?", check: (t) => fin(t)?.metric === "financial_health" },
  { label: "gráfico mensal", text: "gráfico mês a mês", check: (t) => fin(t)?.operation === "trend" && fin(t)?.group_by?.[0] === "month" },
  { label: "salário", text: "quanto recebi de salário?", check: (t) => fin(t)?.metric === "income_amount" },
  { label: "desabafo", text: "estou me sentindo ansioso hoje", check: kindIs("conversation") },
  { label: "saudação", text: "oi, tudo bem?", check: kindIs("conversation") },
  { label: "hipótese", text: "e se eu cortar metade do lazer?", check: (t) => task(t, "advisory")?.operation === "scenario" },
  { label: "resumo do mês", text: "como foi meu mês?", check: (t) => task(t, "advisory")?.operation === "period_review" },
  { label: "estabelecimento", text: "quanto gastei no iFood em setembro?", check: (t) => (fin(t)?.filters ?? []).some((f: any) => f.field === "merchant" && /ifood/i.test(f.entity?.value ?? "")) },
  { label: "projeção de meta", text: "quando vou bater a meta da viagem?", check: (t) => task(t, "goal_query")?.operation === "projection" },
  { label: "categoria que mais cresceu", text: "qual categoria mais cresceu de agosto pra setembro?", check: (t) => fin(t)?.operation === "compare" && fin(t)?.group_by?.[0] === "category" },
  { label: "gasto típico", text: "quanto gasto por mês com assinaturas?", check: (t) => fin(t)?.operation === "value" && (fin(t)?.periods ?? []).length === 0 },
  { label: "composto", text: "anota 45 de iFood e me diz quanto foi de delivery", check: (t) => (t?.tasks ?? []).length >= 2 && !!task(t, "financial_write") },
  { label: "saldo por conta", text: "qual o saldo da conta Itaú?", check: (t) => fin(t)?.metric === "balance" && (fin(t)?.filters ?? []).some((f: any) => f.field === "account") },
];

const REPS = Number(Deno.env.get("BENCH_REPS") ?? "2");
const key = Deno.env.get("GROQ_API_KEY") ?? "";

async function discover(): Promise<string[]> {
  const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  const json = await res.json();
  const ids: string[] = (json.data ?? []).map((m: any) => String(m.id));
  console.log("MODELOS DISPONÍVEIS NO GROQ:", ids.join(", "));
  return ids;
}

const SKIP = /whisper|tts|guard|playai|distil|compound|orpheus|safeguard|prompt-guard|embed|allam/i;
const explicit = (Deno.env.get("BENCH_MODELS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const models = explicit.length ? explicit : (await discover()).filter((id) => !SKIP.test(id));

const pct = (arr: number[], p: number) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

const rows: any[] = [];
for (const model of models) {
  let valid = 0, correct = 0, total = 0, tokens = 0;
  const lat: number[] = [];
  const errors: Record<string, number> = {};
  for (const c of CASES) {
    for (let r = 0; r < REPS; r += 1) {
      total += 1;
      const t0 = Date.now();
      try {
        const out = await interpretSemanticTurnV3({
          text: c.text,
          history_text: c.history ?? "",
          context_text: JSON.stringify({ conversation_state: null }),
          model,
        });
        lat.push(Date.now() - t0);
        tokens += Number(out.telemetry?.tokens_in ?? 0) + Number(out.telemetry?.tokens_out ?? 0);
        if (out.turn) {
          valid += 1;
          if (c.check(out.turn)) correct += 1;
        } else {
          const e = String(out.telemetry?.error ?? "sem_turn").slice(0, 60);
          errors[e] = (errors[e] ?? 0) + 1;
        }
      } catch (e) {
        lat.push(Date.now() - t0);
        const m = String((e as Error).message ?? e).slice(0, 60);
        errors[m] = (errors[m] ?? 0) + 1;
      }
      await new Promise((res) => setTimeout(res, 400));
    }
  }
  const row = {
    model, total, valid_pct: Math.round((valid / total) * 100), correct_pct: Math.round((correct / total) * 100),
    p50_ms: pct(lat, 0.5), p95_ms: pct(lat, 0.95), avg_tokens: Math.round(tokens / total),
    top_error: Object.entries(errors).sort((a, b) => b[1] - a[1])[0]?.join("×") ?? "-",
  };
  rows.push(row);
  console.log("RESULT", JSON.stringify(row));
}

console.log("\n| modelo | válido | correto | p50 | p95 | tokens/turno | erro mais comum |\n|---|---|---|---|---|---|---|");
for (const r of rows.sort((a, b) => b.correct_pct - a.correct_pct || a.p50_ms - b.p50_ms)) {
  console.log(`| ${r.model} | ${r.valid_pct}% | ${r.correct_pct}% | ${r.p50_ms} ms | ${r.p95_ms} ms | ${r.avg_tokens} | ${r.top_error} |`);
}
