import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Bell, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/split/math";

export default function DivisaoDoRoleDetalhe() {
  const { id } = useParams();
  const nav = useNavigate();
  const [se, setSe] = useState<any>(null);
  const [parts, setParts] = useState<any[] | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: expense }, { data: participants }, { data: evs }] = await Promise.all([
      supabase.from("shared_expenses" as any).select("*").eq("id", id).single(),
      supabase.from("shared_expense_participants" as any).select("*").eq("shared_expense_id", id).order("created_at"),
      supabase.from("shared_expense_events" as any).select("*").eq("shared_expense_id", id).order("created_at", { ascending: false }).limit(20),
    ]);
    setSe(expense); setParts(participants ?? []); setEvents(evs ?? []);
  };

  useEffect(() => { load(); }, [id]);

  const totalPaid = parts?.reduce((s, p) => s + Number(p.amount_paid), 0) ?? 0;
  const totalDue = parts?.reduce((s, p) => s + Number(p.amount_due), 0) ?? 0;
  const pending = totalDue - totalPaid;

  const registerPayment = async (participantId: string, amount: number) => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("split_add_payment" as any, { p_participant_id: participantId, p_amount: amount });
      if (error) throw error;
      toast.success("Pagamento registrado");
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const reverse = async (participantId: string) => {
    if (!confirm("Desfazer todos os pagamentos deste participante?")) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("split_reverse_payment" as any, { p_participant_id: participantId });
      if (error) throw error;
      toast.success("Pagamento revertido");
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const sendReminders = async () => {
    if (!confirm("Enviar lembretes agora aos participantes pendentes?")) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("split_send_reminders" as any, { p_shared_expense_id: id });
      if (error) throw error;
      toast.success(`${data} lembrete(s) agendado(s)`);
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!se) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-5 pt-2">
      <button onClick={() => nav(-1)} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <ArrowLeft size={14} /> Voltar
      </button>
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{se.title}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">{new Date(se.occurred_at).toLocaleDateString("pt-BR")} · Status: {se.status}</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="surface-card p-3"><p className="text-[10px] text-muted-foreground">Total</p><p className="text-sm font-bold">{formatBRL(Number(se.total_amount))}</p></div>
        <div className="surface-card p-3"><p className="text-[10px] text-muted-foreground">Recebido</p><p className="text-sm font-bold text-success">{formatBRL(totalPaid)}</p></div>
        <div className="surface-card p-3"><p className="text-[10px] text-muted-foreground">Pendente</p><p className="text-sm font-bold text-destructive">{formatBRL(pending)}</p></div>
      </div>

      {se.reminder_enabled && (
        <button onClick={sendReminders} disabled={busy} className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50">
          <Bell size={14} /> Enviar lembretes agora
        </button>
      )}

      <div className="surface-card divide-y divide-border overflow-hidden">
        {parts?.map((p: any) => {
          const remaining = Number(p.amount_due) - Number(p.amount_paid);
          return (
            <div key={p.id} className="px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {p.phone_masked ?? "sem telefone"} · pagou {formatBRL(Number(p.amount_paid))} de {formatBRL(Number(p.amount_due))}
                  </p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${p.status === "paid" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                  {p.status}
                </span>
              </div>
              {p.status !== "paid" && (
                <div className="flex gap-2">
                  <button disabled={busy} onClick={() => registerPayment(p.id, remaining)} className="text-xs inline-flex items-center gap-1 rounded-full bg-success/15 text-success px-3 py-1">
                    <CheckCircle2 size={12} /> Marcar como pago ({formatBRL(remaining)})
                  </button>
                  <button disabled={busy} onClick={() => {
                    const v = prompt("Valor parcial (R$):"); if (!v) return;
                    const num = Number(v.replace(",", ".")); if (!(num > 0)) return;
                    registerPayment(p.id, num);
                  }} className="text-xs rounded-full border border-border px-3 py-1">Pagamento parcial</button>
                </div>
              )}
              {Number(p.amount_paid) > 0 && (
                <button disabled={busy} onClick={() => reverse(p.id)} className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <RotateCcw size={11} /> desfazer pagamentos
                </button>
              )}
            </div>
          );
        })}
      </div>

      {events.length > 0 && (
        <div className="surface-card p-4">
          <p className="text-xs font-medium mb-2">Histórico</p>
          <ul className="space-y-1 text-[11px] text-muted-foreground">
            {events.map((e: any) => (
              <li key={e.id}>{new Date(e.created_at).toLocaleString("pt-BR")} — {e.event_type}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
