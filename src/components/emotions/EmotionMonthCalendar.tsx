import { useEffect, useMemo, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EMOTION_CATALOG, type EmotionOption } from "@/lib/emotions/catalog";
import { buildMonthCalendar, monthOf, monthSummary, saoPauloDay, shiftMonth, type MonthCell } from "@/lib/emotions/history";
import { useEmotionMonth, useSaveRetroCheckin } from "@/lib/emotions/useEmotionMonth";

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} de ${y}`;
}

function dayLabel(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} de ${MONTH_NAMES[m - 1]} de ${y}`;
}

/**
 * Calendário do mês: dias com registro mostram a emoção; dia sem registro é um ponto.
 * Tocar num dia (até hoje) abre o registro retroativo: lembrar de como estava e anotar depois vale.
 */
export function EmotionMonthCalendar({ month: monthProp }: { month?: string } = {}) {
  const today = saoPauloDay(new Date());
  const [month, setMonth] = useState(monthProp && monthProp <= monthOf(today) ? monthProp : monthOf(today));
  // O mês acompanha o período escolhido na tela; dentro do calendário a pessoa ainda navega livremente.
  useEffect(() => {
    if (monthProp && monthProp <= monthOf(today)) setMonth(monthProp);
  }, [monthProp, today]);
  const [editing, setEditing] = useState<MonthCell | null>(null);
  const { data, isLoading } = useEmotionMonth(month);
  const weeks = useMemo(() => buildMonthCalendar(data ?? [], month, today), [data, month, today]);
  const summary = useMemo(() => monthSummary(weeks, today), [weeks, today]);
  const isCurrent = month === monthOf(today);
  const existing = editing ? (data ?? []).filter((r) => saoPauloDay(r.occurred_at) === editing.date).at(-1) ?? null : null;

  return (
    <div className="mt-3" data-testid="emotion-month">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary"><CaretLeft size={14} weight="bold" /></button>
        <p className="text-[12px] font-semibold capitalize text-foreground">{monthLabel(month)}</p>
        <button type="button" disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary disabled:opacity-30"><CaretRight size={14} weight="bold" /></button>
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground" aria-hidden>
        {WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}
      </div>
      <div className={`mt-1 grid grid-cols-7 gap-1 ${isLoading ? "opacity-60" : ""}`} role="grid" aria-label={`Humor em ${monthLabel(month)}`}>
        {weeks.flat().map((c) => {
          // Dia que ainda não chegou não aparece: só dá para registrar até hoje.
          if (!c.inMonth || c.future) return <span key={c.date} aria-hidden />;
          const label = c.emotion ? `${dayLabel(c.date)}: ${c.emotion.label}` : c.future ? `${dayLabel(c.date)}: ainda não chegou` : `${dayLabel(c.date)}: sem registro. Toque para registrar`;
          return (
            <button
              key={c.date} type="button" disabled={c.future} onClick={() => setEditing(c)} aria-label={label} title={label}
              className={`flex h-11 flex-col items-center justify-center rounded-xl text-[10px] leading-none transition ${c.isToday ? "ring-2 ring-primary/40" : ""} ${c.emotion ? "bg-secondary/60" : c.future ? "opacity-30" : "border border-dashed border-border hover:bg-secondary/40"}`}
            >
              <span className={c.isToday ? "font-bold text-primary" : "text-muted-foreground"}>{c.day}</span>
              <span className="mt-0.5 text-[16px] leading-none" aria-hidden>{c.emotion ? c.emotion.emoji : ""}</span>
            </button>
          );
        })}
      </div>
      {summary.elapsed > 0 ? (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          {summary.registered === 0
            ? "Nenhum dia registrado neste mês ainda. Toque num dia para registrar, mesmo que seja de memória."
            : `${summary.registered} de ${summary.elapsed} dias registrados. Dias que ficaram em branco podem ser preenchidos de memória: mais dias, melhor o Nino enxerga seu padrão.`}
        </p>
      ) : null}
      {editing ? <DayEditor key={editing.date} cell={editing} existingId={existing?.id ?? null} existingEmotionKey={existing ? (existing.declared_emotion_key ?? existing.emotion_key ?? null) : null} existingNote={existing?.notes ?? ""} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function DayEditor({ cell, existingId, existingEmotionKey, existingNote, onClose }: {
  cell: MonthCell; existingId: string | null; existingEmotionKey: string | null; existingNote: string; onClose: () => void;
}) {
  const [key, setKey] = useState<string | null>(existingEmotionKey ?? cell.emotion?.key ?? null);
  const [note, setNote] = useState(existingNote);
  const save = useSaveRetroCheckin();
  const selected: EmotionOption | undefined = EMOTION_CATALOG.find((e) => e.key === key);

  async function submit() {
    if (!selected) return;
    try {
      await save.mutateAsync({ day: cell.date, emotion: selected, note, existingId });
      toast.success(existingId ? "Registro do dia atualizado." : "Dia registrado.");
      onClose();
    } catch (error) {
      console.error("[emotion:retro]", error);
      toast.error("Não deu para salvar agora. Tente de novo em instantes.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{cell.isToday ? "Como foi hoje?" : `Como você estava em ${dayLabel(cell.date)}?`}</DialogTitle>
          <DialogDescription>{cell.isToday ? "Registre como você se sentiu." : "Registro de memória: vale como dado do dia, sem cobrança."}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {EMOTION_CATALOG.map((e) => (
            <Button key={e.key} type="button" size="sm" variant={key === e.key ? "default" : "outline"} aria-pressed={key === e.key} onClick={() => setKey(e.key)} className="h-14 flex-col gap-0 rounded-2xl px-3 text-[11px] font-semibold">
              <span className="text-[20px] leading-none" aria-hidden>{e.emoji}</span>{e.label}
            </Button>
          ))}
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Quer anotar o que aconteceu? (opcional)" className="w-full resize-none rounded-xl border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button type="button" size="sm" disabled={!selected || save.isPending} onClick={submit} className="rounded-full px-5">{existingId ? "Atualizar" : "Salvar"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
