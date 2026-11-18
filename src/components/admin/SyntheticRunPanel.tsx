import { useEffect, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { JOB_LABEL, jobProgress, scheduleSentence, useCancelRun, useEnqueueRun, useSaveSyntheticSettings, useSyntheticState, type ScheduleKind } from "@/lib/admin/qualidade";

const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const CAPS: Array<[number, string]> = [[200_000, "200 mil (bem econômico)"], [400_000, "400 mil"], [800_000, "800 mil (padrão)"], [1_500_000, "1,5 milhão"], [3_000_000, "3 milhões"]];

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
  const [kind, setKind] = useState<ScheduleKind>("weekly");
  const [dow, setDow] = useState(0);
  const [hour, setHour] = useState(3);
  const [sample, setSample] = useState(120);
  const [cap, setCap] = useState(800_000);
  const [reportAuto, setReportAuto] = useState(true);
  const [reportNow, setReportNow] = useState(true);
  useEffect(() => {
    if (!s?.settings) return;
    const c = s.settings;
    setAutoOn(c.enabled); setHours(c.every_hours);
    setKind(c.schedule_kind ?? "interval"); setDow(c.schedule_dow ?? 0); setHour(c.schedule_hour ?? 3);
    setSample(c.sample_size ?? 120); setCap(c.token_cap ?? 800_000); setReportAuto(c.report_whatsapp ?? true);
  }, [s?.settings]);

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
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={reportNow} onChange={(e) => setReportNow(e.target.checked)} />Mandar o relatório no WhatsApp ao terminar</label>
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60" disabled={enqueue.isPending} onClick={() => enqueue.mutate({ reps, llm, report: reportNow })}>
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
          <label className="text-xs">Quando
            <select className="mt-1 block rounded-lg border bg-background p-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)} disabled={!autoOn}>
              <option value="weekly">Toda semana (sorteando conversas)</option>
              <option value="interval">A cada tantas horas (bateria completa)</option>
            </select>
          </label>
          {kind === "weekly" ? (
            <>
              <label className="text-xs">Dia
                <select aria-label="Dia da semana" className="mt-1 block rounded-lg border bg-background p-2 text-sm" value={dow} onChange={(e) => setDow(Number(e.target.value))} disabled={!autoOn}>
                  {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </label>
              <label className="text-xs">Hora (Brasília)
                <select aria-label="Hora" className="mt-1 block rounded-lg border bg-background p-2 text-sm" value={hour} onChange={(e) => setHour(Number(e.target.value))} disabled={!autoOn}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}h</option>)}
                </select>
              </label>
              <label className="text-xs">Conversas sorteadas
                <input aria-label="Conversas sorteadas" type="number" min={20} max={600} step={10} className="mt-1 block w-24 rounded-lg border bg-background p-2 text-sm" value={sample} onChange={(e) => setSample(Number(e.target.value))} disabled={!autoOn} />
              </label>
              <label className="text-xs">Limite de custo (tokens)
                <select aria-label="Limite de custo" className="mt-1 block rounded-lg border bg-background p-2 text-sm" value={cap} onChange={(e) => setCap(Number(e.target.value))} disabled={!autoOn}>
                  {CAPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </>
          ) : (
            <label className="text-xs">A cada
              <select className="mt-1 block rounded-lg border bg-background p-2 text-sm" value={hours} onChange={(e) => setHours(Number(e.target.value))} disabled={!autoOn}>
                {[6, 12, 24, 48, 72, 168].map((h) => <option key={h} value={h}>{h < 24 ? `${h} horas` : h === 24 ? "1 dia" : h === 168 ? "7 dias" : `${h / 24} dias`}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={reportAuto} onChange={(e) => setReportAuto(e.target.checked)} disabled={!autoOn} />Mandar o relatório no WhatsApp</label>
          <button type="button" className="rounded-lg border px-3 py-2 text-xs font-semibold" disabled={save.isPending}
            onClick={() => save.mutate({ enabled: autoOn, every_hours: hours, schedule_kind: kind, schedule_dow: dow, schedule_hour: hour, sample_size: Math.max(20, Math.min(600, Math.round(sample) || 120)), token_cap: cap, report_whatsapp: reportAuto })}>Salvar</button>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="schedule-sentence">{scheduleSentence(s?.settings)}</p>
        <p className="text-xs text-muted-foreground">Cada semana sorteia outra combinação de perfil, assunto e jeito de escrever. Ao fim, o relatório diz no seu WhatsApp se houve respostas erradas, para você pedir a correção. Usa a mesma cota de IA dos clientes, por isso tem limite de custo e roda de madrugada.</p>
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
