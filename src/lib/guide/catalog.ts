/**
 * Catálogo do Guia do Nino (`user_guide.v1`) — fonte única dos primeiros passos
 * e dos tutoriais de funcionalidade.
 *
 * REGRA DE PRODUTO: toda funcionalidade navegável (entrada `secondary` em
 * `appNavigationRegistry`) precisa de um tutorial aqui — o teste
 * `user-guide-catalog` falha se esquecerem. Para anunciar uma novidade a quem já
 * usa o app, preencha `announce` (data de lançamento + por quantos dias aparece).
 *
 * Os passos essenciais NÃO são marcados à mão: a conclusão vem dos dados reais
 * (`guide_setup_status`). O que é manual (visto/dispensado) fica em `user_guide_state`.
 */

export type SetupKey =
  | "account" | "transaction" | "whatsapp" | "goal" | "card" | "recurring";

/** Resposta de `guide_setup_status()`. */
export type SetupStatus = {
  account: boolean;
  transaction: boolean;
  whatsapp: boolean;
  goal: boolean;
  category_goal: boolean;
  card: boolean;
  recurring: boolean;
  split: boolean;
};

export type GuideStep = { title: string; body: string };

export type SetupItem = {
  key: SetupKey;
  title: string;
  why: string;
  /** Passo essencial conta para o progresso principal; os demais são "para ir além". */
  essential: boolean;
  to: string;
  cta: string;
  steps: GuideStep[];
  done: (s: SetupStatus) => boolean;
};

export const SETUP_ITEMS: SetupItem[] = [
  {
    key: "account", title: "Crie sua primeira conta", essential: true,
    why: "É de onde o Nino lê o seu saldo. Sem conta, nenhum número fecha.",
    to: "/app/contas", cta: "Criar conta",
    steps: [
      { title: "Abra Contas", body: "Em Mais, toque em Contas." },
      { title: "Adicione a conta que você mais usa", body: "Pode ser a conta corrente, a carteira ou a poupança. Dê um nome que você reconheça." },
      { title: "Informe o saldo de hoje", body: "Assim o Nino parte do número certo e o “Disponível hoje” já nasce correto." },
    ],
    done: (s) => s.account,
  },
  {
    key: "transaction", title: "Registre seu primeiro lançamento", essential: true,
    why: "Cada gasto ou entrada alimenta a leitura do seu mês.",
    to: "/app/lancamentos", cta: "Lançar agora",
    steps: [
      { title: "Abra Movimentos", body: "É a aba com tudo o que entrou e saiu." },
      { title: "Toque em adicionar", body: "Informe valor, categoria e conta. A data já vem preenchida com hoje." },
      { title: "Prefere falar?", body: "Depois de conectar o WhatsApp, basta mandar “gastei 35 no almoço” para o Nino registrar." },
    ],
    done: (s) => s.transaction,
  },
  {
    key: "whatsapp", title: "Conecte seu WhatsApp", essential: true,
    why: "Você registra gastos e tira dúvidas conversando, sem abrir o app.",
    to: "/app/whatsapp", cta: "Conectar WhatsApp",
    steps: [
      { title: "Gere o código", body: "Em WhatsApp, confirme o consentimento e toque em gerar código. Ele vale 10 minutos." },
      { title: "Envie a mensagem pronta", body: "Toque em “Abrir WhatsApp”: a mensagem com o código já vai preenchida para o número oficial." },
      { title: "Pronto", body: "O Nino confirma o vínculo. Qualquer alteração no seu dinheiro pede a sua confirmação antes." },
    ],
    done: (s) => s.whatsapp,
  },
  {
    key: "goal", title: "Defina uma meta", essential: true,
    why: "Meta dá direção: o Nino avisa quando você se afasta ou se aproxima dela.",
    to: "/app/metas", cta: "Criar meta",
    steps: [
      { title: "Escolha o tipo", body: "Objetivo (juntar um valor) ou teto por categoria (gastar até X com mercado, por exemplo)." },
      { title: "Defina valor e prazo", body: "Comece com algo possível. Dá para ajustar depois." },
      { title: "Acompanhe", body: "O progresso aparece em Metas e no Início, e o Nino comenta o ritmo." },
    ],
    done: (s) => s.goal || s.category_goal,
  },
  {
    key: "card", title: "Cadastre um cartão de crédito", essential: false,
    why: "O Nino separa fatura, limite e parcelas do que você já pagou.",
    to: "/app/cartoes", cta: "Adicionar cartão",
    steps: [
      { title: "Abra Cartões", body: "Em Mais, toque em Cartões." },
      { title: "Informe fechamento e vencimento", body: "Com essas duas datas o Nino sabe em qual fatura cada compra cai." },
    ],
    done: (s) => s.card,
  },
  {
    key: "recurring", title: "Cadastre suas contas fixas", essential: false,
    why: "Aluguel, internet, assinaturas: o Nino conta com elas antes de dizer quanto sobra.",
    to: "/app/recorrencias", cta: "Cadastrar fixos",
    steps: [
      { title: "Abra Recorrências", body: "Em Mais, toque em Recorrências." },
      { title: "Adicione o que se repete", body: "Informe valor, dia do mês e categoria. O Nino lembra você perto do vencimento." },
    ],
    done: (s) => s.recurring,
  },
];

