import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Mail, Radio, ShieldAlert, DollarSign, MousePointerClick, BrainCircuit } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Section } from "@/components/admin/Section";
import { StatCard, StatGrid } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonStats } from "@/components/admin/AdminSkeleton";
import { adminErrorMessage, callAdminRpc } from "@/lib/admin/adminRpc";
import { ProactiveEnginePanelV2 } from "@/components/admin/ProactiveEnginePanelV2";
import { dict } from "@/lib/admin/displayDictionary";


type Summary = {
  totals: {
    generated: number; suppressed: number; queued: number; sent: number;
    delivered: number; failed: number; acted: number; dismissed: number;
    opt_out: number; cost_usd: number;
  };
  by_kind: Array<{ kind: string; total: number; delivered: number; failed: number; suppressed: number; acted: number; cost_usd: number }>;
  by_channel: Array<{ channel: string; total: number; delivered: number; failed: number; suppressed: number; acted: number; cost_usd: number }>;
  daily?: Array<{ day: string; total: number; delivered: number; failed: number }>;
};

type QualitySummary = {
  communications: { total: number; useful: number; not_useful: number; suppressed: number };
  behavior: { pending: number; confirmed: number; partial: number; rejected: number };
  advisor: { weekly: number; monthly: number; completed: number };
  measured_at: string;
};

const PERIODS = [
  { days: 7, label: "7 dias" },
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
];

const CHANNELS = [
  { value: "", label: "Todos os canais" },
  { value: "app", label: "App" },
  { value: "whatsapp", label: "WhatsApp" },
];

