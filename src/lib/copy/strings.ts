/**
 * Fonte central de tom e microcopy do app do usuário (pt-BR).
 * Regras: caloroso, direto, sem culpa, sem jargão financeiro na UI.
 * Termos técnicos ficam em tooltips.
 */

export const copy = {
  // Ações principais
  actions: {
    logExpense: "Anotar gasto",
    logIncome: "Adicionar entrada",
    saveForGoal: "Guardar para uma meta",
    beforeBuying: "Antes de comprar",
    talkToAssistant: "Fale com seu assistente no WhatsApp",
    seeAll: "Ver tudo",
  },

  // Metas
  goals: {
    title: "Metas",
    subtitle: "Cada valor guardado te aproxima do que importa.",
    empty: {
      title: "Qual sonho você quer tirar do papel?",
      body: "Crie sua primeira meta e comece a guardar dinheiro em pequenos passos.",
    },
    contribute: "Guardar",
    contributeAction: "Guardar dinheiro nesta meta",
    contributionsLabel: (n: number) => `Valores guardados (${n})`,
    hideContributions: "Ocultar",
    savedOf: (pct: number) => `Você já guardou ${pct}%`,
  },

  // Recorrências
  recurring: {
    title: "Contas que se repetem",
    subtitle: "Coisas que entram e saem todo mês, no automático.",
    empty: "Nenhuma conta recorrente ainda.",
  },

  // Antes de gastar
  simulator: {
    title: "Antes de comprar",
    subtitle: "Veja como essa compra pode mexer com o seu mês.",
    // Explicação técnica só em ajuda discreta:
    hint: "Cálculo baseado nos seus dados reais deste mês.",
  },

  // WhatsApp (canal, não módulo)
  whatsapp: {
    ctaTitle: "Fale com seu assistente no WhatsApp",
    ctaBody: "Anote gastos e receba dicas por mensagem.",
    linkSheet: {
      title: "Vincular seu WhatsApp",
      body: "Vamos abrir uma conversa com seu assistente. Você continua no controle: nada é gravado sem sua confirmação.",
      privacy: "Seu número fica associado só à sua conta. Você pode desvincular a qualquer momento.",
      consent: "Concordo em vincular meu número ao MeuNino (LGPD).",
      generate: "Gerar código e abrir WhatsApp",
      alreadyLinked: "Abrir conversa",
      manageIn: "Gerencie sua conexão em Perfil.",
    },
  },

  // Dica do assistente
  tip: {
    header: "Dica do seu assistente",
    feedbackUseful: "Foi útil",
    feedbackNotUseful: "Não foi útil",
    thanks: "Obrigado pelo retorno.",
    fallbackTitle: "Vamos nos conhecer melhor",
    fallbackBody: "Registre um gasto ou uma entrada para eu começar a te ajudar de verdade.",
    fallbackCta: "Anotar gasto",
  },

  // Comece por aqui (onboarding contextual)
  startHere: {
    header: "Comece por aqui",
    subtitle: "Três passos para o app te conhecer.",
    addAccount: "Cadastrar sua primeira conta",
    logExpense: "Anotar seu primeiro gasto",
    createGoal: "Definir uma meta",
    linkWhatsApp: "Ligar seu WhatsApp ao assistente",
  },

  // Para pagar (cobranças recebidas)
  charges: {
    title: "Para pagar",
    subtitle: "Cobranças que alguém compartilhou com você.",
    empty: "Você não tem cobranças para pagar agora.",
    reportPaid: "Já paguei",
    dispute: "Contestar",
    clear: "Cancelar aviso",
    reported: "Você informou como pago",
    disputed: "Você contestou este valor",
    included: (owner: string, title: string) => `${owner} incluiu você em "${title}"`,
  },

  // Mais
  more: {
    title: "Mais",
    subtitle: "Tudo que pode te ajudar.",
    sections: {
      highlight: "Em destaque",
      organize: "Organizar meu dinheiro",
      understand: "Entender melhor",
      account: "Minha conta",
    },
  },

  // Comum
  common: {
    loading: "Carregando…",
    error: "Algo não saiu como o esperado.",
    save: "Salvar",
    cancel: "Cancelar",
    close: "Fechar",
    remove: "Remover",
    edit: "Editar",
  },
} as const;