export type FeatureGuide = {
  id: string;
  title: string;
  summary: string;
  /** Caminho da tela (precisa existir em `appNavigationRegistry`). */
  path: string;
  cta: string;
  steps: GuideStep[];
  /** Presente = aparece como novidade no Início de quem já tinha conta antes do lançamento. */
  announce?: { releasedAt: string; days: number };
};

export const FEATURE_GUIDES: FeatureGuide[] = [
  {
    id: "relatorios", title: "Relatórios", path: "/app/relatorios", cta: "Abrir relatórios",
    summary: "Veja como foi o seu período, com gráficos, hábitos e destaques.",
    announce: { releasedAt: "2026-10-04", days: 45 },
    steps: [
      { title: "Escolha o período", body: "Semana, mês ou um intervalo seu. Tudo na tela se ajusta." },
      { title: "Filtre", body: "Por categoria, conta ou estabelecimento para achar onde o dinheiro foi." },
      { title: "Leia o veredito", body: "O Nino resume o período e aponta o que mais merece atenção." },
    ],
  },
  {
    id: "divisao-do-role", title: "Divisão do Rolê", path: "/app/divisao-do-role", cta: "Dividir uma conta",
    summary: "Divida uma conta com quem foi junto e acompanhe quem já pagou.",
    announce: { releasedAt: "2026-10-04", days: 45 },
    steps: [
      { title: "Crie a divisão", body: "Informe o total e quem participa. Dá para dividir igual ou por valor." },
      { title: "Envie a cobrança", body: "O Nino lembra cada pessoa pelo WhatsApp até confirmar o pagamento." },
      { title: "Acompanhe", body: "Na divisão você vê quem pagou, quem falta e confirma os pagamentos informados." },
    ],
  },
  {
    id: "planejamento", title: "Antes de gastar", path: "/app/planejamento", cta: "Simular uma compra",
    summary: "Simule uma compra e veja o efeito no seu mês antes de pagar.",
    announce: { releasedAt: "2026-10-04", days: 45 },
    steps: [
      { title: "Informe a compra", body: "Valor, se é à vista ou parcelado, e a data." },
      { title: "Veja o impacto", body: "O Nino mostra o que muda no saldo, na fatura e nas metas." },
    ],
  },
  {
    id: "contas", title: "Contas", path: "/app/contas", cta: "Ver contas",
    summary: "Suas carteiras e saldos num só lugar.",
    steps: [
      { title: "Adicione contas", body: "Corrente, poupança, carteira. Cada uma com o próprio saldo." },
      { title: "Mantenha o saldo conferido", body: "Ajuste o saldo quando não bater com o banco." },
    ],
  },
  {
    id: "cartoes", title: "Cartões", path: "/app/cartoes", cta: "Ver cartões",
    summary: "Faturas, limites e parcelas.",
    steps: [
      { title: "Cadastre o cartão", body: "Com dia de fechamento e vencimento." },
      { title: "Acompanhe a fatura", body: "Veja o que já entrou, o limite livre e as parcelas futuras." },
    ],
  },
  {
    id: "recorrencias", title: "Recorrências", path: "/app/recorrencias", cta: "Ver recorrências",
    summary: "Contas e rendas que se repetem todo mês.",
    steps: [
      { title: "Cadastre o que se repete", body: "Aluguel, salário, assinaturas." },
      { title: "Deixe o Nino lembrar", body: "Você é avisado perto do vencimento e o saldo projetado já considera o fixo." },
    ],
  },
  {
    id: "categorias", title: "Categorias", path: "/app/categorias", cta: "Ver categorias",
    summary: "Organize seus gastos do seu jeito.",
    steps: [
      { title: "Use as padrão", body: "Já cobrem a maior parte do dia a dia." },
      { title: "Crie as suas", body: "Se algo não se encaixa, crie uma categoria pessoal." },
    ],
  },
  {
    id: "investimentos", title: "Investimentos", path: "/app/investimentos", cta: "Ver investimentos",
    summary: "Sua carteira agregada.",
    steps: [
      { title: "Registre seus ativos", body: "Informe o valor aplicado e o saldo atual." },
      { title: "Acompanhe o total", body: "O Nino soma tudo ao seu patrimônio." },
    ],
  },
  {
    id: "dividas", title: "Dívidas", path: "/app/dividas", cta: "Ver dívidas",
    summary: "O que você deve, com plano para quitar.",
    steps: [
      { title: "Cadastre a dívida", body: "Valor, parcelas e vencimento." },
      { title: "Registre pagamentos", body: "O saldo devedor e o prazo se atualizam." },
    ],
  },
  {
    id: "compromissos", title: "Compromissos", path: "/app/compromissos", cta: "Ver compromissos",
    summary: "Agenda do que vence.",
    steps: [
      { title: "Veja o que vem aí", body: "Contas, faturas e parcelas ordenadas por data." },
      { title: "Planeje o caixa", body: "Saiba quanto precisa reservar até cada vencimento." },
    ],
  },
  {
    id: "emocoes", title: "Emocional", path: "/app/emocoes", cta: "Fazer um check-in",
    summary: "Entenda como você se sente ao gastar.",
    steps: [
      { title: "Faça um check-in", body: "Registre como está se sentindo; leva segundos." },
      { title: "Descubra padrões", body: "O Nino mostra em quais emoções ou dias você gasta mais." },
    ],
  },
  {
    id: "desafios", title: "Desafios", path: "/app/desafios", cta: "Ver desafios",
    summary: "Metas de hábito com conquistas.",
    steps: [
      { title: "Escolha um desafio", body: "Por exemplo, uma semana sem delivery." },
      { title: "Acompanhe a sequência", body: "Cada dia cumprido conta; o Nino comemora com você." },
    ],
  },
  {
    id: "cobrancas", title: "Cobranças recebidas", path: "/app/cobrancas", cta: "Ver cobranças",
    summary: "O que pediram para você pagar.",
    steps: [
      { title: "Veja o que chegou", body: "Divisões em que você é participante." },
      { title: "Informe o pagamento", body: "Ao pagar, avise; quem cobrou confirma." },
    ],
  },
  {
    id: "metas-conjuntas", title: "Metas conjuntas", path: "/app/metas-conjuntas", cta: "Ver metas conjuntas",
    summary: "Objetivos com outras pessoas.",
    steps: [
      { title: "Convide quem vai junto", body: "Cada um contribui do seu jeito." },
      { title: "Acompanhe o total", body: "O progresso é de todos, num só lugar." },
    ],
  },
  {
    id: "importar", title: "Importar dados", path: "/app/importar", cta: "Importar",
    summary: "Traga extratos e planilhas para o Nino.",
    steps: [
      { title: "Escolha o arquivo", body: "CSV ou OFX do seu banco." },
      { title: "Revise e confirme", body: "Você vê o que será importado antes de gravar." },
    ],
  },
  {
    id: "notificacoes", title: "Notificações", path: "/app/notificacoes", cta: "Ver notificações",
    summary: "Avisos e lembretes do Nino.",
    steps: [
      { title: "Veja os avisos", body: "Vencimentos, metas e alertas num só lugar." },
      { title: "Ajuste no perfil", body: "Escolha o que e por onde quer ser avisado." },
    ],
  },
  {
    id: "perfil", title: "Perfil", path: "/app/perfil", cta: "Abrir perfil",
    summary: "Conta, conexões e privacidade.",
    steps: [
      { title: "Revise seus dados", body: "Nome, renda e preferências." },
      { title: "Gerencie conexões", body: "WhatsApp e privacidade." },
    ],
  },
  {
    id: "plano", title: "Seu plano", path: "/app/plano", cta: "Ver plano",
    summary: "O que está incluído hoje.",
    steps: [{ title: "Confira o que você tem", body: "Funcionalidades e limites do seu plano." }],
  },
];

