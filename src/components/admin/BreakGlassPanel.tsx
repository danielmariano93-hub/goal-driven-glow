import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Lock, Unlock } from "lucide-react";

type Props = {
  onChange?: () => void;
};

/**
 * Painel Break-glass: acesso emergencial a campos sensíveis por 15 minutos,
 * restrito a platform_owner, com motivo obrigatório e reautenticação recente.
 */
export function BreakGlassPanel({ onChange }: Props) {
  const [targetPseudo, setTargetPseudo] = useState("");
  const [reason, setReason] = useState("");
  const [ticket, setTicket] = useState("");
  const [fields, setFields] = useState("email");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reauthAndOpen() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      // 1) Reauth: reautentica com senha
      const { data: sessionData } = await supabase.auth.getUser();
      const email = sessionData.user?.email;
      if (!email) throw new Error("Sessão inválida");
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInErr) throw new Error("Senha incorreta");

      // 2) Registra reauth
      await supabase.rpc("record_admin_reauth" as never);

      // 3) Abre break-glass
      const fieldsArr = fields
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("admin_open_break_glass", {
        _target_pseudo_id: targetPseudo,
        _reason: reason,
        _ticket_ref: ticket,
        _fields: fieldsArr,
      });
      if (error) throw error;
      setMsg(`Sessão break-glass aberta. Expira em 15 min. ID: ${data}`);
      setPassword("");
      onChange?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function closeActive() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)("admin_close_break_glass");
      if (error) throw error;
      setMsg("Sessão break-glass encerrada.");
      onChange?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface-card p-4 border border-amber-300/60">
      <div className="flex items-center gap-2 text-amber-700 mb-2">
        <AlertTriangle size={16} />
        <h3 className="font-display text-base font-semibold">Break-glass (acesso emergencial)</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Válido por 15 min. Escopo mínimo. Requer motivo (≥ 20 chars), ticket e reautenticação. Todos os acessos ficam auditados.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          <span className="text-xs text-muted-foreground">Pseudo ID alvo</span>
          <input
            className="mt-1 w-full rounded border border-border/60 px-2 py-1.5 text-sm bg-background"
            value={targetPseudo}
            onChange={(e) => setTargetPseudo(e.target.value)}
            placeholder="uuid"
          />
        </label>
        <label className="text-sm">
          <span className="text-xs text-muted-foreground">Ticket</span>
          <input
            className="mt-1 w-full rounded border border-border/60 px-2 py-1.5 text-sm bg-background"
            value={ticket}
            onChange={(e) => setTicket(e.target.value)}
            placeholder="ex: SUP-1234"
          />
        </label>
        <label className="text-sm md:col-span-2">
          <span className="text-xs text-muted-foreground">Motivo (≥ 20 chars)</span>
          <textarea
            className="mt-1 w-full rounded border border-border/60 px-2 py-1.5 text-sm bg-background"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="text-xs text-muted-foreground">Campos (separados por vírgula)</span>
          <input
            className="mt-1 w-full rounded border border-border/60 px-2 py-1.5 text-sm bg-background"
            value={fields}
            onChange={(e) => setFields(e.target.value)}
            placeholder="email,phone"
          />
        </label>
        <label className="text-sm">
          <span className="text-xs text-muted-foreground">Reautenticar (senha)</span>
          <input
            type="password"
            className="mt-1 w-full rounded border border-border/60 px-2 py-1.5 text-sm bg-background"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={reauthAndOpen}
          disabled={busy || !targetPseudo || reason.length < 20 || !ticket || !password}
          className="inline-flex items-center gap-1.5 rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-40"
        >
          <Unlock size={14} /> Abrir sessão break-glass
        </button>
        <button
          type="button"
          onClick={closeActive}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded border border-border/60 px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-40"
        >
          <Lock size={14} /> Encerrar minha sessão ativa
        </button>
      </div>

      {msg && <div className="mt-3 text-sm text-emerald-700">{msg}</div>}
      {err && <div className="mt-3 text-sm text-rose-700">{err}</div>}
    </div>
  );
}
