import { useState } from "react";
import { Loader2, RefreshCcw, Play, RotateCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/admin/StatusChip";
import { PageHeader } from "@/components/admin/PageHeader";
import { SkeletonList } from "@/components/admin/AdminSkeleton";
import { adminToast } from "@/components/admin/adminToast";
import { useAdminPlatformStatus, type JobKey } from "@/hooks/useAdminPlatformStatus";
import { mapJobStatus, humanizeRelative } from "@/lib/admin/statusMapper";

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
      adminToast.success("Verificação registrada");
      q.refetch();
    } catch (e) {
      adminToast.fromError(e, "Não foi possível verificar");
    } finally { setBusy(null); }
  };

  const reprocess = async (jobKey: JobKey) => {
    setBusy(jobKey + ":reprocess");
    try {
      const { data, error } = await supabase.rpc("admin_reprocess_failed", { p_job_key: jobKey });
      if (error) throw error;
      const count = (data as { requeued?: number } | null)?.requeued ?? 0;
      adminToast.success(count > 0 ? `${count} itens recolocados na fila` : "Nada em falha no momento");
      q.refetch();
    } catch (e) {
      adminToast.fromError(e, "Não foi possível reprocessar");
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operação"
        description="Saúde das automações que sustentam o produto. Cada card mostra o estado real das últimas execuções."
        actions={
          <Button variant="outline" size="sm" onClick={() => q.refetch()} aria-label="Atualizar">
            <RefreshCcw size={12} /> Atualizar
          </Button>
        }
      />

      {q.isLoading ? (
        <SkeletonList rows={4} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {JOBS.map((j) => {
            const info = q.data?.jobs?.[j.key];
            const view = mapJobStatus(info?.status);
            const isChecking = busy === j.key + ":check";
            const isReprocessing = busy === j.key + ":reprocess";
            return (
              <div key={j.key} className="surface-card p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{j.label}</p>
                    <p className="text-xs text-muted-foreground">{j.desc}</p>
                  </div>
                  <StatusChip view={view} size="sm" />
                </div>

                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <Metric label="Última" value={humanizeRelative(info?.last_run_at ?? null)} />
                  <Metric label="Processados" value={String(info?.processed ?? 0)} />
                  <Metric label="Falhas" value={String(info?.failed ?? 0)} tone={info?.failed ? "warn" : "neutral"} />
                </div>

                {view.impact && info?.status !== "healthy" && (
                  <p className="flex items-start gap-2 rounded-lg bg-warning/10 border border-warning/30 p-2 text-xs text-warning-foreground">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                    {view.impact}
                  </p>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runCheck(j.key)}
                    disabled={!!busy}
                    aria-label={`Executar verificação de ${j.label}`}
                  >
                    {isChecking ? <Loader2 className="animate-spin" size={12} /> : <Play size={12} />}
                    Executar verificação
                  </Button>

                  {j.canReprocess && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy || (info?.failed ?? 0) === 0}
                          className="border-warning/40 text-warning-foreground hover:bg-warning/10"
                          aria-label={`Reprocessar falhas de ${j.label}`}
                        >
                          {isReprocessing ? <Loader2 className="animate-spin" size={12} /> : <RotateCw size={12} />}
                          Reprocessar falhas
                        </Button>
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

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "warn" }) {
  const toneCls = tone === "warn" ? "text-warning-foreground" : "text-foreground";
  return (
    <div>
      <p className="uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-sm mt-0.5 ${toneCls}`}>{value}</p>
    </div>
  );
}
