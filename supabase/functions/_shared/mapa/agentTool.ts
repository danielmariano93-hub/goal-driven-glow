// Mapa Financeiro para o agente (app e WhatsApp). Somente leitura e só para contas liberadas (`mapa_access`).
// O agente recebe a leitura JÁ calculada e rotulada (pacote de evidência + situação por indicador + o que mudou) e só a repete:
// ele não decide status, não calcula e não vê respostas do CFPB nem texto de transações.
// deno-lint-ignore-file no-explicit-any
import { buildMapaEvidencePack, factText } from "../finance-core/mapaEvidencePack.ts";
import type { MapaIndicator, MapaReading } from "../finance-core/mapaContracts.ts";
import { loadMapaReading, mapaAccess } from "./runtime.ts";

export const MAPA_AGENT_VERSION = "mapa_agent.v1";

const STATUS_PT: Record<string, string> = { ok: "tudo certo", atencao: "atenção", critico: "precisa de cuidado", sem_dados: "sem dados" };
const CONF_PT: Record<string, string> = { alta: "leitura firme", moderada: "leitura razoável", insuficiente: "poucos dados" };

const TITLE: Record<string, string> = {
  "equilibrio.resultado_3m": "Resultado dos últimos 3 meses", "equilibrio.taxa_poupanca_3m": "Quanto da renda sobrou", "equilibrio.cobertura_mes": "Contas do mês cobertas com dinheiro certo",
  "equilibrio.tendencia": "Tendência do resultado mensal", "seguranca.meses_cobertos": "Meses de gastos que o dinheiro cobre", "seguranca.choque_1_renda": "Quanto de uma renda o dinheiro cobre",
  "dividas.comprometimento_renda": "Parcelas sobre a renda", "dividas.atrasos": "Dívidas em atraso", "dividas.custo_medio": "Custo médio das dívidas",
  "dividas.trajetoria": "Saldo devedor no mês", "dividas.perfil_custo_alto": "Parte da dívida de custo alto", "futuro.patrimonio_liquido": "Patrimônio líquido",
  "futuro.variacao_mes": "Variação do patrimônio no mês", "futuro.progresso_metas": "Metas de poupança", "futuro.resgates_sem_destino": "Resgates sem destino identificado",
  "execucao.aderencia": "Metas mensais cumpridas", "execucao.sequencia": "Meses seguidos no combinado", "execucao.aderencia_fim_de_semana": "Combinados de fim de semana",
  "planejamento.viabilidade": "Quanto do plano cabe na renda", "planejamento.recorrentes_registrados": "Contas fixas cadastradas", "planejamento.intencionalidade": "Gastos que você já planeja",
  "acompanhamento.calibragem_total": "Noção do gasto do mês (em teste)", "acompanhamento.categoria_que_mais_pesou": "Acerto da categoria que mais pesou (em teste)",
  "acompanhamento.reconhecimento_padroes": "Dicas que você achou úteis",
};

function line(i: MapaIndicator) {
  return { indicador: TITLE[i.id] ?? i.id, valor: factText(i), situacao: STATUS_PT[i.status], confianca: i.status === "sem_dados" ? null : CONF_PT[i.confidence], pilar: i.pillar };
}

/** Resumo para o agente. `reading` injetável para teste. */
export function mapaAgentResult(reading: MapaReading) {
  const pack = buildMapaEvidencePack(reading);
  const changed = reading.indicators
    .filter((i) => i.change?.comparable && (i.change.direction === "melhorou" || i.change.direction === "piorou"))
    .slice(0, 5)
    .map((i) => ({ indicador: TITLE[i.id] ?? i.id, mudou: i.change!.direction, antes: i.change!.previous === null ? null : factText({ ...i, value: i.change!.previous }) }));
  return {
    engine: "mapa_financeiro",
    version: MAPA_AGENT_VERSION,
    as_of: reading.as_of,
    modo: pack.mode,
    leitura: { titulo: pack.deterministic.title, texto: pack.deterministic.body, pergunta: pack.deterministic.question },
    recomendacao: pack.recommendation ? { acao: pack.recommendation.action_label, natureza: pack.recommendation.kind } : null,
    meses_fechados: reading.data_quality.closed_months,
    indicadores: reading.indicators.filter((i) => i.status !== "sem_dados").map(line),
    sem_dados: reading.indicators.filter((i) => i.status === "sem_dados").map((i) => ({ indicador: TITLE[i.id] ?? i.id, falta: i.needs?.code ?? null })),
    o_que_mudou: changed,
    regras: [
      "Repita os valores exatamente como estão; não calcule nem estime.",
      "Se a natureza da recomendação for estrutural, não diga para gastar ou cortar menos.",
      "Não fale de nota ou pontuação, não explique causas, não adivinhe emoções e não faça diagnóstico.",
      "Indicadores em teste são curiosidade, não conclusão.",
    ],
  };
}

export async function getMapaForAgent(sb: any, userId: string, today: string): Promise<{ ok: true; result: ReturnType<typeof mapaAgentResult> } | { ok: false; error: string }> {
  try {
    if (!(await mapaAccess(sb, userId))) return { ok: false, error: "mapa_not_enabled" };
    return { ok: true, result: mapaAgentResult(await loadMapaReading(sb, userId, today)) };
  } catch (error) {
    return { ok: false, error: "mapa_failed" };
  }
}

/** Texto determinístico para a rota "como estão meus hábitos?" quando a conta usa o Mapa. */
export function formatMapaForChat(result: any): string {
  const lines: string[] = [`*${String(result?.leitura?.titulo ?? "Seu Mapa Financeiro")}*`];
  if (result?.leitura?.texto) lines.push(String(result.leitura.texto));
  for (const c of (Array.isArray(result?.o_que_mudou) ? result.o_que_mudou : []).slice(0, 3)) {
    lines.push(`${c.mudou === "melhorou" ? "▲" : "▼"} ${c.indicador}${c.antes ? ` (antes: ${c.antes})` : ""}`);
  }
  if (result?.leitura?.pergunta) lines.push(String(result.leitura.pergunta));
  lines.push("Os detalhes estão em Mapa Financeiro, no app.");
  return lines.join("\n");
}
