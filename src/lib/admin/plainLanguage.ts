// Linguagem simples para os avisos do admin: o que aconteceu, o que isso significa e o que fazer. Sem código técnico na tela principal.

export type Explained = { what: string; means: string; todo: string };

const MESSAGE_KIND: Record<string, string> = {
  split_payment_confirmation: "Confirmação de pagamento de uma divisão de conta",
  split_overdue: "Cobrança de divisão de conta atrasada",
  split_due_today: "Lembrete de divisão que vence hoje",
  split_support: "Mensagem de apoio de divisão de conta",
  due_reminder: "Lembrete de conta a vencer",
  weekly_report: "Relatório semanal",
  monthly_report: "Relatório mensal",
  proactive: "Aviso proativo do Nino",
  agent: "Resposta do Nino",
};

export const messageKindLabel = (kind?: string | null) =>
  (kind && MESSAGE_KIND[kind]) || (kind ? kind.replace(/_/g, " ") : "Mensagem");

const FAILURE: Record<string, Explained> = {
  ack_stalled_no_delivery: {
    what: "O WhatsApp recebeu a mensagem, mas nunca confirmou que ela chegou ao celular.",
    means: "Quase sempre é do lado de quem recebe: celular desligado ou sem internet, número que não usa mais WhatsApp, ou a pessoa bloqueou o número. Não indica falha do Nino.",
    todo: "Se for uma pessoa importante, peça para ela abrir o WhatsApp e use “Tentar de novo”. Se acontecer com várias pessoas ao mesmo tempo, aí sim vale conferir a conexão do WhatsApp.",
  },
  not_on_whatsapp: {
    what: "O número não tem WhatsApp.",
    means: "A mensagem não tem como chegar a esse número.",
    todo: "Confirme o número com a pessoa.",
  },
  session_not_connected: {
    what: "A conexão do Nino com o WhatsApp estava fora do ar.",
    means: "Nenhuma mensagem sai enquanto a conexão estiver caída.",
    todo: "Abra Mensageria e reconecte o WhatsApp (leitura do QR code).",
  },
};

export const failureExplained = (code?: string | null): Explained =>
  (code && FAILURE[code]) || {
    what: code ? `O envio falhou (${String(code).replace(/_/g, " ")}).` : "O envio falhou.",
    means: "O motivo não é um dos conhecidos. Pode ser pontual.",
    todo: "Use “Tentar de novo”. Se falhar outra vez, veja o detalhe na central de mensagens.",
  };

/** O que cada rotina faz e o que acontece se ela parar. Rotina desconhecida cai num texto genérico honesto. */
const JOB_PLAIN: Record<string, { does: string; impact: string }> = {
  product_events_prune: {
    does: "Apaga, uma vez por dia, eventos de uso com mais de 90 dias.",
    impact: "Se parar, nada quebra para as pessoas: só a base de eventos cresce com o tempo.",
  },
  "split-reminders-dispatch": {
    does: "Envia os lembretes de divisão de conta.",
    impact: "Se parar, as pessoas deixam de receber lembretes de divisão.",
  },
  "whatsapp-send": {
    does: "Envia as mensagens que estão na fila do WhatsApp.",
    impact: "Se parar, nenhuma mensagem sai.",
  },
  "financial-reports-weekly": {
    does: "Gera e envia o relatório semanal.",
    impact: "Se parar, os relatórios semanais deixam de chegar.",
  },
  "insights-generate": {
    does: "Gera os insights e avisos do Nino a cada hora.",
    impact: "Se parar, as pessoas deixam de receber novos avisos.",
  },
  "anticipation-tick": {
    does: "Antecipa vencimentos e situações que precisam de aviso.",
    impact: "Se parar, avisos de vencimento podem atrasar.",
  },
};

export function jobProblemText(label: string, jobKey: string, hoursSince: number | null, failed: boolean, errorCode?: string | null) {
  const plain = JOB_PLAIN[jobKey];
  const impact = plain ? `${plain.does} ${plain.impact}` : "Rotina automática do sistema.";
  if (failed) {
    return {
      title: `A rotina “${label}” falhou na última vez`,
      detail: `${impact} ${errorCode ? `Motivo registrado: ${String(errorCode).replace(/_/g, " ")}. ` : ""}Se continuar falhando, peça uma checagem técnica.`,
    };
  }
  if (hoursSince == null) {
    return {
      title: `A rotina “${label}” ainda não registrou nenhuma execução`,
      detail: `${impact} Pode estar rodando sem deixar registro, e não necessariamente parada. Se isso não mudar em um dia, peça uma checagem técnica.`,
    };
  }
  return {
    title: `A rotina “${label}” não roda há ${hoursSince} h`,
    detail: `${impact} O esperado era rodar mais vezes que isso. Peça uma checagem técnica.`,
  };
}
