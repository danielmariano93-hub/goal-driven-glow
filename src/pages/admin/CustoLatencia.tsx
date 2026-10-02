import { Activity } from "lucide-react";
import { AiEfficiencyTruthBoard } from "@/components/admin/AiEfficiencyTruthBoard";
import { AiProviderBenchmarkTruthBoard } from "@/components/admin/AiProviderBenchmarkTruthBoard";
import { SupabaseCapacityBoard } from "@/components/admin/SupabaseCapacityBoard";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonTable } from "@/components/admin/AdminSkeleton";
import { AiPerformance, usePeriodParams } from "./CentralDeComando";
import { AdminDateFilter } from "@/components/admin/AdminDateFilter";
import { useCommandCenter } from "@/lib/admin/useCommandCenter";
import { useQuery } from "@tanstack/react-query";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import { formatInt, formatMs, formatPct } from "@/lib/admin/commandCenter";

type ToolRow = { tool: string; calls: number; ok: number; failed: number; avg_ms: number };
type FailureRow = { at: string; tool: string; error: string; capability: string | null; channel: string | null };

const TOOL_LABEL: Record<string, string> = {
  analyze_spending: "Análise de gastos", create_transaction_draft: "Rascunho de lançamento", confirm_pending_action: "Confirmação de ação",
  get_financial_snapshot: "Saldo e painel", get_goals_overview: "Metas", get_debt_status: "Dívidas", compare_periods: "Comparação de períodos",
  merchant_profile: "Perfil de estabelecimento", project_goal_completion: "Projeção de meta", forecast_month_close: "Fechamento do mês",
};
const toolLabel = (t: string) => TOOL_LABEL[t] ?? t.replace(/_/g, " ");

/** Quais ferramentas do Nino mais falham e os erros mais recentes. */
function ToolReliability({ days }: { days: number }) {
  const q = useQuery({
    queryKey: ["admin-agent-autonomy", days],
    queryFn: () => callAdminRpc<{ tools?: ToolRow[]; failures?: FailureRow[] }>("admin_v2_agent_autonomy", { _days: days }),
  });
  const tools = (q.data?.tools ?? []).filter((t) => t.calls > 0).map((t) => ({ ...t, rate: t.failed / t.calls }))
    .sort((a, b) => b.failed - a.failed || b.rate - a.rate).slice(0, 6);
  const failures = (q.data?.failures ?? []).slice(0, 5);
  if (q.isLoading || (!tools.some((t) => t.failed > 0) && !failures.length)) return null;
  return (
    <section className="surface-card space-y-3 p-4 md:p-5">
      <header>
        <h2 className="font-display text-base font-semibold">Ferramentas que mais falham</h2>
        <p className="text-xs text-muted-foreground">Cada pergunta usa ferramentas por trás. Falha concentrada numa delas aponta onde corrigir.</p>
      </header>
      <ul className="space-y-2.5">
        {tools.filter((t) => t.failed > 0).map((t) => (
          <li key={t.tool}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium">{toolLabel(t.tool)}</span>
              <span className="shrink-0 tabular-nums font-semibold">{t.failed} de {formatInt(t.calls)} · {formatPct(t.rate)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-destructive" style={{ width: `${Math.max(4, t.rate * 100)}%` }} /></div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">tempo médio {formatMs(t.avg_ms)}</p>
          </li>
        ))}
      </ul>
      {failures.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">Últimas falhas</p>
          <ul className="space-y-1 text-xs">
            {failures.map((f, i) => (
              <li key={i} className="flex gap-2 rounded-xl bg-secondary/40 px-3 py-1.5">
                <span className="shrink-0 tabular-nums text-muted-foreground">{new Date(f.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="min-w-0 truncate"><b>{toolLabel(f.tool)}</b> — {String(f.error).replace(/_/g, " ").slice(0, 90)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function CustoLatencia() {
  const { preset, range, setPeriod } = usePeriodParams("7d");
  const q = useCommandCenter(range);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Custo e latência"
        description="Tempo de resposta, tokens e custo estimado por dia e por modelo. Os detalhes técnicos continuam logo abaixo."
        status={<Badge variant="secondary" className="gap-1"><Activity size={12} /> Operação global</Badge>}
        actions={<AdminDateFilter value={range} preset={preset} onChange={setPeriod} />}
      />
      {q.isLoading && <SkeletonTable />}
      {q.data && <AiPerformance data={q.data} />}
      {q.data && <ToolReliability days={Math.min(90, Math.max(1, Math.round(q.data.window_days)))} />}
      <details className="surface-card p-4">
        <summary className="cursor-pointer text-sm font-semibold">Detalhes técnicos (eficiência, benchmark de provedores e capacidade)</summary>
        <div className="mt-4 space-y-6">
          <AiEfficiencyTruthBoard />
          <AiProviderBenchmarkTruthBoard />
          <SupabaseCapacityBoard />
        </div>
      </details>
    </div>
  );
}
