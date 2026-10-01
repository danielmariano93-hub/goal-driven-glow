// Explicação de cada experimento: o que é, o que conta e como o Nino mede.
// Os textos vivem aqui (por slug) para ficarem testáveis e versionados com o app.
// A regra de contagem real está no banco (behavior_experiment_refresh /
// behavior_experiment_sync_auto); este arquivo só descreve o que ela faz.

export type ExperimentMode = "auto" | "auto_or_link" | "auto_or_guided" | "manual_pause";

export type ExperimentCopy = {
  what: string;
  counts: string[];
  measured: string;
  mode: ExperimentMode;
  /** Unidade contada (singular, plural), para "2 de 4 aportes". */
  unit: [string, string];
  linkLabel?: string;
  route?: { label: string; to: string };
};

const FALLBACK: ExperimentCopy = {
  what: "Um teste curto para você observar o que muda no seu comportamento.",
  counts: ["O Nino mostra aqui o que foi contado."],
  measured: "O Nino acompanha com os seus dados.",
  mode: "auto",
  unit: ["ponto", "pontos"],
};

export const EXPERIMENT_COPY: Record<string, ExperimentCopy> = {
  "checkin-consistency-14d": {
    what: "Registrar como você se sente com o dinheiro em 10 dias diferentes, para o Nino achar padrões reais.",
    counts: ["Cada dia em que você faz pelo menos um check-in conta uma vez (vários no mesmo dia contam como um)."],
    measured: "Automático: o Nino conta seus check-ins por dia.",
    mode: "auto",
    unit: ["dia com check-in", "dias com check-in"],
    route: { label: "Fazer um check-in", to: "#checkin" },
  },
  "three-no-spend-days": {
    what: "Ter 3 dias completos sem nenhuma despesa de consumo.",
    counts: ["Dia fechado sem despesa de consumo. Contas fixas, transferências e pagamento de fatura não quebram o dia."],
    measured: "Automático: o Nino olha seus lançamentos de cada dia.",
    mode: "auto",
    unit: ["dia sem gastar", "dias sem gastar"],
  },
  "reduce-spend-10pct": {
    what: "Gastar, em média por dia, pelo menos 10% menos do que você gastava antes do teste.",
    counts: ["Comparação do gasto médio diário durante o teste com a média dos 14 dias anteriores."],
    measured: "Automático: o Nino compara seus lançamentos de consumo.",
    mode: "auto",
    unit: ["% de redução", "% de redução"],
  },
  "pause-before-buying": {
    what: "Quando bater vontade de comprar algo que você não tinha planejado, esperar 10 minutos antes de decidir.",
    counts: [
      "Cada pausa que você registrar.",
      "As duas respostas contam: \"a vontade passou\" e \"comprei mesmo assim\". O objetivo é criar o hábito de parar, não de não comprar.",
    ],
    measured: "Você registra. Se quiser, vincula a compra a um lançamento real.",
    mode: "manual_pause",
    unit: ["pausa", "pausas"],
    linkLabel: "Vincular a compra",
  },
  "weekly-money-review": {
    what: "Uma revisão curta por semana (cerca de 5 minutos): ver o saldo e os próximos compromissos, olhar o relatório e escolher uma coisa para simplificar.",
    counts: [
      "Semana em que você abriu Relatórios e também Planejamento ou Metas. O Nino reconhece sozinho.",
      "Semana em que você concluiu o roteiro guiado de 5 minutos.",
    ],
    measured: "Automático pelo que você abriu no app, ou pelo roteiro guiado.",
    mode: "auto_or_guided",
    unit: ["semana revisada", "semanas revisadas"],
    route: { label: "Abrir Relatórios", to: "/app/relatorios" },
  },
  "small-wealth-moves": {
    what: "Quatro ações intencionais de construir patrimônio em 30 dias: guardar ou investir dinheiro de propósito.",
    counts: [
      "Cada aporte em investimento registrado no Nino. O Nino reconhece sozinho.",
      "Cada lançamento que você vincular como ação de patrimônio, por exemplo um Pix para a poupança ou para a reserva.",
    ],
    measured: "Automático para aportes; para outras ações, você vincula um lançamento real como prova.",
    mode: "auto_or_link",
    unit: ["ação", "ações"],
    linkLabel: "Vincular um lançamento",
    route: { label: "Registrar um aporte", to: "/app/investimentos" },
  },
};

export function experimentCopy(slug: string): ExperimentCopy {
  return EXPERIMENT_COPY[slug] ?? FALLBACK;
}

/** Texto de progresso com a unidade certa ("2 de 4 ações"). */
export function progressLabel(slug: string, current: number, target: number): string {
  const copy = experimentCopy(slug);
  if (copy.unit[0].startsWith("%")) return `${Math.max(0, Math.round(current))}% de redução observada`;
  const n = Math.round(current);
  const t = Math.round(target);
  return `${n} de ${t} ${t === 1 ? copy.unit[0] : copy.unit[1]}`;
}

// ---------------------------------------------------------------------------
// Evidências
// ---------------------------------------------------------------------------

export type ExperimentEvent = {
  id: string;
  experiment_id: string;
  value: number;
  source: "auto" | "linked" | "guided" | "manual" | "removed" | string;
  ref_type: string | null;
  ref_key: string | null;
  label: string | null;
  note: string | null;
  created_at: string;
};

export type EvidenceItem = {
  id: string;
  title: string;
  detail: string | null;
  sourceLabel: string;
  counts: boolean;
  removable: boolean;
  at: string;
};

/** Experimentos em que só evidência real conta (marcação manual antiga não soma). */
const EVIDENCE_ONLY = new Set(["small-wealth-moves", "weekly-money-review"]);

const SOURCE_LABEL: Record<string, string> = {
  auto: "Detectado pelo Nino",
  linked: "Vinculado por você",
  guided: "Roteiro guiado",
  manual: "Registrado por você",
};

export function evidenceItems(slug: string, events: ExperimentEvent[]): EvidenceItem[] {
  return [...events]
    .filter((e) => e.source !== "removed" && Number(e.value) > 0)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((e) => {
      const legacy = EVIDENCE_ONLY.has(slug) && e.source === "manual" && !e.ref_key;
      return {
        id: e.id,
        title: legacy ? "Marcação antiga, sem lançamento ou uso comprovado" : e.label ?? (e.source === "manual" ? "Ação registrada" : "Contagem"),
        detail: legacy ? "Não soma neste experimento." : e.note,
        sourceLabel: legacy ? "Registro manual" : SOURCE_LABEL[e.source] ?? "Registrado",
        counts: !legacy,
        removable: e.source === "linked" || (e.source === "manual" && !legacy),
        at: e.created_at,
      };
    });
}

/** Início (YYYY-MM-DD, UTC, igual ao banco) da semana do experimento em que `now` cai. */
export function currentReviewWeekStart(startedAt: string, now: Date = new Date()): string {
  const start = new Date(`${startedAt.slice(0, 10)}T00:00:00Z`).getTime();
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  const weeks = Math.max(0, Math.floor((today - start) / (7 * 86_400_000)));
  return new Date(start + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
}

export function reviewAlreadyCounted(startedAt: string, events: ExperimentEvent[], now: Date = new Date()): boolean {
  const week = currentReviewWeekStart(startedAt, now);
  return events.some((e) => e.ref_type === "week" && e.ref_key === week && Number(e.value) > 0 && e.source !== "removed");
}