/* ---------- lógica pura (testável) ---------- */

export type GuideStatus = "seen" | "completed" | "dismissed";
export type GuideStateMap = Record<string, GuideStatus>;

export const SETUP_DISMISS_KEY = "setup";
export const featureStateKey = (id: string) => `feature:${id}`;

export function setupProgress(status: SetupStatus | null | undefined) {
  const items = SETUP_ITEMS.map((item) => ({ ...item, completed: status ? item.done(status) : false }));
  const essential = items.filter((i) => i.essential);
  const doneEssential = essential.filter((i) => i.completed).length;
  return {
    items,
    essentialTotal: essential.length,
    essentialDone: doneEssential,
    allEssentialDone: doneEssential === essential.length,
    next: items.find((i) => i.essential && !i.completed) ?? items.find((i) => !i.completed) ?? null,
  };
}

/** O card de primeiros passos aparece até concluir o essencial ou dispensar. */
export function shouldShowSetupCard(status: SetupStatus | null | undefined, state: GuideStateMap): boolean {
  if (!status) return false;
  if (state[SETUP_DISMISS_KEY] === "dismissed") return false;
  return !setupProgress(status).allEssentialDone;
}

const DAY_MS = 86_400_000;

/**
 * Novidades para quem JÁ tinha conta no lançamento (usuário novo conhece a
 * funcionalidade pelo próprio guia). Some ao ver/dispensar ou após `days`.
 */
export function pendingAnnouncements(
  state: GuideStateMap,
  userCreatedAt: string | null | undefined,
  now: number = Date.now(),
): FeatureGuide[] {
  const created = userCreatedAt ? Date.parse(userCreatedAt) : NaN;
  return FEATURE_GUIDES.filter((g) => {
    if (!g.announce) return false;
    if (state[featureStateKey(g.id)]) return false;
    const released = Date.parse(g.announce.releasedAt);
    if (!Number.isFinite(released)) return false;
    if (now < released || now > released + g.announce.days * DAY_MS) return false;
    return Number.isFinite(created) && created < released;
  });
}

export function featureGuideById(id: string): FeatureGuide | undefined {
  return FEATURE_GUIDES.find((g) => g.id === id);
}
