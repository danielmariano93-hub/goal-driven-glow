// Runtime servidor do Mapa Financeiro (`mapa_financeiro.v1`).
// Carrega o ledger canônico (competência, estornos, sem transferência/fatura/investimento) e entrega a leitura pronta.
// Nenhuma fórmula vive aqui: tudo está em `finance-core` (mapa*.ts), o mesmo código do app.
// deno-lint-ignore-file no-explicit-any
import { loadExecutiveInput } from "../insights/executive/load.ts";
import { buildMapaReading, type MapaReading } from "../finance-core/mapaReading.ts";

/** Acesso controlado por flag (`mapa_access`): por ora só quem foi liberado. */
export async function mapaAccess(sb: any, userId: string): Promise<boolean> {
  const { data, error } = await sb.from("mapa_access").select("enabled").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`mapa_access:${error.message}`);
  return data?.enabled === true;
}

export async function loadMapaReading(sb: any, userId: string, today: string): Promise<MapaReading> {
  // 24 meses de histórico; leitura paginada dentro do loader.
  const input = await loadExecutiveInput(sb, userId, today, 24);
  const entries = input.entries.map((e) => ({ date: e.date, kind: e.kind, amount: e.amount }));
  return buildMapaReading({ asOf: today, entries });
}
