import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { displayNameSchema } from "@/lib/validation/auth";
import { incomeFrequencyValues, type IncomeFrequency } from "@/lib/validation/onboarding";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WhatsAppLinkSheet } from "@/components/whatsapp/WhatsAppLinkSheet";

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

      <WhatsAppConnection />
      <NotificationPrefs />
      <DataZone />
    </div>
  );
}

function WhatsAppConnection() {
  const [link, setLink] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase.rpc("list_my_whatsapp_link");
    const row = (data?.[0] as any) ?? null;
    setLink(row?.status === "active" ? row : null);
  };
  useEffect(() => { load(); }, []);

  const revoke = async () => {
    if (!confirm("Desvincular seu WhatsApp? Você poderá vincular novamente depois.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("revoke_whatsapp_link");
    setBusy(false);
    if (error) return toast.error("Não consegui desvincular.");
    toast.success("Vínculo revogado.");
    setLink(null);
  };

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
      <h2 className="text-sm font-semibold">Conexões</h2>
      <p className="mt-1 text-xs text-muted-foreground">Onde seu assistente pode te encontrar.</p>
      <div className="mt-3 flex items-center justify-between rounded-xl border border-border bg-background p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">WhatsApp</p>
          <p className="text-[11px] text-muted-foreground">
            {link ? `Vinculado · ${link.phone_masked}` : "Não vinculado"}
          </p>
        </div>
        {link ? (
          <button
            onClick={revoke}
            disabled={busy}
            className="rounded-full border border-border px-3 py-1.5 text-xs disabled:opacity-40"
          >
            Desvincular
          </button>
        ) : (
          <button
            onClick={() => setSheetOpen(true)}
            className="rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground"
          >
            Vincular
          </button>
        )}
      </div>
      <WhatsAppLinkSheet open={sheetOpen} onClose={() => { setSheetOpen(false); load(); }} />
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
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [request, setRequest] = useState<any | null>(null);

  const loadRequest = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("account_deletion_requests" as any)
      .select("id,status,requested_at,grace_period_ends_at,admin_notes,cancelled_at,processed_at")
      .eq("user_id", user.id)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRequest(data ?? null);
  };
  useEffect(() => { loadRequest(); /* eslint-disable-next-line */ }, [user]);

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
    toast.success("Solicitação registrada. Você poderá acompanhar o status abaixo.");
    setConfirmText("");
    await loadRequest();
  };

  const cancelDeletion = async () => {
    if (!request?.id) return;
    setBusy(true);
    const { error } = await supabase.rpc("user_cancel_deletion_request" as any, { p_id: request.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Solicitação cancelada");
    await loadRequest();
  };

  const statusLabels: Record<string, string> = {
    pending: "Pendente — aguardando análise",
    approved: "Aprovada — em período de carência",
    processing: "Em processamento",
    completed: "Concluída",
    rejected: "Recusada",
    cancelled: "Cancelada por você",
  };

  const activeRequest = request && ["pending","approved","processing"].includes(request.status);

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
      <h2 className="text-sm font-semibold">Meus dados</h2>
      <p className="mt-1 text-xs text-muted-foreground">Exporte tudo em JSON ou solicite exclusão da sua conta.</p>
      <button onClick={doExport} disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium disabled:opacity-50">
        Exportar meus dados
      </button>
      <div className="mt-6 pt-4 border-t border-border">
        <p className="text-xs font-medium text-destructive">Zona de risco</p>
        <p className="text-[11px] text-muted-foreground mt-1">
          A exclusão passa por análise. Após aprovação, há um período de carência antes da remoção definitiva.
        </p>

        {activeRequest && (
          <div className="mt-3 rounded-xl border border-border bg-background p-3 text-xs space-y-1">
            <p><span className="text-muted-foreground">Status:</span> {statusLabels[request.status] ?? request.status}</p>
            <p><span className="text-muted-foreground">Solicitada em:</span> {new Date(request.requested_at).toLocaleString("pt-BR")}</p>
            {request.grace_period_ends_at && (
              <p><span className="text-muted-foreground">Fim da carência:</span> {new Date(request.grace_period_ends_at).toLocaleString("pt-BR")}</p>
            )}
            {request.status === "pending" && (
              <button onClick={cancelDeletion} disabled={busy}
                className="mt-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs disabled:opacity-40">
                Cancelar solicitação
              </button>
            )}
          </div>
        )}

        {request && !activeRequest && (
          <div className="mt-3 text-[11px] text-muted-foreground">
            Última solicitação: {statusLabels[request.status] ?? request.status}
            {request.processed_at ? ` em ${new Date(request.processed_at).toLocaleDateString("pt-BR")}` : ""}
            {request.admin_notes ? ` — ${request.admin_notes}` : ""}
          </div>
        )}

        {!activeRequest && (
          <>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder='Digite: EXCLUIR MINHA CONTA'
              className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              onClick={requestDeletion}
              disabled={busy || confirmText !== "EXCLUIR MINHA CONTA"}
              className="mt-2 rounded-full bg-destructive text-destructive-foreground px-4 py-2 text-sm disabled:opacity-40"
            >
              Solicitar exclusão da conta
            </button>
          </>
        )}
      </div>
    </div>
  );
}
