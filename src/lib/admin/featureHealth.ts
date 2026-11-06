import { useQuery } from "@tanstack/react-query";
import { callAdminRpc } from "@/lib/admin/adminRpc";

// nino_feature_health.v1 — cada linha responde "esta feature está entregando o que deveria?".
// Estados: ok (funcionando), warn (atenção), crit (parou ou quebrou), nodata (amostra pequena: não é verde nem vermelho), info.

export type HealthStatus = "ok" | "warn" | "crit" | "nodata" | "info";

export interface HealthRow {
  key: string;
  group: string;
  title: string;
  question: string;
  status: HealthStatus;
  value: string | null;
  reference: string | null;
  detail: string | null;
  action: string | null;
  link: string | null;
}

export interface FeatureHealthData {
  generated_at: string;
  rows: HealthRow[];
}

export function useFeatureHealth() {
  return useQuery({
    queryKey: ["admin-feature-health"],
    queryFn: () => callAdminRpc<FeatureHealthData>("admin_feature_health"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

const RANK: Record<HealthStatus, number> = { crit: 0, warn: 1, info: 2, ok: 3, nodata: 4 };

export const STATUS_LABEL: Record<HealthStatus, string> = {
  crit: "Parou ou quebrou",
  warn: "Atenção",
  info: "Informativo",
  ok: "Funcionando",
  nodata: "Sem dados suficientes",
};

export interface HealthSummary {
  attention: HealthRow[];
  informative: HealthRow[];
  working: HealthRow[];
  nodata: HealthRow[];
  critical: number;
}

/** Separa o que exige ação do que está bem e do que ainda não dá para medir. */
export function summarizeHealth(rows: HealthRow[] | undefined | null): HealthSummary {
  const sorted = [...(rows ?? [])].sort((a, b) => RANK[a.status] - RANK[b.status]);
  const attention = sorted.filter((r) => r.status === "crit" || r.status === "warn");
  return {
    attention,
    informative: sorted.filter((r) => r.status === "info"),
    working: sorted.filter((r) => r.status === "ok"),
    nodata: sorted.filter((r) => r.status === "nodata"),
    critical: attention.filter((r) => r.status === "crit").length,
  };
}

/** Frase única do topo: o que o administrador precisa saber antes de ler o resto. */
export function healthHeadline(s: HealthSummary): string {
  if (s.attention.length === 0) {
    return s.working.length
      ? `Tudo o que dá para medir está funcionando (${s.working.length} features${s.nodata.length ? `, ${s.nodata.length} ainda sem dados suficientes` : ""}).`
      : "Ainda não há dados suficientes para avaliar as features.";
  }
  const n = s.attention.length;
  return s.critical > 0
    ? `${s.critical} feature${s.critical > 1 ? "s" : ""} parou ou quebrou${n > s.critical ? ` e mais ${n - s.critical} pede atenção` : ""}.`
    : `${n} feature${n > 1 ? "s" : ""} pede${n > 1 ? "m" : ""} atenção.`;
}

export const GROUP_ORDER = ["Mensagens proativas", "Agente", "Mapa Financeiro", "Relatórios e dados", "Flags"];
