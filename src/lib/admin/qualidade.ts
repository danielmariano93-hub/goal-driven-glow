import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { callAdminRpc } from "@/lib/admin/adminRpc";

// Qualidade das respostas do Nino (usuários sintéticos + conjunto dourado). Funções puras e ganchos de leitura.

export interface GroupStat { total: number; ok: number; wrong: number }
export interface RunSummary {
  total: number;
  by: Record<string, number>;
  ok: number;
  ok_rate: number;
  wrong: number;
  infra: number;
  natural_avg: number | null;
  consistency?: number | null;
  degraded?: number;
  fail_in_degraded?: number;
  by_area?: Record<string, GroupStat>;
  by_persona?: Record<string, GroupStat>;
  by_style?: Record<string, GroupStat>;
  by_level?: Record<string, GroupStat>;
}
export interface QualityRun {
  id: string;
  label: string;
  suite: "synthetic" | "golden";
  git_sha: string | null;
  started_at: string;
  finished_at: string | null;
  summary: Partial<RunSummary>;
}
export interface QualityResult {
  scenario_id: string;
  persona_id: string | null;
  style: string | null;
  rep: number;
  area: string | null;
  verdict: string;
  why: string | null;
  layers: { naturalidade?: number; flags?: string[]; categoria?: string } & Record<string, unknown>;
  turns: string[];
  replies: string[];
  latency_ms: number | null;
}
export interface RealWeek { semana: string; respostas: number; falhas: number; recusas: number; esclarecimentos: number }

export function useQualityRuns() {
  return useQuery({ queryKey: ["admin-quality-runs"], queryFn: () => callAdminRpc<QualityRun[]>("admin_synthetic_overview", { p_limit: 40 }), staleTime: 30_000 });
}
export function useQualityResults(runId: string | null, onlyFailures = true) {
  return useQuery({
    queryKey: ["admin-quality-results", runId, onlyFailures], enabled: !!runId, staleTime: 60_000,
    queryFn: () => callAdminRpc<QualityResult[]>("admin_synthetic_results", { p_run: runId, p_only_failures: onlyFailures }),
  });
}
export function useRealQuality() {
  return useQuery({ queryKey: ["admin-real-quality"], queryFn: () => callAdminRpc<RealWeek[]>("admin_real_quality_weekly", { p_weeks: REAL_WEEKS }), staleTime: 120_000 });
}

export const VERDICT_LABEL: Record<string, string> = {
  CORRECT: "Acertou", CORRECT_REFUSAL: "Recusou certo", MISS: "Não respondeu", WRONG: "Respondeu errado", INFRA: "Falha técnica", UNVERIFIED: "A conferir",
};
export const AREA_LABEL: Record<string, string> = {
  gasto_mes: "Gasto do mês", receita_mes: "Receita do mês", categoria: "Gasto por categoria", ranking: "Maior categoria", saldo_mes: "Quanto sobrou",
  comparacao: "Comparar meses", dividas: "Dívidas", sem_dados: "Conta sem dados", seguimento: "Perguntas de seguimento", registro: "Registrar lançamento",
  conversa: "Conversa", fora_dominio: "Fora de finanças", vago: "Pergunta vaga", reclamacao: "Reclamação", conselho: "Conselhos", metas: "Metas", seguranca: "Segurança", incidental: "Pergunta com contexto junto", multi_passo: "Conta com vários meses",
};
export const STYLE_LABEL: Record<string, string> = {
  neutro: "Escrita normal", informal: "Informal (vc, q, pq)", erros: "Com erros de digitação", telegrafico: "Telegráfico", prolixo: "Prolixo e educado", apressado: "Apressado", audio: "Parece áudio transcrito",
};
export const PERSONA_LABEL: Record<string, string> = {
  clt_estavel: "CLT estável", autonomo_irregular: "Autônomo (renda irregular)", endividada: "Com dívidas", conta_vazia: "Conta vazia", poucos_dados: "Poucos dados",
  casal_alta_renda: "Casal de alta renda", estudante: "Estudante", aposentado: "Aposentado", poupador: "Poupador", gastador_lazer: "Gasta com lazer", mes_no_vermelho: "No vermelho", dono_de_pet: "Tutora de pets",
};