export default function ComunicacaoProativa() {
  const [days, setDays] = useState(30);
  const [channel, setChannel] = useState("");
  const [kind, setKind] = useState("");

  const q = useQuery({
    queryKey: ["admin_proactive_summary", days, channel, kind],
    queryFn: async (): Promise<Summary> => {
      try {
        const data = await callAdminRpc<Summary>("admin_v2_proactive_summary", {
          _days: days,
          _channel: channel || null,
          _kind: kind || null,
        });
        return data ?? { totals: {} as Summary["totals"], by_kind: [], by_channel: [] };
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao carregar o resumo de comunicações"));
      }
    },
    staleTime: 30_000,
  });

  const quality = useQuery({
    queryKey: ["admin_nino_quality", days],
    queryFn: async (): Promise<QualitySummary> => {
      try {
        return await callAdminRpc<QualitySummary>("admin_v2_nino_quality_summary", { _days: days });
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao carregar a qualidade do Nino"));
      }
    },
    staleTime: 30_000,
    retry: 1,
  });

  const kindOptions = useMemo(() => {
    const list = (q.data?.by_kind ?? []).map((k) => k.kind).filter(Boolean);
    return ["", ...Array.from(new Set(list))];
  }, [q.data]);

  const totals = q.data?.totals;
  const deliveryRate = totals && totals.generated > 0
    ? Math.round((totals.delivered / totals.generated) * 100) : 0;
  const actionRate = totals && totals.delivered > 0
    ? Math.round((totals.acted / totals.delivered) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comunicação Proativa"
        description="O que o Nino tentou comunicar, o que chegou ao cliente e o que foi retido por regra de convivência."
      />

      <ProactiveEnginePanelV2 />

      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.days}
            onClick={() => setDays(p.days)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition ${
              days === p.days ? "bg-primary text-white border-primary" : "bg-white border-neutral-200 text-neutral-700 hover:border-neutral-300"
            }`}
          >
            {p.label}
          </button>
        ))}
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm border bg-white border-neutral-200"
        >
          {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm border bg-white border-neutral-200"
        >
          {kindOptions.map((k) => (
            <option key={k || "all"} value={k}>{k ? dict.commKind(k) : "Todos os tipos"}</option>
          ))}

        </select>
      </div>

      {q.isLoading ? (
        <div className="space-y-6"><SkeletonStats count={4} /><SkeletonStats count={3} /></div>
      ) : q.isError ? (
        <EmptyState title="Não foi possível carregar" description={(q.error as Error)?.message ?? "Erro desconhecido"} />
      ) : totals ? (
        <div className="space-y-6">
          <Section title="Visão geral" icon={Bell}>
            <StatGrid cols={4}>
              <StatCard label="Geradas" value={totals.generated} tone="primary" />
              <StatCard label="Entregues" value={totals.delivered} tone="success" hint={`${deliveryRate}% do gerado`} />
              <StatCard label="Interações" value={totals.acted} tone="success" hint={`${actionRate}% das entregues`} />
              <StatCard label="Custo (USD)" value={`$${(totals.cost_usd ?? 0).toFixed(4)}`} />
            </StatGrid>
          </Section>

          <Section title="Fluxo de entrega" icon={Radio}>
            <StatGrid cols={4}>
              <StatCard label="Enfileiradas" value={totals.queued} />
              <StatCard label="Enviadas" value={totals.sent} />
              <StatCard label="Falhas" value={totals.failed} tone={totals.failed > 0 ? "warning" : "default"} />
              <StatCard label="Retidas por regra de convivência" value={totals.suppressed} tone="warning" />
            </StatGrid>
          </Section>

          <Section title="Preferências e dispensa" icon={ShieldAlert}>
            <StatGrid cols={3}>
              <StatCard label="Opt-out (usuário)" value={totals.opt_out} />
              <StatCard label="Dispensadas" value={totals.dismissed} />
              <StatCard label="Retidas no total" value={totals.suppressed} />
            </StatGrid>
          </Section>

          {quality.data && (
            <Section
              title="Qualidade e aprendizado"
              icon={BrainCircuit}
              description="Confirmações do usuário, falsos positivos e acompanhamento do assessor."
            >
              <StatGrid cols={4}>
                <StatCard label="Alertas úteis" value={quality.data.communications.useful} tone="success" />
                <StatCard
                  label="Não úteis"
                  value={quality.data.communications.not_useful}
                  tone={quality.data.communications.not_useful > 0 ? "warning" : "default"}
                />
                <StatCard label="Hipóteses confirmadas" value={quality.data.behavior.confirmed} />
                <StatCard label="Revisões concluídas" value={quality.data.advisor.completed} />
              </StatGrid>
            </Section>
          )}

          <Section title="Por tipo" icon={Mail} description="Ordenado pelas mais frequentes no período.">
            {q.data!.by_kind.length === 0 ? (
              <EmptyState title="Nenhum envio no período" description="Ajuste o filtro ou aguarde o próximo tick do agente proativo." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-neutral-500 text-xs uppercase tracking-wider">
                    <tr><th className="text-left py-2 pr-4">Tipo</th><th className="text-right pr-4">Total</th><th className="text-right pr-4">Entregues</th><th className="text-right pr-4">Interagidas</th><th className="text-right pr-4">Falhas</th><th className="text-right pr-4">Bloqueadas</th><th className="text-right">Custo</th></tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {q.data!.by_kind.map((row) => (
                      <tr key={row.kind}>
                        <td className="py-2 pr-4 font-medium text-neutral-800">{dict.commKind(row.kind)}</td>

                        <td className="text-right pr-4">{row.total}</td>
                        <td className="text-right pr-4 text-emerald-600">{row.delivered}</td>
                        <td className="text-right pr-4">{row.acted}</td>
                        <td className="text-right pr-4 text-amber-600">{row.failed}</td>
                        <td className="text-right pr-4">{row.suppressed}</td>
                        <td className="text-right tabular-nums">${(row.cost_usd ?? 0).toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Por canal" icon={MousePointerClick}>
            {q.data!.by_channel.length === 0 ? (
              <EmptyState title="Sem entregas" description="Nenhum canal registrou envio nesta janela." />
            ) : (
              <StatGrid cols={(q.data!.by_channel.length >= 3 ? 3 : 2) as 2 | 3}>
                {q.data!.by_channel.map((c) => (
                  <StatCard
                    key={c.channel}
                    label={dict.channel(c.channel)}
                    value={c.total}

                    hint={`${c.delivered} entregues · ${c.failed} falhas`}
                  />
                ))}
              </StatGrid>
            )}
          </Section>

          {totals.cost_usd > 0 && (
            <Section title="Custo" icon={DollarSign} description="Somatório de cost_usd em communication_deliveries.">
              <StatGrid cols={2}>
                <StatCard label="Custo no período" value={`$${totals.cost_usd.toFixed(4)}`} />
                <StatCard label="Custo médio por entrega" value={`$${(totals.delivered > 0 ? totals.cost_usd / totals.delivered : 0).toFixed(6)}`} />
              </StatGrid>
            </Section>
          )}
        </div>
      ) : (
        <EmptyState title="Sem dados ainda" description="Assim que o agente proativo enviar sugestões, você verá as métricas aqui." />
      )}
    </div>
  );
}
