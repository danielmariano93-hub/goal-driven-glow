import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMessages, reprocessMessage } from "@/lib/admin/messageCenter";
import { failureExplained, messageKindLabel } from "@/lib/admin/plainLanguage";
import { adminToast } from "@/components/admin/adminToast";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** O que aconteceu com cada mensagem que não chegou, em português, com o botão de tentar de novo. Abre no próprio alerta. */
export function UndeliveredMessages() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["admin-undelivered-7d"],
    queryFn: () => fetchMessages({ from: ymd(new Date(Date.now() - 7 * 86_400_000)), to: ymd(new Date()), status: "failed", limit: 10 }),
    staleTime: 30_000,
  });
  if (q.isLoading) return <p className="mt-2 text-xs text-muted-foreground">Carregando as mensagens…</p>;
  const rows = q.data ?? [];
  if (!rows.length) return <p className="mt-2 text-xs text-muted-foreground">Não encontrei mensagens com falha nos últimos 7 dias. O alerta pode ser do período mais longo selecionado.</p>;

  async function retry(id: string) {
    setBusy(id);
    try {
      await reprocessMessage(id);
      adminToast.success("Reenvio pedido. Se chegar, o aviso some sozinho.");
      await qc.invalidateQueries({ queryKey: ["admin-undelivered-7d"] });
    } catch (e) {
      adminToast.fromError(e, "Não consegui pedir o reenvio");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 space-y-2" data-testid="undelivered-messages">
      <ul className="space-y-2">
        {rows.map((m) => {
          const why = failureExplained(m.last_error);
          return (
            <li key={m.id} className="rounded-xl border border-border bg-background/70 p-3 text-xs">
              <p className="font-semibold">{messageKindLabel(m.kind)}</p>
              <p className="text-muted-foreground">
                {new Date(m.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                {m.recipient ? ` · para ${m.recipient}` : ""}
              </p>
              <p className="mt-1"><span className="font-semibold">O que aconteceu: </span>{why.what}</p>
              <p className="mt-0.5"><span className="font-semibold">O que fazer: </span>{why.todo}</p>
              <button
                type="button"
                disabled={busy === m.id}
                onClick={() => retry(m.id)}
                className="mt-2 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary disabled:opacity-50"
              >
                {busy === m.id ? "Pedindo…" : "Tentar de novo"}
              </button>
            </li>
          );
        })}
      </ul>
      <Link to="/admin/comunicacoes?aba=mensagens" className="inline-block text-xs font-semibold text-primary hover:underline">Ver todas as mensagens</Link>
    </div>
  );
}
