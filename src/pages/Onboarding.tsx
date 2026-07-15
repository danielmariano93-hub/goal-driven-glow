import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Wallet, ArrowRight, ArrowLeft } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  incomeFrequencyValues,
  type IncomeFrequency,
} from "@/lib/validation/onboarding";
import { displayNameSchema } from "@/lib/validation/auth";

const FREQUENCY_LABEL: Record<IncomeFrequency, string> = {
  mensal: "Mensal",
  quinzenal: "Quinzenal",
  semanal: "Semanal",
  variavel: "Variável",
};

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, profile, refreshProfile, loading } = useAuth();

  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState("");
  const [income, setIncome] = useState<string>("");
  const [frequency, setFrequency] = useState<IncomeFrequency>("mensal");
  const [incomeDay, setIncomeDay] = useState<string>("5");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name);
  }, [profile]);

  useEffect(() => {
    if (!loading && profile?.onboarding_completed_at) {
      navigate("/app", { replace: true });
    }
  }, [loading, profile, navigate]);

  async function finish() {
    if (!user) return;
    setError(null);

    const nameParsed = displayNameSchema.safeParse(displayName);
    if (!nameParsed.success) {
      setError(nameParsed.error.issues[0]?.message ?? "Nome inválido");
      setStep(1);
      return;
    }

    setSaving(true);

    const incomeNum = income.trim() === "" ? null : Number(income.replace(",", "."));
    if (incomeNum !== null && (isNaN(incomeNum) || incomeNum < 0)) {
      setError("Renda inválida");
      setSaving(false);
      setStep(2);
      return;
    }
    const dayNum = incomeDay.trim() === "" ? null : Number(incomeDay);

    const { error: pErr } = await supabase
      .from("profiles")
      .update({
        display_name: nameParsed.data,
        onboarding_completed_at: new Date().toISOString(),
        timezone: "America/Sao_Paulo",
        currency: "BRL",
      })
      .eq("id", user.id);

    if (pErr) {
      setError("Não foi possível salvar seu perfil. Tente novamente.");
      setSaving(false);
      return;
    }

    const { error: sErr } = await supabase
      .from("user_financial_settings")
      .upsert(
        {
          user_id: user.id,
          approximate_monthly_income: incomeNum,
          income_frequency: frequency,
          income_day: dayNum,
          timezone: "America/Sao_Paulo",
          currency: "BRL",
        },
        { onConflict: "user_id" }
      );

    if (sErr) {
      setError("Não foi possível salvar suas configurações. Tente novamente.");
      setSaving(false);
      return;
    }

    await refreshProfile();
    setSaving(false);
    navigate("/app", { replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 md:px-8">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-brand text-white shadow-brand">
            <Wallet size={18} />
          </span>
          <span className="font-display text-lg font-bold tracking-tight">
            NoControle<span className="text-gradient-brand">.ia</span>
          </span>
        </div>
        <span className="text-xs text-muted-foreground">Passo {step} de 3</span>
      </header>

      <main className="mx-auto max-w-md px-4 pb-16 pt-4 md:pt-10">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-card md:p-8">
          {step === 1 && (
            <>
              <h1 className="font-display text-2xl font-bold tracking-tight">
                Como podemos te chamar?
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Vamos usar seu nome nas conversas e nos indicadores.
              </p>
              <div className="mt-6">
                <label htmlFor="name" className="mb-1.5 block text-xs font-medium">
                  Nome de exibição
                </label>
                <input
                  id="name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoFocus
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm"
                />
              </div>
              {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    const parsed = displayNameSchema.safeParse(displayName);
                    if (!parsed.success) {
                      setError(parsed.error.issues[0]?.message ?? "Nome inválido");
                      return;
                    }
                    setError(null);
                    setStep(2);
                  }}
                  className="btn-brand inline-flex items-center gap-2"
                >
                  Continuar <ArrowRight size={14} />
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="font-display text-2xl font-bold tracking-tight">
                Como é sua renda?
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Uma estimativa já ajuda o assistente. Você pode ajustar depois.
              </p>

              <div className="mt-6 space-y-4">
                <div>
                  <label htmlFor="income" className="mb-1.5 block text-xs font-medium">
                    Renda mensal aproximada (R$) — opcional
                  </label>
                  <input
                    id="income"
                    type="text"
                    inputMode="decimal"
                    value={income}
                    onChange={(e) => setIncome(e.target.value)}
                    placeholder="0,00"
                    className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium">
                    Frequência de recebimento
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {incomeFrequencyValues.map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFrequency(f)}
                        className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                          frequency === f
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border bg-background text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {FREQUENCY_LABEL[f]}
                      </button>
                    ))}
                  </div>
                </div>

                {frequency !== "variavel" && (
                  <div>
                    <label htmlFor="day" className="mb-1.5 block text-xs font-medium">
                      Dia habitual de recebimento (1 a 31) — opcional
                    </label>
                    <input
                      id="day"
                      type="number"
                      min={1}
                      max={31}
                      value={incomeDay}
                      onChange={(e) => setIncomeDay(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm"
                    />
                  </div>
                )}
              </div>

              {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
              <div className="mt-6 flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft size={14} /> Voltar
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="btn-brand inline-flex items-center gap-2"
                >
                  Continuar <ArrowRight size={14} />
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="font-display text-2xl font-bold tracking-tight">
                Últimos detalhes
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Confirme seu fuso horário e moeda. Você pode alterar depois em Perfil.
              </p>
              <dl className="mt-6 divide-y divide-border rounded-xl border border-border">
                <div className="flex justify-between px-4 py-3 text-sm">
                  <dt className="text-muted-foreground">Fuso horário</dt>
                  <dd className="font-medium">America/Sao_Paulo</dd>
                </div>
                <div className="flex justify-between px-4 py-3 text-sm">
                  <dt className="text-muted-foreground">Moeda</dt>
                  <dd className="font-medium">BRL — Real</dd>
                </div>
              </dl>
              {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
              <div className="mt-6 flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft size={14} /> Voltar
                </button>
                <button
                  type="button"
                  onClick={finish}
                  disabled={saving}
                  className="btn-brand inline-flex items-center gap-2"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Concluir"}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
