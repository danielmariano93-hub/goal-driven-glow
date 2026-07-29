/**
 * Universo canônico do painel administrativo.
 *
 * O painel confundia quatro coisas diferentes e mostrava números que pareciam
 * errados ("2 clientes, 16 usuários, centenas de eventos"). Aqui elas ficam
 * separadas e nomeadas em linguagem de negócio:
 *
 * - Cliente        → conta real de uma pessoa usando o Meu Nino.
 * - Conta          → qualquer perfil existente, inclusive teste e administração.
 * - Identificador  → pseudônimo usado nos eventos (pode existir sem conta,
 *                    quando veio de histórico reconstruído).
 * - Execução       → cada vez que o Nino trabalhou (app ou WhatsApp).
 *
 * Nenhum número do admin deve ser lido sem saber a qual destes ele pertence.
 */

export type AdminUniverse = {
  clients: number;
  accounts: number;
  platform_admins: number;
  test_accounts: number;
  pseudonyms: number;
  event_pseudonyms: number;
  event_pseudonyms_orphan: number;
  events_total: number;
  events_live: number;
  events_reconstructed: number;
  events_last_at: string | null;
  agent_runs: number;
  measured_at: string;
  formula_version: string;
};

export const UNIVERSE_LABEL = {
  clients: "Clientes reais",
  accounts: "Contas cadastradas",
  pseudonyms: "Identificadores de cliente",
  event_pseudonyms: "Identificadores presentes nos eventos",
  agent_runs: "Execuções do Nino",
} as const;

export const UNIVERSE_EXPLAINER =
  "Clientes reais excluem administradores da plataforma e contas marcadas como teste. " +
  "Identificadores de evento não são pessoas: histórico reconstruído pode gerar identificadores sem conta associada.";

export type UniverseNote = {
  id: string;
  tone: "info" | "warning";
  title: string;
  detail: string;
};

/**
 * Traduz as divergências do universo em avisos honestos, para o painel nunca
 * apresentar um número sem explicar de onde ele veio.
 */
export function universeNotes(u: AdminUniverse | null | undefined): UniverseNote[] {
  if (!u) return [];
  const notes: UniverseNote[] = [];

  if (u.event_pseudonyms_orphan > 0) {
    notes.push({
      id: "orphan-pseudonyms",
      tone: "warning",
      title: `${u.event_pseudonyms_orphan} identificador(es) de evento sem cliente correspondente`,
      detail:
        "Vieram de histórico reconstruído. Eles não são clientes e não entram em nenhum indicador de cliente — " +
        "só aparecem em contagens de eventos brutos.",
    });
  }

  if (u.events_reconstructed > 0) {
    const pct = u.events_total > 0 ? Math.round((u.events_reconstructed / u.events_total) * 100) : 0;
    notes.push({
      id: "reconstructed-events",
      tone: "info",
      title: `${pct}% dos eventos são histórico reconstruído`,
      detail:
        "Eventos reconstruídos servem para entender o passado, mas não representam uso ao vivo. " +
        "Indicadores de comportamento usam apenas eventos ao vivo.",
    });
  }

  const stale = staleDays(u.events_last_at);
  if (stale !== null && stale >= 2) {
    notes.push({
      id: "stale-events",
      tone: "warning",
      title: `Sem novos eventos há ${stale} dia(s)`,
      detail:
        "As telas de produto vão parecer vazias. Isso indica ausência de uso no período ou coleta interrompida, " +
        "não erro de cálculo.",
    });
  }

  if (u.test_accounts > 0) {
    notes.push({
      id: "test-accounts",
      tone: "info",
      title: `${u.test_accounts} conta(s) de teste fora das métricas`,
      detail: "Contas de teste e administradores nunca entram nos indicadores de cliente.",
    });
  }

  return notes;
}

export function staleDays(lastAt: string | null | undefined): number | null {
  if (!lastAt) return null;
  const diff = Date.now() - new Date(lastAt).getTime();
  if (Number.isNaN(diff)) return null;
  return Math.floor(diff / 86_400_000);
}

/** Frase curta de rodapé para qualquer bloco que conte pessoas. */
export function universeCaption(u: AdminUniverse | null | undefined): string {
  if (!u) return UNIVERSE_EXPLAINER;
  return `${u.clients} cliente(s) reais de ${u.accounts} conta(s) cadastradas · ${UNIVERSE_EXPLAINER}`;
}
