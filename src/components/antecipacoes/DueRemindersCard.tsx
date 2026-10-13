import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Prefs = { due_reminders_enabled: boolean; due_reminders_days: number[]; due_reminders_hour: number; due_reminders_consent_at: string | null };

const DEFAULTS: Prefs = { due_reminders_enabled: true, due_reminders_days: [1, 0], due_reminders_hour: 9, due_reminders_consent_at: null };
const DAY_OPTIONS = [
  { value: 0, label: "No dia" },
  { value: 1, label: "1 dia antes" },
  { value: 3, label: "3 dias antes" },
];
const HOURS = [7, 8, 9, 10, 12, 14, 18];

/**
 * Lembrete de vencimento no WhatsApp: opt-in explícito. Uma única mensagem por dia com o que vence
 * (fatura, parcela, conta recorrente), lida da agenda de compromissos.
 */
export default function DueRemindersCard() {
  const queryClient = useQueryClient();
  const [local, setLocal] = useState<Prefs>(DEFAULTS);

  const query = useQuery({
    queryKey: ["due-reminder-prefs"],
    queryFn: async (): Promise<Prefs> => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return DEFAULTS;
      const { data, error } = await supabase.from("notification_preferences")
        .select("due_reminders_enabled,due_reminders_days,due_reminders_hour,due_reminders_consent_at")
        .eq("user_id", uid).maybeSingle();
      if (error) throw new Error(error.message);
      return { ...DEFAULTS, ...((data as Partial<Prefs> | null) ?? {}) };
    },
  });
  useEffect(() => { if (query.data) setLocal(query.data); }, [query.data]);

  const save = useMutation({
    mutationFn: async (patch: Partial<Prefs>) => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Sessão expirada. Entre novamente para salvar.");
      const next: Record<string, unknown> = { user_id: uid, ...patch };
      if (patch.due_reminders_enabled === true) next.due_reminders_consent_at = new Date().toISOString();
      if (patch.due_reminders_enabled === false) next.due_reminders_consent_at = null;
      const { error } = await supabase.from("notification_preferences").upsert(next as never, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["due-reminder-prefs"] }); toast.success("Lembretes de vencimento salvos."); },
    onError: (error: Error) => toast.error(error.message || "Não foi possível salvar agora."),
  });

  const update = (patch: Partial<Prefs>) => { setLocal((prev) => ({ ...prev, ...patch })); save.mutate(patch); };
  const toggleDay = (value: number) => {
    const has = local.due_reminders_days.includes(value);
    const next = has ? local.due_reminders_days.filter((d) => d !== value) : [...local.due_reminders_days, value];
    if (next.length === 0) return; // sempre pelo menos uma antecedência
    update({ due_reminders_days: next.sort((a, b) => b - a) });
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6" aria-label="Lembretes de vencimento">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Lembretes de vencimento no WhatsApp</h2>
        {(query.isLoading || save.isPending) && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <label className="mt-4 flex items-start justify-between gap-3">
        <span className="text-sm">
          Avisar quando uma conta estiver para vencer
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {local.due_reminders_consent_at
              ? `Ligado em ${new Date(local.due_reminders_consent_at).toLocaleDateString("pt-BR")}. Uma mensagem por dia, só quando houver o que vencer.`
              : "Faturas, parcelas e contas da sua agenda de compromissos. Uma mensagem por dia, só quando houver o que vencer. Você pode desligar quando quiser."}
          </span>
        </span>
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" checked={local.due_reminders_enabled}
          onChange={(e) => update({ due_reminders_enabled: e.target.checked })} aria-label="Receber lembretes de vencimento" />
      </label>

      {local.due_reminders_enabled ? (
        <div className="mt-4 space-y-3">
          <fieldset>
            <legend className="text-xs font-semibold text-muted-foreground">Quando avisar</legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {DAY_OPTIONS.map((o) => {
                const on = local.due_reminders_days.includes(o.value);
                return (
                  <button key={o.value} type="button" aria-pressed={on} onClick={() => toggleDay(o.value)}
                    className={`min-h-10 rounded-full border px-3 text-xs font-medium ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                    {o.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className="flex items-center justify-between gap-3 text-sm">
            Horário do aviso
            <select value={local.due_reminders_hour} onChange={(e) => update({ due_reminders_hour: Number(e.target.value) })}
              className="min-h-10 rounded-lg border border-border bg-background px-2 text-sm">
              {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
          </label>
        </div>
      ) : null}
    </section>
  );
}
