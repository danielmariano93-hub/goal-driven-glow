import { useEffect, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { JOB_LABEL, jobProgress, scheduleSentence, useCancelRun, useEnqueueRun, useSaveSyntheticSettings, useSyntheticState } from "@/lib/admin/qualidade";

/** Botão "Rodar agora", andamento da rodada em curso e rodada automática com intervalo ajustável. */
export function SyntheticRunPanel() {
  const stateQ = useSyntheticState();
  const enqueue = useEnqueueRun();
  const cancel = useCancelRun();
  const save = useSaveSyntheticSettings();
  const s = stateQ.data;
  const active = s?.active ?? null;
  const [reps, setReps] = useState(1);
  const [llm, setLlm] = useState(false);
  const [autoOn, setAutoOn] = useState(false);
  const [hours, setHours] = useState(24);
  useEffect(() => { if (s?.settings) { setAutoOn(s.settings.enabled); setHours(s.settings.every_hours); } }, [s?.settings?.enabled, s?.settings?.every_hours]); // eslint-disable-line react-hooks/exhaustive-deps

  if (stateQ.isError) {
    return (
      <section className="rounded-2xl border p-4 space-y-1" data-testid="run-panel-off">
        <h2 className="text-sm font-semibold">Rodar a bateria de testes</h2>
        <p className="text-xs text-muted-foreground">A rodada pelo painel ainda não foi ativada neste ambiente (falta aplicar a migração da fila). Enquanto isso, as rodadas continuam pela linha de comando e aparecem aqui.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border p-4 space-y-4" data-testid="run-panel">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Rodar a bateria de testes</h2>
        <p className="text-xs text-muted-foreground">Contas de teste conversam com o Nino de verdade (nada é enviado a ninguém). A rodada completa leva de 15 a 30 minutos e continua mesmo com esta tela fechada.</p>
      </div>

      {active ? (
        <div className="space-y-2" data-testid="run-active">
          <p className="text-sm font-semibold">{JOB_LABEL[active.status]}: {active.done} de {active.total || "…"} conversas</p>
          <div className="h-2 rounded-full bg-muted" role="progressbar" aria-valuenow={jobProgress(active)} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-primary" style={{ width: `${jobProgress(active)}%` }} /></div>
          {active.error ? <p className="text-xs text-warning">Último aviso: {active.error}</p> : null}
          <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold" onClick={() => cancel.mutate(active.id)} disabled={cancel.isPending}><Square size={12} aria-hidden />Cancelar rodada</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">Tentativas por conversa
              <select className="mt-1 block rounded-lg border bg-background p-2 text-sm" value={reps} onChange={(e) => setReps(Number(e.target.value))}>
                <option value={1}>1 (mais rápida)</option>
                <option value={3}>3 (mede se acerta sempre)</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={llm} onChange={(e) => setLlm(e.target.checked)} />Variar a escrita com IA (experimental)</label>
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60" disabled={enqueue.isPending} onClick={() => enqueue.mutate({ reps, llm })}>
              {enqueue.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Play size={14} aria-hidden />}Rodar agora
            </button>
          </div>
          {enqueue.data && !enqueue.data.ok ? <p className="text-xs text-warning">Já existe uma rodada em andamento.</p> : null}
          {enqueue.isError ? <p className="text-xs text-destructive">Não consegui enfileirar a rodada. Tente de novo.</p> : null}
        </div>
      )}

      <div className="space-y-2 border-t pt-3" data-testid="auto-run">
        <p className="text-sm font-semibold">Rodada automática</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={autoOn} onChange={(e) => setAutoOn(e.target.checked)} />Rodar sozinho</label>
          <label className="text-xs">A cada
            <select className="mt-1 block rounded-lg border bg-background p-2 text-sm" value={hours} onChange={(e) => setHours(Number(e.target.value))} disabled={!autoOn}>
              {[6, 12, 24, 48, 72, 168].map((h) => <option key={h} value={h}>{h < 24 ? `${h} horas` : h === 24 ? "1 dia" : h === 168 ? "7 dias" : `${h / 24} dias`}</option>)}
            </select>
          </label>
          <button type="button" className="rounded-lg border px-3 py-2 text-xs font-semibold" disabled={save.isPending} onClick={() => save.mutate({ enabled: autoOn, every_hours: hours })}>Salvar</button>
        </div>
        <p className="text-xs text-muted-foreground">{scheduleSentence(s?.settings)}</p>
        <p className="text-xs text-muted-foreground">Rodar sozinho usa a mesma cota de IA dos clientes reais. Por isso a rodada é lenta de propósito e reduz o ritmo se o provedor degradar.</p>
      </div>

      {s?.recent?.length ? (
        <ul className="space-y-1 border-t pt-3 text-xs" aria-label="Últimas rodadas">
          {s.recent.map((j) => (
            <li key={j.id} className="flex justify-between gap-2"><span>{j.label ?? "Rodada"} · {j.source === "schedule" ? "automática" : "manual"}</span><span className="text-muted-foreground">{JOB_LABEL[j.status]} · {new Date(j.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
