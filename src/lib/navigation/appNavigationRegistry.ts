/**
 * Fonte ÚNICA de verdade da navegação do app (`app_navigation.v1`).
 *
 * Antes existiam três listas manuais (BottomTabBar, MaisMenu, DesktopSidebar)
 * mais as rotas de `App.tsx`. Quando uma tela nascia, ela podia ficar órfã em
 * dois desses lugares sem ninguém perceber. Agora cada rota de `/app` tem UMA
 * entrada aqui, e as três superfícies derivam desta lista.
 *
 * `navigationType` declara a intenção do produto para a rota:
 * - primary: aba/atalho principal;
 * - secondary: funcionalidade navegável por menu (Mais no mobile, sidebar no desktop);
 * - detail: tela de detalhe de outra funcionalidade (tem `parentId`);
 * - deep_link: alvo legítimo de link/notificação, não aparece em menu;
 * - internal: tela de sistema/diagnóstico, acessada por dentro de outra tela;
 * - legacy_redirect: rota antiga preservada só para não quebrar links.
 */
import {
  BadgeCheck, BarChart3, Bell, Calculator, CreditCard, Heart, HandCoins, House,
  ListChecks, PiggyBank, Repeat, Sparkles, Tag, Target, Trophy, Upload,
  User, Users, Wallet, CalendarClock, LayoutDashboard, List,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavigationType =
  | "primary"
  | "secondary"
  | "detail"
  | "deep_link"
  | "internal"
  | "legacy_redirect";

export type NavGroup = "principal" | "organizar" | "entender" | "conta";

export type MobilePlacement = "tab" | "more" | "none";
export type DesktopPlacement = "sidebar" | "none";

export type NavEntry = {
  id: string;
  /** Caminho absoluto exatamente como declarado em `App.tsx`. */
  path: string;
  label: string;
  desc?: string;
  icon?: LucideIcon;
  group?: NavGroup;
  navigationType: NavigationType;
  mobilePlacement: MobilePlacement;
  desktopPlacement: DesktopPlacement;
  /** Prefixos que marcam este item (ou seu pai) como ativo. */
  activePaths?: string[];
  parentId?: string;
  featureStatus: "active" | "beta";
};

const e = (entry: NavEntry): NavEntry => entry;

export const APP_NAVIGATION: NavEntry[] = [
  // ---------- primárias ----------
  e({ id: "home", path: "/app", label: "Início", desc: "Sua leitura de hoje", icon: House, group: "principal", navigationType: "primary", mobilePlacement: "tab", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "lancamentos", path: "/app/lancamentos", label: "Movimentos", desc: "Tudo que entrou e saiu", icon: List, group: "principal", navigationType: "primary", mobilePlacement: "tab", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "metas", path: "/app/metas", label: "Metas", desc: "Objetivos e tetos por categoria", icon: Target, group: "principal", navigationType: "primary", mobilePlacement: "tab", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "nino", path: "/app/nino", label: "Nino", desc: "Agora, mudanças e o que vem aí", icon: Sparkles, group: "principal", navigationType: "primary", mobilePlacement: "none", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "mais", path: "/app/mais", label: "Mais", desc: "Todas as funcionalidades", icon: LayoutDashboard, navigationType: "primary", mobilePlacement: "tab", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "planejamento", path: "/app/planejamento", label: "Antes de gastar", desc: "Simule a compra antes de pagar", icon: Calculator, group: "principal", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),

  // ---------- organizar ----------
  e({ id: "contas", path: "/app/contas", label: "Contas", desc: "Suas carteiras", icon: Wallet, group: "organizar", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "cartoes", path: "/app/cartoes", label: "Cartões", desc: "Faturas, limites e parcelas", icon: CreditCard, group: "organizar", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "recorrencias", path: "/app/recorrencias", label: "Recorrências", desc: "Fixos que se repetem", icon: Repeat, group: "organizar", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "categorias", path: "/app/categorias", label: "Categorias", desc: "Padrões e pessoais", icon: Tag, group: "organizar", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "investimentos", path: "/app/investimentos", label: "Investimentos", desc: "Carteira agregada", icon: PiggyBank, group: "organizar", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "dividas", path: "/app/dividas", label: "Dívidas", desc: "O que você deve", icon: HandCoins, group: "organizar", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "compromissos", path: "/app/compromissos", label: "Compromissos", desc: "Agenda do que vence", icon: CalendarClock, group: "organizar", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),

  // ---------- entender ----------
  e({ id: "relatorios", path: "/app/relatorios", label: "Relatórios", desc: "Período atual e fechamentos", icon: BarChart3, group: "entender", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", activePaths: ["/app/relatorios", "/app/relatorios-inteligentes"], featureStatus: "active" }),
  e({ id: "emocoes", path: "/app/emocoes", label: "Emocional", desc: "Como você se sente ao gastar", icon: Heart, group: "entender", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "desafios", path: "/app/desafios", label: "Desafios", desc: "Metas de hábito com conquistas", icon: Trophy, group: "entender", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "divisao-do-role", path: "/app/divisao-do-role", label: "Divisão do Rolê", desc: "Divida contas com quem foi junto", icon: Users, group: "entender", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "cobrancas", path: "/app/cobrancas", label: "Cobranças recebidas", desc: "O que pediram para você pagar", icon: ListChecks, group: "entender", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "metas-conjuntas", path: "/app/metas-conjuntas", label: "Metas conjuntas", desc: "Objetivos com outras pessoas", icon: Users, group: "entender", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),

  // ---------- conta ----------
  e({ id: "perfil", path: "/app/perfil", label: "Perfil", desc: "Conta, conexões e privacidade", icon: User, group: "conta", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "plano", path: "/app/plano", label: "Seu plano", desc: "O que está incluído hoje", icon: BadgeCheck, group: "conta", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "notificacoes", path: "/app/notificacoes", label: "Notificações", desc: "Avisos e lembretes do Nino", icon: Bell, group: "conta", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),
  e({ id: "importar", path: "/app/importar", label: "Importar dados", desc: "CSV, OFX e legado", icon: Upload, group: "conta", navigationType: "secondary", mobilePlacement: "more", desktopPlacement: "sidebar", featureStatus: "active" }),

  // ---------- detalhes ----------
  e({ id: "lancamento-detalhe", path: "/app/lancamentos/:id", label: "Lançamento", navigationType: "detail", parentId: "lancamentos", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "meta-detalhe", path: "/app/metas/:id", label: "Meta", navigationType: "detail", parentId: "metas", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "meta-categoria-detalhe", path: "/app/metas/categoria/:id", label: "Meta por categoria", navigationType: "detail", parentId: "metas", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "meta-conjunta-detalhe", path: "/app/metas-conjuntas/:id", label: "Meta conjunta", navigationType: "detail", parentId: "metas-conjuntas", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "relatorio-detalhe", path: "/app/relatorios/:id", label: "Relatório", navigationType: "detail", parentId: "relatorios", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "divisao-nova", path: "/app/divisao-do-role/nova", label: "Nova divisão", navigationType: "detail", parentId: "divisao-do-role", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "divisao-detalhe", path: "/app/divisao-do-role/:id", label: "Divisão", navigationType: "detail", parentId: "divisao-do-role", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "divisao-editar", path: "/app/divisao-do-role/:id/editar", label: "Editar divisão", navigationType: "detail", parentId: "divisao-do-role", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),

  // ---------- deep links e telas internas ----------
  e({ id: "alerta-detalhe", path: "/app/alertas/:dedupKey", label: "Alerta do Nino", navigationType: "deep_link", parentId: "nino", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "antecipacoes-detalhe", path: "/app/antecipacoes/detalhe", label: "Prepare-se", navigationType: "deep_link", parentId: "nino", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "assessor", path: "/app/assessor", label: "Assessor", navigationType: "internal", parentId: "nino", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "nino-hub", path: "/app/nino-hub", label: "Nino (hub)", navigationType: "internal", parentId: "nino", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "nino-contexto", path: "/app/nino-contexto", label: "Contexto do Nino", navigationType: "internal", parentId: "nino", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "whatsapp", path: "/app/whatsapp", label: "WhatsApp", navigationType: "internal", parentId: "perfil", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),

  // ---------- redirecionamentos legados ----------
  e({ id: "relatorios-legado", path: "/app/relatorios-inteligentes", label: "Relatórios (legado)", navigationType: "legacy_redirect", parentId: "relatorios", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "relatorios-legado-detalhe", path: "/app/relatorios-inteligentes/:id", label: "Relatório (legado)", navigationType: "legacy_redirect", parentId: "relatorios", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "assessor-acompanhamento-legado", path: "/app/assessor/acompanhamento", label: "Acompanhamento (legado)", navigationType: "legacy_redirect", parentId: "nino", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
  e({ id: "antecipacoes-legado", path: "/app/antecipacoes", label: "Antecipações (legado)", navigationType: "legacy_redirect", parentId: "nino", mobilePlacement: "none", desktopPlacement: "none", featureStatus: "active" }),
];

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  principal: "Principal",
  organizar: "Organizar",
  entender: "Entender",
  conta: "Conta",
};

export function entryById(id: string): NavEntry | undefined {
  return APP_NAVIGATION.find((entry) => entry.id === id);
}

/** Itens do bottom tab (ordem de declaração). */
export const MOBILE_TABS = APP_NAVIGATION.filter((entry) => entry.mobilePlacement === "tab");

/** Itens do menu Mais, agrupados. */
export function moreGroups(): Array<{ group: NavGroup; label: string; items: NavEntry[] }> {
  const order: NavGroup[] = ["organizar", "entender", "conta"];
  return order
    .map((group) => ({
      group,
      label: NAV_GROUP_LABELS[group],
      items: APP_NAVIGATION.filter((entry) => entry.mobilePlacement === "more" && entry.group === group),
    }))
    .filter((g) => g.items.length > 0);
}

/** Grupos do sidebar desktop — nada de funcionalidade sem acesso no desktop. */
export function desktopGroups(): Array<{ group: NavGroup; label: string; items: NavEntry[] }> {
  const order: NavGroup[] = ["principal", "organizar", "entender", "conta"];
  return order
    .map((group) => ({
      group,
      label: NAV_GROUP_LABELS[group],
      items: APP_NAVIGATION.filter((entry) => entry.desktopPlacement === "sidebar" && entry.group === group),
    }))
    .filter((g) => g.items.length > 0);
}

function prefixesFor(entry: NavEntry): string[] {
  return entry.activePaths && entry.activePaths.length ? entry.activePaths : [entry.path];
}

function matches(pathname: string, prefix: string): boolean {
  if (prefix === "/app") return pathname === "/app";
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/**
 * Entrada de navegação correspondente à rota atual — sem lista manual de
 * subrotas em nenhum componente. Escolhe o prefixo mais específico e sobe
 * para o pai quando a rota é detalhe/deep link/interna.
 */
export function resolveActiveEntry(pathname: string): NavEntry | undefined {
  let best: { entry: NavEntry; len: number } | null = null;
  for (const entry of APP_NAVIGATION) {
    for (const prefix of prefixesFor(entry)) {
      if (matches(pathname, prefix) && (!best || prefix.length > best.len)) {
        best = { entry, len: prefix.length };
      }
    }
  }
  if (!best) return undefined;
  let entry = best.entry;
  const seen = new Set<string>();
  while (entry.parentId && !seen.has(entry.id)) {
    seen.add(entry.id);
    const parent = entryById(entry.parentId);
    if (!parent) break;
    entry = parent;
  }
  return entry;
}

/** Qual aba do mobile fica acesa para a rota atual (`mais` é o fallback). */
export function activeMobileTabId(pathname: string): string | undefined {
  const active = resolveActiveEntry(pathname);
  if (!active) return undefined;
  if (active.mobilePlacement === "tab") return active.id;
  if (active.mobilePlacement === "more") return "mais";
  return undefined;
}