export const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(v >= 0.995 || v === 0 ? 0 : 1)}%`);
export const isPass = (v: string) => v === "CORRECT" || v === "CORRECT_REFUSAL";

export interface Delta { label: string; before: number | null; after: number | null; diff: number | null }
/** Compara duas rodadas por área: taxa de acerto antes/depois e a diferença em pontos percentuais. */
export function compareRuns(before: Partial<RunSummary> | undefined, after: Partial<RunSummary> | undefined): Delta[] {
  const rate = (g?: GroupStat) => (g && g.total ? g.ok / g.total : null);
  const areas = new Set([...Object.keys(before?.by_area ?? {}), ...Object.keys(after?.by_area ?? {})]);
  const rows: Delta[] = [{ label: "Geral", before: before?.ok_rate ?? null, after: after?.ok_rate ?? null, diff: null }];
  for (const a of areas) rows.push({ label: AREA_LABEL[a] ?? a, before: rate(before?.by_area?.[a]), after: rate(after?.by_area?.[a]), diff: null });
  return rows.map((r) => ({ ...r, diff: r.before != null && r.after != null ? (r.after - r.before) * 100 : null }));
}

/** Frase de uma linha para o topo da página. */
export function qualityHeadline(run: QualityRun | undefined): string {
  const s = run?.summary;
  if (!run || !s || s.total == null) return "Ainda não há rodada de usuários sintéticos.";
  const wrong = s.wrong ?? 0;
  const base = `Na última rodada, o Nino acertou ${pct(s.ok_rate)} das ${s.total} conversas simuladas`;
  return wrong > 0 ? `${base}, mas respondeu errado ${wrong} ${wrong === 1 ? "vez" : "vezes"}. Resposta errada é o que mais custa confiança: comece por elas.` : `${base} e não deu nenhuma resposta errada.`;
}

/** Janela fixa do bloco de clientes reais: não cresce com o tempo. */
export const REAL_WEEKS = 4;

export interface FailureGroup {
  key: string;
  area: string | null;
  verdict: string;
  why: string;
  count: number;
  personas: string[];
  examples: QualityResult[];
}

const SEVERITY: Record<string, number> = { WRONG: 0, INFRA: 1, UNVERIFIED: 2, MISS: 3 };
const MAX_EXAMPLES = 3;

/** Agrupa as falhas por cenário e veredito: uma linha por problema, com poucos exemplos, em vez de uma por conversa. */
export function groupFailures(results: QualityResult[] | undefined | null): FailureGroup[] {
  const map = new Map<string, FailureGroup>();
  for (const r of results ?? []) {
    if (isPass(r.verdict)) continue;
    const key = `${r.verdict}|${r.scenario_id}`;
    const g = map.get(key) ?? { key, area: r.area, verdict: r.verdict, why: r.why ?? "", count: 0, personas: [], examples: [] };
    g.count += 1;
    if (r.persona_id && !g.personas.includes(r.persona_id)) g.personas.push(r.persona_id);
    if (g.examples.length < MAX_EXAMPLES) g.examples.push(r);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => (SEVERITY[a.verdict] ?? 9) - (SEVERITY[b.verdict] ?? 9) || b.count - a.count);
}

export interface RealSummary { respostas: number; falhas: number; recusas: number; esclarecimentos: number }
export function summarizeReal(weeks: RealWeek[] | undefined | null): RealSummary {
  return (weeks ?? []).reduce((a, w) => ({ respostas: a.respostas + w.respostas, falhas: a.falhas + w.falhas, recusas: a.recusas + w.recusas, esclarecimentos: a.esclarecimentos + w.esclarecimentos }), { respostas: 0, falhas: 0, recusas: 0, esclarecimentos: 0 });
}

// ---- Rodar a bateria pelo painel (fila) ----
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export interface SyntheticJob {
  id: string; status: JobStatus; source: "manual" | "schedule"; label: string | null; total: number; done: number;
  error: string | null; created_at: string; started_at: string | null; finished_at: string | null; run_id: string | null;
}
export interface SyntheticSettings { enabled: boolean; every_hours: number; tpm: number; lanes: number; last_enqueued_at: string | null }
export interface SyntheticState { settings: SyntheticSettings; active: SyntheticJob | null; recent: SyntheticJob[] }

export const JOB_LABEL: Record<JobStatus, string> = { queued: "Na fila", running: "Rodando", done: "Concluída", failed: "Falhou", cancelled: "Cancelada" };

export function useSyntheticState() {
  return useQuery({
    queryKey: ["admin-synthetic-state"],
    queryFn: () => callAdminRpc<SyntheticState>("admin_synthetic_state"),
    // Acompanha de perto só enquanto há rodada ativa.
    refetchInterval: (q) => (q.state.data?.active ? 8_000 : 60_000),
    staleTime: 5_000,
  });
}

function useAfterChange() {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: ["admin-synthetic-state"] }); void qc.invalidateQueries({ queryKey: ["admin-quality-runs"] }); };
}
export function useEnqueueRun() {
  const done = useAfterChange();
  return useMutation({
    mutationFn: (config: { reps: number; llm: boolean; label?: string }) => callAdminRpc<{ ok: boolean; reason?: string; job_id?: string }>("admin_synthetic_enqueue", { p_config: { styles: "rotate", ...config } }),
    onSuccess: done,
  });
}
export function useCancelRun() {
  const done = useAfterChange();
  return useMutation({ mutationFn: (job: string) => callAdminRpc("admin_synthetic_cancel", { p_job: job }), onSuccess: done });
}
export function useSaveSyntheticSettings() {
  const done = useAfterChange();
  return useMutation({
    mutationFn: (v: { enabled: boolean; every_hours: number }) => callAdminRpc("admin_synthetic_settings_save", { _enabled: v.enabled, _every_hours: v.every_hours }),
    onSuccess: done,
  });
}

/** Progresso de 0 a 100 de uma rodada. */
export function jobProgress(job: Pick<SyntheticJob, "done" | "total"> | null | undefined): number {
  if (!job || !job.total) return 0;
  return Math.max(0, Math.min(100, Math.round((job.done / job.total) * 100)));
}

/** Frase curta sobre a rodada automática. */
export function scheduleSentence(s: Pick<SyntheticSettings, "enabled" | "every_hours" | "last_enqueued_at"> | undefined): string {
  if (!s?.enabled) return "Rodada automática desligada.";
  const base = s.every_hours === 1 ? "A cada hora" : s.every_hours % 24 === 0 ? `A cada ${s.every_hours / 24} ${s.every_hours === 24 ? "dia" : "dias"}` : `A cada ${s.every_hours} horas`;
  return s.last_enqueued_at ? `${base}. Última vez: ${new Date(s.last_enqueued_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.` : `${base}. Ainda não rodou.`;
}
