import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, MessageCircle, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import type { SplitReminderPolicy } from "@/lib/admin/ninoContracts";
import { adminToast } from "@/components/admin/adminToast";

const DEFAULTS: SplitReminderPolicy = { enabled: true, due_soon_days_before: 1, due_today_enabled: true, first_overdue_days: 1, repeat_every_days: 3, max_overdue_reminders: 3, send_hour: 9, pause_on_reply: true };

export function SplitReminderJourney() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["split-reminder-policy"], queryFn: () => callAdminRpc<SplitReminderPolicy>("admin_split_reminder_policy") });
  const [policy, setPolicy] = useState(DEFAULTS);
  useEffect(() => { if (q.data) setPolicy(q.data); }, [q.data]);
  async function save() {
    try {
      await callAdminRpc("admin_split_reminder_policy_update", {
        _enabled: policy.enabled, _due_soon_days_before: policy.due_soon_days_before,
        _due_today_enabled: policy.due_today_enabled, _first_overdue_days: policy.first_overdue_days,
        _repeat_every_days: policy.repeat_every_days, _max_overdue_reminders: policy.max_overdue_reminders,
        _send_hour: policy.send_hour, _pause_on_reply: policy.pause_on_reply,
      });
      await qc.invalidateQueries({ queryKey: ["split-reminder-policy"] });
      adminToast.success("Régua do rolê atualizada");
    } catch (e) { adminToast.fromError(e, "Não foi possível salvar a régua"); }
  }
  const field = (key: keyof SplitReminderPolicy, label: string, min: number, max: number) => <label className="text-xs text-muted-foreground">{label}<Input type="number" min={min} max={max} value={Number(policy[key])} onChange={e => setPolicy({ ...policy, [key]: Number(e.target.value) })} /></label>;
  return <section className="rounded-3xl border bg-card p-5 space-y-5">
    <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-display text-lg font-bold">Cobrança da divisão do rolê</h2><p className="text-sm text-muted-foreground">Edite a régua sem mexer em regras técnicas. Pagamentos reconhecidos encerram os lembretes.</p></div><Button onClick={save}><Save size={14} />Salvar jornada</Button></div>
    <div className="grid gap-3 md:grid-cols-4">
      <JourneyStep icon={MessageCircle} title="Evento criado" text="Convite leve com valor, vencimento e forma de pagamento." />
      <JourneyStep icon={CalendarClock} title={`${policy.due_soon_days_before} dia(s) antes`} text={`Lembrete às ${policy.send_hour}h.`} />
      <JourneyStep icon={CalendarClock} title="No vencimento" text={policy.due_today_enabled ? "Mensagem ativa" : "Etapa pausada"} />
      <JourneyStep icon={CheckCircle2} title="Após o vencimento" text={`${policy.max_overdue_reminders} tentativa(s), a cada ${policy.repeat_every_days} dia(s).`} />
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {field("due_soon_days_before", "Dias antes", 0, 30)}
      {field("first_overdue_days", "Primeiro atraso (dias)", 1, 30)}
      {field("repeat_every_days", "Repetir a cada (dias)", 1, 30)}
      {field("max_overdue_reminders", "Máximo de cobranças", 0, 10)}
      {field("send_hour", "Horário de envio", 0, 23)}
    </div>
    <div className="flex flex-wrap gap-5 text-sm">
      <label><input type="checkbox" checked={policy.enabled} onChange={e => setPolicy({ ...policy, enabled: e.target.checked })} /> Jornada ativa</label>
      <label><input type="checkbox" checked={policy.due_today_enabled} onChange={e => setPolicy({ ...policy, due_today_enabled: e.target.checked })} /> Lembrar no vencimento</label>
      <label><input type="checkbox" checked={policy.pause_on_reply} onChange={e => setPolicy({ ...policy, pause_on_reply: e.target.checked })} /> Pausar após resposta</label>
    </div>
  </section>;
}

function JourneyStep({ icon: Icon, title, text }: { icon: typeof MessageCircle; title: string; text: string }) {
  return <div className="rounded-2xl border bg-background p-4"><Icon size={18} className="text-primary" /><p className="mt-3 text-sm font-semibold">{title}</p><p className="mt-1 text-xs text-muted-foreground">{text}</p></div>;
}
