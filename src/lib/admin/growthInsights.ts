// Leitura acionável do crescimento: converte contagens em frases com a próxima ação.
export type GrowthSummary = {
  total_clients: number; new_clients: number; active_clients: number;
  activated_clients: number; dormant_clients: number; with_financial_data: number;
};

export type GrowthInsight = { key: string; tone: "danger" | "warning" | "success" | "info"; title: string; detail: string };

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function growthInsights(s: GrowthSummary): GrowthInsight[] {
  const out: GrowthInsight[] = [];
  if (s.total_clients === 0) return out;
  const dormantShare = s.dormant_clients / s.total_clients;
  const noData = s.total_clients - s.with_financial_data;
  if (s.dormant_clients > 0 && dormantShare >= 0.5) {
    out.push({
      key: "dormant", tone: dormantShare >= 0.75 ? "danger" : "warning",
      title: `${pct(dormantShare)} dos clientes estão dormentes`,
      detail: `${s.dormant_clients} de ${s.total_clients} pararam de usar. Em Clientes, o segmento "Dormentes" lista quem reativar primeiro.`,
    });
  }
  if (noData > 0 && noData / s.total_clients >= 0.25) {
    out.push({
      key: "no_data", tone: "warning",
      title: `${noData} cliente${noData === 1 ? "" : "s"} sem dados financeiros`,
      detail: "Sem lançamentos o Nino não tem o que analisar. A primeira ação (registrar um gasto ou importar fatura) é o gargalo.",
    });
  }
  if (s.new_clients > 0 && s.activated_clients / s.new_clients < 0.5) {
    out.push({
      key: "activation", tone: "warning",
      title: `Só ${pct(s.activated_clients / s.new_clients)} dos novos clientes ativaram`,
      detail: "Revise o onboarding: o que separa quem chega de quem faz a primeira ação?",
    });
  }
  if (s.new_clients > 0 && s.activated_clients === s.new_clients) {
    out.push({ key: "activation_ok", tone: "success", title: "Todos os novos clientes ativaram", detail: "A entrada está funcionando; o desafio agora é a retenção." });
  }
  return out;
}

/** Cor da célula de retenção (0–1) como classe de fundo. */
export function retentionTone(rate: number | null): string {
  if (rate == null) return "bg-secondary/40 text-muted-foreground";
  if (rate >= 0.6) return "bg-success/30 text-foreground";
  if (rate >= 0.3) return "bg-warning/30 text-foreground";
  return "bg-destructive/20 text-foreground";
}
