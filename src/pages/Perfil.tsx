import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { displayNameSchema } from "@/lib/validation/auth";
import { incomeFrequencyValues, type IncomeFrequency } from "@/lib/validation/onboarding";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export default function Perfil() {
  const { user, profile, refreshProfile, requestPasswordReset } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(profile?.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (profile?.display_name) setName(profile.display_name);
  }, [profile]);

  const { data: settings } = useQuery({
    queryKey: ["ufs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("user_financial_settings").select("*").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [income, setIncome] = useState("");
  const [freq, setFreq] = useState<IncomeFrequency>("mensal");
  const [day, setDay] = useState("");

  useEffect(() => {
    if (settings) {
      setIncome(settings.approximate_monthly_income != null ? String(settings.approximate_monthly_income) : "");
      setFreq((settings.income_frequency as IncomeFrequency) ?? "mensal");
      setDay(settings.income_day != null ? String(settings.income_day) : "");
    }
  }, [settings]);

  async function saveAll(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const parsed = displayNameSchema.safeParse(name);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Nome inválido");
      return;
    }
    setSaving(true);
    const { error: pErr } = await supabase.from("profiles").update({ display_name: parsed.data }).eq("id", user.id);
    const { error: sErr } = await supabase.from("user_financial_settings").upsert(
      {
        user_id: user.id,
        approximate_monthly_income: income ? Number(income.replace(",", ".")) : null,
        income_frequency: freq,
        income_day: day ? Number(day) : null,
        timezone: "America/Sao_Paulo",
        currency: "BRL",
      },
      { onConflict: "user_id" }
    );
    setSaving(false);
    if (pErr || sErr) {
      toast.error("Não foi possível salvar");
      return;
    }
    await refreshProfile();
    qc.invalidateQueries({ queryKey: ["ufs"] });
    toast.success("Perfil atualizado");
  }

  async function sendReset() {
    if (!user?.email) return;
    setResetting(true);
    const { error } = await requestPasswordReset(user.email);
    setResetting(false);
    if (error) toast.error(error);
    else toast.success("Enviamos um link para seu e-mail");
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">Perfil</h1>
        <p className="text-sm text-muted-foreground">Suas informações e preferências.</p>
      </header>

      <form onSubmit={saveAll} className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
        <div>
          <label className="mb-1 block text-xs font-medium">E-mail</label>
          <input value={user?.email ?? ""} disabled className="input-base opacity-70" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Nome de exibição</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input-base" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium">Renda mensal aproximada (R$)</label>
            <input inputMode="decimal" value={income} onChange={(e) => setIncome(e.target.value)} className="input-base" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Frequência</label>
            <select value={freq} onChange={(e) => setFreq(e.target.value as IncomeFrequency)} className="input-base">
              {incomeFrequencyValues.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>
        {freq !== "variavel" && (
          <div>
            <label className="mb-1 block text-xs font-medium">Dia de recebimento (1 a 31)</label>
            <input type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} className="input-base" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border bg-background p-3 text-xs">
            <p className="text-muted-foreground">Fuso horário</p>
            <p className="mt-0.5 font-medium">America/Sao_Paulo</p>
          </div>
          <div className="rounded-xl border border-border bg-background p-3 text-xs">
            <p className="text-muted-foreground">Moeda</p>
            <p className="mt-0.5 font-medium">BRL</p>
          </div>
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save size={14} /> Salvar</>}
          </button>
        </div>
      </form>

      <div className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
        <h2 className="text-sm font-semibold">Segurança</h2>
        <p className="mt-1 text-xs text-muted-foreground">Alteramos sua senha por link seguro enviado ao seu e-mail.</p>
        <button
          type="button"
          onClick={sendReset}
          disabled={resetting}
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium"
        >
          {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar link de alteração de senha"}
        </button>
      </div>

      <NotificationPrefs />
      <DataZone />
    </div>
  );
}

function NotificationPrefs() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<any | null>(null);
  useEffect(() => {
    if (!user) return;
    supabase.from("notification_preferences" as any).select("*").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setPrefs(data ?? {}));
  }, [user]);
  const keys = ["agent_confirmation", "recurrence_due", "goal_reached", "split_reminder", "import_done", "achievement", "system"] as const;
  const labels: Record<string, string> = {
    agent_confirmation: "Confirmações do agente",
    recurrence_due: "Recorrências próximas",
    goal_reached: "Metas atingidas",
    split_reminder: "Lembretes de Divisão do Rolê",
    import_done: "Importações concluídas",
    achievement: "Conquistas",
    system: "Avisos do sistema",
  };
  const save = async (k: string, v: boolean) => {
    if (!user) return;
    const next = { ...prefs, [k]: v, user_id: user.id };
    setPrefs(next);
    const { error } = await supabase.from("notification_preferences" as any).upsert(next, { onConflict: "user_id" });
    if (error) toast.error(error.message);
  };
  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
      <h2 className="text-sm font-semibold">Preferências de notificação</h2>
      <div className="mt-3 space-y-2">
        {keys.map((k) => (
          <label key={k} className="flex items-center justify-between text-xs">
            <span>{labels[k]}</span>
            <input
              type="checkbox"
              checked={prefs?.[k] ?? true}
              onChange={(e) => save(k, e.target.checked)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function DataZone() {
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const doExport = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("user_export_data" as any);
    setBusy(false);
    if (error) return toast.error(error.message);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `nocontrole_export_${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Exportação pronta");
  };

  const requestDeletion = async () => {
    if (confirmText !== "EXCLUIR MINHA CONTA") {
      return toast.error('Digite exatamente "EXCLUIR MINHA CONTA" para confirmar');
    }
    setBusy(true);
    const { error } = await supabase.rpc("user_request_deletion" as any, { p_reason: null });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Solicitação registrada. Nossa equipe processará em breve.");
    setConfirmText("");
  };

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
      <h2 className="text-sm font-semibold">Meus dados</h2>
      <p className="mt-1 text-xs text-muted-foreground">Exporte tudo em JSON ou solicite exclusão.</p>
      <button onClick={doExport} disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium disabled:opacity-50">
        Exportar meus dados
      </button>
      <div className="mt-6 pt-4 border-t border-border">
        <p className="text-xs font-medium text-destructive">Zona de risco</p>
        <p className="text-[11px] text-muted-foreground mt-1">
          A exclusão remove permanentemente todos os seus dados. Só mantemos logs mínimos legalmente exigidos, anonimizados.
        </p>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder='Digite: EXCLUIR MINHA CONTA'
          className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          onClick={requestDeletion}
          disabled={busy || confirmText !== "EXCLUIR MINHA CONTA"}
          className="mt-2 rounded-full bg-destructive text-destructive-foreground px-4 py-2 text-sm disabled:opacity-40"
        >
          Solicitar exclusão da conta
        </button>
      </div>
    </div>
  );
}
