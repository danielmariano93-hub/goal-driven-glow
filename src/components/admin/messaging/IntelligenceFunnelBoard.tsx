import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Brain, Layers, ShieldAlert } from "lucide-react";
import { Section } from "@/components/admin/Section";
import { StatCard, StatGrid } from "@/components/admin/StatCard";
import { FunnelBars } from "@/components/admin/kit/FunnelBars";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonStats } from "@/components/admin/AdminSkeleton";
import { adminErrorMessage, callAdminRpc } from "@/lib/admin/adminRpc";
import { dict } from "@/lib/admin/displayDictionary";

type Funnel = {
  window_days: number;
  signals: number;
  situations: number;
  delivered: number;
  suppressed: number;
  cross_domain: number;
  by_domain: Array<{ domain: string; total: number; avg_score: number; impact: number }>;
  by_type: Array<{ type: string; total: number; avg_score: number; delivered: number }>;
  by_reason: Array<{ reason: string; channel: string; total: number }>;
};

const DOMAIN_LABELS: Record<string, string> = {
  cash: "Caixa e liquidez",
  cards: "Cartões e faturas",
  goals: "Metas por categoria",
  commitments: "Compromissos",
  debts: "Dívidas",
  investments: "Investimentos",
  patterns: "Padrões de gasto",
  emotions: "Emoção × gasto",
};

const TYPE_LABELS: Record<string, string> = {
  card_pressure_on_cash: "Fatura não cabe no caixa",
  cash_shortfall_ahead: "Caixa fica negativo",
  month_end_shortfall: "Mês fecha no vermelho",
  category_goal_pressure: "Teto de categoria",
  commitment_cluster: "Concentração de compromissos",
  spending_pace: "Ritmo acima do típico",
  debt_overdue: "Dívida em atraso",
  debt_due_soon: "Dívida a vencer",
  behavioral_pattern: "Padrão de comportamento",
  achievement: "Conquista",
};

const REASON_LABELS: Record<string, string> = {
  attention_budget_exhausted: "Cota de atenção do dia já usada",
  below_materiality_floor: "Valor abaixo do piso de relevância",
  already_communicated_no_material_change: "Já comunicado, sem mudança relevante",
  muted_by_learning: "Silenciado pelo aprendizado do cliente",
  confidence_too_low: "Confiança insuficiente",
  top_ranked_material_situation: "Liberado por maior valor",
};

const PERIODS = [7, 30, 90];

export function IntelligenceFunnelBoard() {
  const [days, setDays] = useState(30);

  const q = useQuery({
    queryKey: ["admin_proactive_intelligence_funnel", days],
    queryFn: async (): Promise<Funnel> => {
      try {
        return await callAdminRpc<Funnel>("admin_v2_proactive_intelligence_funnel", { _days: days });
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao carregar o funil de inteligência"));
      }
    },
    staleTime: 30_000,
  });

  if (q.isLoading) return <SkeletonStats count={4} />;
  if (q.isError) {
    return <EmptyState title="Não foi possível carregar" description={(q.error as Error)?.message ?? "Erro desconhecido"} />;
  }
  const data = q.data;
  if (!data) return <EmptyState title="Sem dados ainda" description="O funil aparece após a próxima rodada do motor proativo." />;

  const integrationRate = data.situations > 0 ? Math.round((data.cross_domain / data.situations) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setDays(p)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition ${
              days === p ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
            }`}
          >
            {p} dias
          </button>
        ))}
      </div>

      <Section
        title="Da leitura financeira até a interrupção"
        icon={Brain}
        description="O Nino lê todos os domínios, cruza os que mudam a mesma decisão e só interrompe quem tem maior valor financeiro no momento."
      >
        <StatGrid cols={4}>
          <StatCard label="Sinais lidos" value={data.signals} tone="primary" hint="Fatos vindos dos motores determinísticos" />
          <StatCard label="Situações compostas" value={data.situations} hint={`${integrationRate}% cruzam mais de um domínio`} />
          <StatCard label="Liberadas para falar" value={data.delivered} tone="success" />
          <StatCard label="Retidas por regra" value={data.suppressed} tone={data.suppressed > 0 ? "warning" : "default"} />
        </StatGrid>
        <div className="mt-4">
          <FunnelBars
            unit={["situação", "situações"]}
            steps={[
              { label: "Sinais financeiros lidos", users: data.signals },
              { label: "Situações compostas", users: data.situations },
              { label: "Situações integradas (2+ domínios)", users: data.cross_domain },
              { label: "Liberadas para comunicar", users: data.delivered },
            ]}
            caption="Retidas não são falhas: são a cota de atenção do cliente sendo respeitada."
          />
        </div>
      </Section>

      <Section title="Onde está o valor" icon={Layers} description="Impacto financeiro somado por domínio no período.">
        {data.by_domain.length === 0 ? (
          <EmptyState title="Nenhuma situação no período" description="Ajuste o período ou aguarde a próxima rodada." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left py-2 pr-4">Domínio</th>
                  <th className="text-right pr-4">Situações</th>
                  <th className="text-right pr-4">Score médio</th>
                  <th className="text-right">Impacto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.by_domain.map((row) => (
                  <tr key={row.domain}>
                    <td className="py-2 pr-4 font-medium text-foreground">{DOMAIN_LABELS[row.domain] ?? row.domain}</td>
                    <td className="text-right pr-4 tabular-nums">{row.total}</td>
                    <td className="text-right pr-4 tabular-nums">{row.avg_score}</td>
                    <td className="text-right tabular-nums">
                      {Number(row.impact ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Tipos de situação" icon={Layers} description="O que o Nino mais encontra e o que virou conversa.">
        {data.by_type.length === 0 ? (
          <EmptyState title="Sem situações" description="Nada detectado nesta janela." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left py-2 pr-4">Situação</th>
                  <th className="text-right pr-4">Detectadas</th>
                  <th className="text-right pr-4">Comunicadas</th>
                  <th className="text-right">Score médio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.by_type.map((row) => (
                  <tr key={row.type}>
                    <td className="py-2 pr-4 font-medium text-foreground">{TYPE_LABELS[row.type] ?? row.type}</td>
                    <td className="text-right pr-4 tabular-nums">{row.total}</td>
                    <td className="text-right pr-4 tabular-nums text-success">{row.delivered}</td>
                    <td className="text-right tabular-nums">{row.avg_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Por que o Nino ficou calado" icon={ShieldAlert} description="Cada retenção tem motivo registrado e auditável.">
        {data.by_reason.length === 0 ? (
          <EmptyState title="Nenhuma retenção" description="Todas as situações relevantes foram liberadas." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left py-2 pr-4">Motivo</th>
                  <th className="text-left pr-4">Canal</th>
                  <th className="text-right">Ocorrências</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.by_reason.map((row) => (
                  <tr key={`${row.reason}-${row.channel}`}>
                    <td className="py-2 pr-4 font-medium text-foreground">{REASON_LABELS[row.reason] ?? row.reason}</td>
                    <td className="pr-4 text-muted-foreground">{dict.channel(row.channel)}</td>
                    <td className="text-right tabular-nums">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
