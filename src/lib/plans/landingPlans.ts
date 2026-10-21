import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Vitrine de planos da landing. O conteúdo vem do banco (editável no admin);
// DEFAULT_PLANS é o espelho do conteúdo inicial, usado enquanto carrega ou se a leitura falhar.
// Nada aqui libera ou bloqueia funcionalidade: é só vitrine e medição de interesse.

export type FeatureValue = "yes" | "limited" | "no";

export interface PlanFeature {
  key: string;
  label: string;
  description: string | null;
  value: FeatureValue;
  note: string | null;
}

export interface LandingPlan {
  slug: string;
  name: string;
  tagline: string | null;
  price_monthly: number | null;
  price_yearly: number | null;
  availability: "available" | "coming_soon";
  cta_label: string;
  badge: string | null;
  highlighted: boolean;
  features: PlanFeature[];
}

const F = (key: string, label: string, description: string, values: [FeatureValue, string?][]): [string, string, string, [FeatureValue, string?][]] => [key, label, description, values];
const CATALOG = [
  F("lancamentos", "Lançamentos, contas e cartões", "Registre e organize tudo à mão", [["yes"], ["yes"], ["yes"]]),
  F("categorias", "Categorias e relatórios", "Veja para onde o dinheiro vai", [["yes"], ["yes"], ["yes"]]),
  F("metas", "Metas de gasto por categoria", "Teto por categoria com ritmo do mês", [["limited", "até 3 metas"], ["yes"], ["yes"]]),
  F("nino_app", "Nino no app", "Converse e tire dúvidas sobre o seu mês", [["limited", "limite diário"], ["yes"], ["yes"]]),
  F("whatsapp", "Nino no WhatsApp", "Registre por texto, áudio ou foto", [["no"], ["yes"], ["yes"]]),
  F("assessor", "Importar extrato e fatura", "PDF, OFX e foto, com revisão antes de lançar", [["no"], ["yes"], ["yes"]]),
  F("proativo", "Alertas e insights do Nino", "Avisos antes de o mês apertar", [["limited", "resumo básico"], ["yes"], ["yes"]]),
  F("mapa", "Mapa Financeiro", "Leitura completa da sua saúde financeira", [["limited", "resumo"], ["yes"], ["yes"]]),
  F("habitos", "Hábitos e ajuste de metas avaliado", "O Nino diz se o ajuste valeu a pena", [["no"], ["yes"], ["yes"]]),
  F("role", "Divisão do rolê", "Divida contas e cobre com lembretes", [["limited", "1 rolê por mês"], ["yes"], ["yes"]]),
  F("open_finance", "Bancos conectados (Open Finance)", "Conecte seus bancos direto", [["no"], ["no"], ["yes"]]),
  F("sync_auto", "Sincronização automática", "Atualiza sozinho, todo dia", [["no"], ["no"], ["yes"]]),
];
const features = (i: number): PlanFeature[] => CATALOG.map(([key, label, description, v]) => ({ key, label, description, value: v[i][0], note: v[i][1] ?? null }));

export const DEFAULT_PLANS: LandingPlan[] = [
  { slug: "gratis", name: "Grátis", tagline: "Para começar a organizar", price_monthly: 0, price_yearly: null, availability: "available", cta_label: "Quero meu Nino grátis", badge: null, highlighted: false, features: features(0) },
  { slug: "nino", name: "Nino", tagline: "O Nino cuidando do seu dinheiro com você", price_monthly: 19.9, price_yearly: 179.9, availability: "available", cta_label: "Quero o Nino", badge: "Recomendado", highlighted: true, features: features(1) },
  { slug: "conecta", name: "Nino Conecta", tagline: "Tudo automático: conecte os bancos e esqueça", price_monthly: null, price_yearly: null, availability: "coming_soon", cta_label: "Entrar na lista de espera", badge: "Em breve", highlighted: false, features: features(2) },
];

export function useLandingPlans() {
  return useQuery<LandingPlan[]>({
    queryKey: ["landing-plans"],
    staleTime: 5 * 60_000,
    retry: 1,
    placeholderData: DEFAULT_PLANS,
    queryFn: async () => {
      // A vitrine nunca some: se a leitura falhar, mostra o conteúdo padrão.
      try {
        const { data, error } = await (supabase.rpc as any)("landing_plans_public");
        if (error) return DEFAULT_PLANS;
        const plans = (data as { plans?: LandingPlan[] } | null)?.plans;
        return plans && plans.length ? plans : DEFAULT_PLANS;
      } catch {
        return DEFAULT_PLANS;
      }
    },
  });
}

export function formatPlanPrice(value: number | null): string {
  if (value == null) return "";
  return value === 0 ? "R$ 0" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/** Economia do plano anual frente a 12 meses no mensal, em %. */
export function yearlySavingPct(plan: Pick<LandingPlan, "price_monthly" | "price_yearly">): number | null {
  if (!plan.price_monthly || !plan.price_yearly) return null;
  const pct = Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100);
  return pct > 0 ? pct : null;
}

// --- Medição de interesse -------------------------------------------------

export type PlanEvent = "view" | "click_cta" | "waitlist_open";

function sessionId(): string {
  try {
    const k = "nino_plan_session";
    let v = sessionStorage.getItem(k);
    if (!v) {
      v = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem(k, v);
    }
    return v;
  } catch {
    return "anon";
  }
}

export function trackPlanEvent(plan: string, event: PlanEvent): void {
  try {
    void (supabase.rpc as any)("plan_interest_track", { p_events: [{ plan, event, session: sessionId() }] });
  } catch {
    /* medição nunca atrapalha a página */
  }
}

export type PriceIntent = "ate_20" | "20_30" | "30_50" | "mais_50" | "nao_sei";
export const PRICE_INTENT_LABEL: Record<PriceIntent | "nao_informou", string> = {
  ate_20: "Até R$ 20", "20_30": "R$ 20 a 30", "30_50": "R$ 30 a 50", mais_50: "Mais de R$ 50", nao_sei: "Ainda não sei", nao_informou: "Não informou",
};

export type WaitlistResult = { ok: boolean; already?: boolean; error?: "invalid_email" | "consent_required" | "invalid_plan" | "busy" | "network" };

export async function joinPlanWaitlist(args: { plan: string; email: string; intent: PriceIntent | null; consent: boolean }): Promise<WaitlistResult> {
  try {
    const { data, error } = await (supabase.rpc as any)("plan_waitlist_join", {
      p_plan: args.plan, p_email: args.email, p_intent: args.intent, p_consent: args.consent,
    });
    if (error) return { ok: false, error: "network" };
    return data as WaitlistResult;
  } catch {
    return { ok: false, error: "network" };
  }
}
