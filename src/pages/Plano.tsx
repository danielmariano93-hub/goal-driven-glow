import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Sparkle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlan } from "@/hooks/usePlan";

type BillingPlan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  billing_interval: "month" | "year" | "free";
  trial_days: number;
  highlights: string[] | null;
};

const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const intervalLabel: Record<string, string> = { month: "/mês", year: "/ano", free: "" };

export default function Plano() {
  const { plan, loading: planLoading } = usePlan();

  const { data: plans, isLoading } = useQuery({
    queryKey: ["billing-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("billing_plans" as any)
        .select("id,code,name,description,price_cents,currency,billing_interval,trial_days,highlights")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as BillingPlan[];
    },
  });

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">Seu plano</h1>
        <p className="text-sm text-muted-foreground">O que está incluído hoje e o que vem por aí.</p>
      </header>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
        <p className="text-xs text-muted-foreground">Plano atual</p>
        {planLoading ? (
          <Loader2 className="mt-2 h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <p className="mt-1 font-display text-lg font-semibold">{plan.plan_name}</p>
            {plan.current_period_end && (
              <p className="mt-1 text-xs text-muted-foreground">
                Válido até {new Date(plan.current_period_end).toLocaleDateString("pt-BR")}
              </p>
            )}
            {!plan.is_paid && (
              <p className="mt-1 text-xs text-muted-foreground">
                Você está usando o Meu Nino sem custo. Nenhuma cobrança está ativa.
              </p>
            )}
          </>
        )}
      </div>

      <div className="mt-6 space-y-3">
        {isLoading && (
          <div className="grid place-items-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {plans?.map((p) => {
          const current = p.code === plan.plan_code;
          return (
            <div
              key={p.id}
              className={`rounded-2xl border bg-card p-4 shadow-card md:p-6 ${current ? "border-primary" : "border-border"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-base font-semibold">{p.name}</p>
                  {p.description && <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-lg font-semibold">
                    {p.price_cents === 0 ? "Grátis" : brl(p.price_cents)}
                  </p>
                  {p.price_cents > 0 && (
                    <p className="text-[11px] text-muted-foreground">{intervalLabel[p.billing_interval] ?? ""}</p>
                  )}
                </div>
              </div>

              {p.highlights?.length ? (
                <ul className="mt-3 space-y-1.5">
                  {p.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2 text-xs">
                      <Check size={14} className="mt-0.5 shrink-0 text-primary" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-4">
                {current ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs">
                    <Check size={13} /> Plano atual
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled
                    title="A contratação será liberada quando a assinatura entrar no ar"
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground opacity-50"
                  >
                    <Sparkle size={13} /> Em breve
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-[11px] text-muted-foreground">
        Quando os planos pagos entrarem no ar, a contratação feita pelo aplicativo será processada pela loja
        correspondente e o cancelamento acontece na sua conta da loja. Detalhes em{" "}
        <a href="/termos" className="underline">
          Termos de Uso
        </a>
        .
      </p>
    </div>
  );
}
