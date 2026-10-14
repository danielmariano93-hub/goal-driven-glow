import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2, Share, SquarePlus } from "lucide-react";
import { toast } from "sonner";
import {
  currentSubscription, disablePush, enablePush, isStandalone, pushSupport, sendTestPush, type PushSupport,
} from "@/lib/push/pushClient";

/**
 * Notificações no celular (Web Push). No iPhone só funcionam com o Nino instalado na Tela de Início,
 * e o pedido de permissão precisa vir de um toque nesta tela.
 */
export default function PushNotificationsCard() {
  const [support, setSupport] = useState<PushSupport>(() => pushSupport());
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const next = pushSupport();
    setSupport(next);
    if (next.state === "ready" && next.permission === "granted") {
      try { setActive(Boolean(await currentSubscription())); } catch { setActive(false); }
    } else setActive(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const onEnable = async () => {
    setBusy(true);
    const result = await enablePush();
    setBusy(false);
    if (result.ok === true) {
      toast.success("Notificações ativadas neste aparelho.");
    } else if (result.reason === "denied") {
      toast.error("A permissão foi negada. Você pode liberar em Ajustes do iPhone > Notificações > Meu Nino.");
    } else {
      toast.error("Não consegui ativar agora. Tente de novo em instantes.");
    }
    void refresh();
  };
  const onDisable = async () => { setBusy(true); await disablePush(); setBusy(false); toast.success("Notificações desativadas neste aparelho."); void refresh(); };
  const onTest = async () => {
    setBusy(true);
    try {
      const r = await sendTestPush();
      toast[r.sent > 0 ? "success" : "error"](r.sent > 0 ? "Enviei uma notificação de teste." : "Nenhum aparelho recebeu. Desative e ative de novo.");
    } catch { toast.error("Não consegui enviar o teste agora."); }
    setBusy(false);
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6" aria-label="Notificações no celular">
      <div className="flex items-center gap-2">
        <BellRing className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Notificações no celular</h2>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Os mesmos alertas, lembretes e resumos do Nino chegam como notificação do iPhone. Silêncio entre 21h e 8h e no máximo 6 por dia.
      </p>

      {support.state === "ios_needs_install" ? (
        <div className="mt-3 space-y-2 rounded-xl bg-secondary/60 p-3 text-xs">
          <p className="font-semibold">No iPhone, primeiro instale o Nino na Tela de Início:</p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>Abra o <strong>meunino.com.br</strong> no <strong>Safari</strong>.</li>
            <li>Toque em <Share className="inline h-3.5 w-3.5" aria-label="Compartilhar" /> <strong>Compartilhar</strong> (quadradinho com seta).</li>
            <li>Role e toque em <SquarePlus className="inline h-3.5 w-3.5" aria-hidden /> <strong>Adicionar à Tela de Início</strong> e depois em <strong>Adicionar</strong>.</li>
            <li>Abra o Nino pelo <strong>ícone novo</strong> e volte a esta tela para ativar.</li>
          </ol>
        </div>
      ) : support.state === "unsupported" ? (
        <p className="mt-3 text-xs text-muted-foreground">Este navegador não suporta notificações. No iPhone, use o Safari (iOS 16.4 ou mais novo).</p>
      ) : support.state === "denied" ? (
        <p className="mt-3 text-xs text-muted-foreground">As notificações estão bloqueadas. Para liberar: Ajustes do iPhone &gt; Notificações &gt; Meu Nino.</p>
      ) : active ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Ativas neste aparelho</span>
          <button type="button" onClick={onTest} disabled={busy} className="min-h-10 rounded-full border border-border px-3 text-xs font-medium disabled:opacity-50">Enviar um teste</button>
          <button type="button" onClick={onDisable} disabled={busy} className="min-h-10 rounded-full px-3 text-xs text-muted-foreground disabled:opacity-50">Desativar</button>
        </div>
      ) : (
        <button type="button" onClick={onEnable} disabled={busy}
          className="mt-3 min-h-11 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          Ativar notificações
        </button>
      )}
      {support.state === "ready" && !isStandalone() ? (
        <p className="mt-2 text-[11px] text-muted-foreground">Dica: para melhor resultado, abra o Nino pelo ícone da Tela de Início.</p>
      ) : null}
    </section>
  );
}
