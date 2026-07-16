import { useState } from "react";
import { Loader2, RefreshCcw, Play, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatusChip } from "@/components/admin/StatusChip";
import { useAdminPlatformStatus, type JobKey } from "@/hooks/useAdminPlatformStatus";
import { mapJobStatus, humanizeRelative } from "@/lib/admin/statusMapper";
import { mapAdminActionError } from "@/lib/admin/errorMapper";

const JOBS: { key: JobKey; label: string; desc: string; canReprocess: boolean }[] = [
  { key: "whatsapp-send", label: "Envio de mensagens", desc: "Entrega o que o assistente responde aos usuários.", canReprocess: true },
  { key: "split-reminders-dispatch", label: "Lembretes de divisão do rolê", desc: "Avisa os participantes de valores em aberto.", canReprocess: true },
  { key: "recurring-generate", label: "Contas que se repetem", desc: "Cria automaticamente as ocorrências agendadas.", canReprocess: false },
  { key: "whatsapp-ack-watchdog", label: "Confirmações de leitura", desc: "Reconcilia entregas e leituras pendentes.", canReprocess: false },
];

export default function Operacao() {
  const q = useAdminPlatformStatus();
  const [busy, setBusy] = useState<string | null>(null);

  const runCheck = async (jobKey: JobKey) => {
    setBusy(jobKey + ":check");
    try {
      const { error } = await supabase.rpc("admin_run_check", { p_job_key: jobKey });
      if (error) throw error;
      toast.success("Verificação registrada.");
      q.refetch();
    } catch (e) {
      const fe = mapAdminActionError(e);
      toast.error(`${fe.title} · ${fe.code}`);
    } finally { setBusy(null); }
  };

  const reprocess = async (jobKey: JobKey) => {
    setBusy(jobKey + ":reprocess");
    try {
      const { data, error } = await supabase.rpc("admin_reprocess_failed", { p_job_key: jobKey });
      if (error) throw error;
      const count = (data as { requeued?: number } | null)?.requeued ?? 0;
      toast.success(count > 0 ? `${count} itens recolocados na fila.` : "Nada em falha no momento.");
      q.refetch();
    } catch (e) {
      const fe = mapAdminActionError(e);
      toast.error(`${fe.title} · ${fe.code}`);
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Operação</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Saúde das automações que sustentam o produto. Cada card mostra o estado real das últimas execuções.
          </p>
        </div>
        <button onClick={() => q.refetch()} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1">
          <RefreshCcw size={12} /> Atualizar
        </button>
      </header>

      {q.isLoading ? (
        <div className="grid place-items-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {JOBS.map((j) => {
            const info = q.data?.jobs?.[j.key];
            const view = mapJobStatus(info?.status);
            return (
              <div key={j.key} className="surface-card p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{j.label}</p>
                    <p className="text-xs text-muted-foreground">{j.desc}</p>
                  </div>
                  <StatusChip view={view} size="sm" />
                </div>

                <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                  <div>
                    <p className="uppercase tracking-wider">Última</p>
                    <p className="text-foreground text-sm mt-0.5">{humanizeRelative(info?.last_run_at ?? null)}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-wider">Processados</p>
                    <p className="text-foreground text-sm mt-0.5">{info?.processed ?? 0}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-wider">Falhas</p>
                    <p className="text-foreground text-sm mt-0.5">{info?.failed ?? 0}</p>
                  </div>
                </div>

                {view.impact && info?.status !== "healthy" && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">{view.impact}</p>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => runCheck(j.key)}
                    disabled={!!busy}
                    className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    <Play size={11} /> Executar verificação
                  </button>

                  {j.canReprocess && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          disabled={!!busy || (info?.failed ?? 0) === 0}
                          className="inline-flex items-center gap-1 rounded-full border border-amber-200 text-amber-800 px-3 py-1.5 text-xs hover:bg-amber-50 disabled:opacity-40"
                        >
                          <RotateCw size={11} /> Reprocessar falhas
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Reprocessar itens em falha?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Os itens serão recolocados na fila para nova tentativa. Nada é reenviado sem passar pelas regras usuais.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => reprocess(j.key)}>Reprocessar</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
