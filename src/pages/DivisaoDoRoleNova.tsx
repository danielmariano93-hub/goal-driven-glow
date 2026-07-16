import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { splitEqual, validateCustomSplit, formatBRL } from "@/lib/split/math";

interface Participant {
  name: string;
  phone_e164: string;
  amount_due?: number;
}

export default function DivisaoDoRoleNova() {
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [total, setTotal] = useState<string>("");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [mode, setMode] = useState<"equal" | "custom">("equal");
  const [includeOwner, setIncludeOwner] = useState(true);
  const [ownerAmount, setOwnerAmount] = useState<string>("");
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [pixKey, setPixKey] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([{ name: "", phone_e164: "" }]);

  const totalNum = Number(total.replace(",", "."));
  const ownerNum = Number(String(ownerAmount).replace(",", "."));
  const preview = mode === "equal" && totalNum > 0
    ? splitEqual(totalNum, [
        ...(includeOwner ? [{ name: "Você", is_owner: true }] : []),
        ...participants.filter(p => p.name).map(p => ({ name: p.name })),
      ])
    : [];

  const customSum = mode === "custom"
    ? validateCustomSplit(totalNum, [
        ...(includeOwner ? [ownerNum || 0] : []),
        ...participants.map(p => Number(p.amount_due ?? 0)),
      ])
    : { ok: true, sum: 0 };

  const canProceed = () => {
    if (step === 1) return title.trim().length > 0 && totalNum > 0 && occurredAt;
    if (step === 2) {
      const filled = participants.filter(p => p.name.trim());
      if (filled.length === 0 && !includeOwner) return false;
      if (mode === "custom" && !customSum.ok) return false;
      return true;
    }
    return true;
  };

  const submit = async () => {
    setSaving(true);
    try {
      const filtered = participants.filter(p => p.name.trim());
      const { data, error } = await supabase.rpc("split_create" as any, {
        p_title: title.trim(),
        p_total: totalNum,
        p_occurred_at: occurredAt,
        p_due_date: dueDate || null,
        p_split_mode: mode,
        p_include_owner: includeOwner,
        p_reminder_enabled: reminderEnabled,
        p_pix_key: pixKey || null,
        p_participants: filtered.map(p => ({
          name: p.name,
          phone_e164: p.phone_e164 || null,
          amount_due: p.amount_due ?? null,
        })),
      });
      if (error) throw error;
      toast.success("Divisão criada");
      nav(`/app/divisao-do-role/${data}`);
    } catch (e: any) {
      toast.error(e.message || "Erro ao criar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 pt-2">
      <button onClick={() => nav(-1)} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <ArrowLeft size={14} /> Voltar
      </button>
      <h1 className="font-display text-2xl font-bold tracking-tight">Nova divisão · Passo {step}/3</h1>

      {step === 1 && (
        <div className="surface-card p-4 space-y-3">
          <label className="block text-xs font-medium">Título</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Jantar no bar"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <label className="block text-xs font-medium">Valor total (R$)</label>
          <input value={total} onChange={e => setTotal(e.target.value)} inputMode="decimal" placeholder="0,00"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <label className="block text-xs font-medium">Data do evento</label>
          <input type="date" value={occurredAt} onChange={e => setOccurredAt(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <label className="block text-xs font-medium">Vencimento (opcional)</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className="surface-card p-4 space-y-2">
            <div className="flex gap-2">
              <button onClick={() => setMode("equal")} className={`text-xs px-3 py-1.5 rounded-full border ${mode==="equal"?"bg-primary text-primary-foreground border-primary":"bg-card border-border"}`}>Igual</button>
              <button onClick={() => setMode("custom")} className={`text-xs px-3 py-1.5 rounded-full border ${mode==="custom"?"bg-primary text-primary-foreground border-primary":"bg-card border-border"}`}>Personalizada</button>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={includeOwner} onChange={e => setIncludeOwner(e.target.checked)} />
              Incluir você na divisão
            </label>
          </div>

          <div className="surface-card p-4 space-y-2">
            {participants.map((p, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input value={p.name} onChange={e => {
                  const n = [...participants]; n[i].name = e.target.value; setParticipants(n);
                }} placeholder="Nome" className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
                <input value={p.phone_e164} onChange={e => {
                  const n = [...participants]; n[i].phone_e164 = e.target.value; setParticipants(n);
                }} placeholder="+55…" className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
                {mode === "custom" && (
                  <input inputMode="decimal" value={p.amount_due ?? ""} onChange={e => {
                    const n = [...participants]; n[i].amount_due = Number(e.target.value); setParticipants(n);
                  }} placeholder="R$" className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
                )}
                <button onClick={() => setParticipants(participants.filter((_, j) => j !== i))} className="p-1.5 text-destructive"><Trash2 size={14} /></button>
              </div>
            ))}
            <button onClick={() => setParticipants([...participants, { name: "", phone_e164: "" }])}
              className="inline-flex items-center gap-1 text-xs text-primary">
              <Plus size={12} /> adicionar participante
            </button>
            {mode === "equal" && preview.length > 0 && (
              <div className="mt-3 text-xs text-muted-foreground">
                <p>Cada participante paga aproximadamente {formatBRL(totalNum / preview.length)}. Centavos residuais vão primeiro para o criador, depois em ordem alfabética.</p>
                <ul className="mt-2 space-y-0.5">
                  {preview.map((x, i) => <li key={i}>{x.name}: {formatBRL(x.amount_due)}{x.is_owner ? " (você)" : ""}</li>)}
                </ul>
              </div>
            )}
            {mode === "custom" && (
              <p className={`text-xs mt-2 ${customSum.ok ? "text-success" : "text-destructive"}`}>
                Soma: {formatBRL(customSum.sum)} · Total: {formatBRL(totalNum)}
              </p>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="surface-card p-4 space-y-3">
          <p className="text-sm font-medium">Revisão</p>
          <div className="text-sm space-y-1">
            <p><span className="text-muted-foreground">Título:</span> {title}</p>
            <p><span className="text-muted-foreground">Total:</span> {formatBRL(totalNum)}</p>
            <p><span className="text-muted-foreground">Data:</span> {new Date(occurredAt).toLocaleDateString("pt-BR")}</p>
            <p><span className="text-muted-foreground">Modo:</span> {mode === "equal" ? "Igual" : "Personalizada"}</p>
          </div>
          <label className="flex items-center gap-2 text-xs pt-2 border-t border-border">
            <input type="checkbox" checked={reminderEnabled} onChange={e => setReminderEnabled(e.target.checked)} />
            Ativar lembretes por WhatsApp (você precisa confirmar cada envio)
          </label>
          <label className="block text-xs font-medium">Chave Pix (opcional, mostrada nos lembretes)</label>
          <input value={pixKey} onChange={e => setPixKey(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </div>
      )}

      <div className="flex gap-2">
        {step > 1 && <button onClick={() => setStep(step - 1)} className="rounded-full border border-border px-4 py-2 text-sm">Voltar</button>}
        {step < 3 && <button disabled={!canProceed()} onClick={() => setStep(step + 1)} className="ml-auto rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50">Continuar</button>}
        {step === 3 && (
          <button disabled={saving} onClick={submit} className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50">
            {saving && <Loader2 size={14} className="animate-spin" />} Criar divisão
          </button>
        )}
      </div>
    </div>
  );
}
