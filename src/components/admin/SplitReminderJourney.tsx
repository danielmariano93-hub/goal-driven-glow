import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callAdminRpc } from "@/lib/admin/adminRpc";
import type { SplitReminderPolicy } from "@/lib/admin/ninoContracts";
import { adminToast } from "@/components/admin/adminToast";
import { Switch } from "@/components/ui/switch";

const DEFAULTS: SplitReminderPolicy = { enabled: true, due_soon_days_before: 0, due_today_enabled: true, first_overdue_days: 1, repeat_every_days: 1, max_overdue_reminders: 1, send_hour: 9, pause_on_reply: true };

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
  return <section className="space-y-5 rounded-lg border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-lg font-bold">Lembretes da divisão do rolê</h2><p className="text-sm text-muted-foreground">Uma cobrança no vencimento e uma última no dia seguinte. Pagou, respondeu ou saiu? A jornada para.</p></div><Button onClick={save}><Save size={14} />Salvar</Button></div>
    <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
      <JourneyStep icon={CalendarClock} eyebrow="1º envio" title="No vencimento" text={`Às ${String(policy.send_hour).padStart(2, "0")}:00`} />
      <div className="hidden h-px w-10 bg-border md:block" />
      <JourneyStep icon={CheckCircle2} eyebrow="Último envio" title="1 dia depois" text={`Às ${String(policy.send_hour).padStart(2, "0")}:00 · sem novas cobranças`} />
    </div>
    <div className="grid gap-4 border-t pt-4 sm:grid-cols-3">
      <Setting label="Jornada ativa" description="Agenda os dois lembretes."><Switch checked={policy.enabled} onCheckedChange={enabled => setPolicy({ ...policy, enabled })} /></Setting>
      <label className="space-y-1 text-xs font-medium">Horário de envio<Input type="number" min={0} max={23} value={policy.send_hour} onChange={e => setPolicy({ ...policy, send_hour: Number(e.target.value) })} /><span className="block font-normal text-muted-foreground">Horário de Brasília, de 0 a 23.</span></label>
      <Setting label="Pausar após resposta" description="Evita insistir após retorno."><Switch checked={policy.pause_on_reply} onCheckedChange={pause_on_reply => setPolicy({ ...policy, pause_on_reply })} /></Setting>
    </div>
  </section>;
}

function JourneyStep({ icon: Icon, eyebrow, title, text }: { icon: typeof CalendarClock; eyebrow: string; title: string; text: string }) {
  return <div className="rounded-lg border bg-background p-4"><div className="flex items-center gap-2 text-primary"><Icon size={18} /><span className="text-xs font-semibold uppercase">{eyebrow}</span></div><p className="mt-3 text-base font-semibold">{title}</p><p className="mt-1 text-xs text-muted-foreground">{text}</p></div>;
}

function Setting({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground">{description}</p></div>{children}</div>;
}
