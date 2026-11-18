// Relatório da rodada de testes sintéticos, em texto curto para o WhatsApp do dono da plataforma.
// Função pura: recebe o resumo da rodada e os resultados e devolve a mensagem. Quem envia é o worker.

const pct = (x) => `${Math.round(Number(x ?? 0) * 1000) / 10}`.replace(".", ",");
const clip = (t, n) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const MAX_LEN = 1500;

/** Agrupa as respostas erradas por cenário: quantas vezes, em qual área, o motivo e uma pergunta de exemplo. */
export function groupFailures(results) {
  const g = new Map();
  for (const r of results) {
    if (r.verdict !== "WRONG") continue;
    const e = g.get(r.scenario_id) ?? { id: r.scenario_id, area: r.area ?? null, n: 0, whys: new Map(), example: null, styles: new Set() };
    e.n++;
    if (r.why) e.whys.set(r.why, (e.whys.get(r.why) ?? 0) + 1);
    if (!e.example && Array.isArray(r.turns) && r.turns[0]) e.example = String(r.turns[0]);
    if (r.style) e.styles.add(r.style);
    g.set(r.scenario_id, e);
  }
  return [...g.values()].sort((a, b) => b.n - a.n || String(a.id).localeCompare(String(b.id)));
}

/**
 * @param {object} a
 * @param {object} a.summary   resumo da rodada (summarizeRun)
 * @param {object[]} a.results resultados (scenario_id, area, verdict, why, turns, style)
 * @param {object|null} a.previous resumo da rodada anterior do mesmo tipo, se houver
 * @param {boolean} a.capped   parou antes do fim por atingir o limite de tokens
 * @param {number} a.plannedTotal conversas sorteadas no início
 * @param {string} a.dateLabel data da rodada, ex.: "18/11"
 * @param {string} a.runId id da rodada
 */
export function buildWeeklyReport({ summary, results = [], previous = null, capped = false, plannedTotal, dateLabel, runId }) {
  const total = Number(summary?.total ?? results.length);
  const wrong = Number(summary?.wrong ?? 0);
  const infra = Number(summary?.infra ?? 0);
  const miss = Number(summary?.by?.MISS ?? 0);
  const rate = summary?.ok_rate ?? (total ? Number(summary?.ok ?? 0) / total : 0);
  const lines = [];
  const head = `Relatório dos testes do Nino${dateLabel ? ` (${dateLabel})` : ""}`;
  lines.push(head);
  lines.push(`${plural(total, "conversa simulada", "conversas simuladas")}, sorteadas entre perfis, assuntos e jeitos de escrever${capped && plannedTotal ? ` (parei em ${total} de ${plannedTotal} por atingir o limite de custo)` : ""}.`);

  if (wrong === 0 && infra === 0) {
    lines.push("", `Nenhuma resposta errada. ${pct(rate)}% das conversas foram certas.`);
  } else {
    lines.push("", `${plural(wrong, "resposta errada", "respostas erradas")} de ${total} (${pct(rate)}% certas).`);
  }
  if (previous && Number.isFinite(Number(previous.ok_rate))) {
    const diff = Math.round((rate - Number(previous.ok_rate)) * 1000) / 10;
    const trend = Math.abs(diff) < 0.5 ? "estável" : diff > 0 ? `melhorou ${pct(diff / 100)} ponto(s)` : `piorou ${pct(-diff / 100)} ponto(s)`;
    lines.push(`Rodada anterior: ${pct(previous.ok_rate)}% certas, ${plural(Number(previous.wrong ?? 0), "errada", "erradas")}. Agora ${trend}.`);
  }

  const groups = groupFailures(results);
  if (groups.length) {
    lines.push("", "Onde errou:");
    for (const gr of groups.slice(0, 5)) {
      const why = [...gr.whys.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      lines.push(`• ${gr.id}${gr.area ? ` (${gr.area})` : ""}, ${gr.n}x${why ? `: ${clip(why, 90)}` : ""}`);
      if (gr.example) lines.push(`  ex.: “${clip(gr.example, 90)}”`);
    }
    if (groups.length > 5) lines.push(`… e mais ${plural(groups.length - 5, "cenário", "cenários")} com erro.`);
  }
  const extra = [];
  if (miss) extra.push(`${plural(miss, "conversa", "conversas")} sem registrar o lançamento ou com categoria diferente`);
  if (infra) extra.push(`${plural(infra, "falha interna", "falhas internas")} (a resposta nem chegou a ser avaliada)`);
  if (extra.length) lines.push("", `Também: ${extra.join("; ")}.`);

  if (groups.length) {
    lines.push("", `Para corrigir, me peça: "corrigir ${groups.slice(0, 3).map((x) => x.id).join(", ")}".`);
  } else if (!extra.length) {
    lines.push("", "Nada para corrigir nesta semana.");
  }
  if (runId) lines.push(`Detalhes: Admin > Qualidade das respostas, rodada ${String(runId).slice(0, 8)}.`);
  let text = lines.join("\n");
  if (text.length > MAX_LEN) text = `${text.slice(0, MAX_LEN - 1)}…`;
  return text;
}

/** Mensagem curta para a rodada que não terminou. */
export function buildFailureReport({ dateLabel, why }) {
  return [`Relatório dos testes do Nino${dateLabel ? ` (${dateLabel})` : ""}`, "", "A rodada semanal não terminou.", `Motivo: ${clip(why, 160) || "falha desconhecida"}.`, "Os testes não rodaram por inteiro; vale abrir Admin > Qualidade das respostas e rodar de novo."].join("\n");
}
