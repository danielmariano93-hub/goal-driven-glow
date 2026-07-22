import { useMemo, useState } from "react";
import { CalendarDays, ChevronRight } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { PeriodKind } from "@/lib/ui/periodStore";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function fmt(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} de ${MONTHS[Number(m[2]) - 1]}`;
}
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Props = {
  period: PeriodKind;
  customStart: string;
  customEnd: string;
  setPeriod: (v: PeriodKind) => void;
  setCustomStart: (v: string) => void;
  setCustomEnd: (v: string) => void;
  rangeStart: string;
  rangeEnd: string;
};

export function PeriodPicker({ period, customStart, customEnd, setPeriod, setCustomStart, setCustomEnd, rangeStart, rangeEnd }: Props) {
  const [open, setOpen] = useState(false);
  const label = useMemo(() => `${fmt(rangeStart)} – ${fmt(rangeEnd)}`, [rangeStart, rangeEnd]);

  const pick = (kind: PeriodKind) => {
    if (kind === "month") {
      setPeriod("month");
    } else if (kind === "30d") {
      // "Últimos 7 dias" no spec — usamos 30d como suporte existente; adaptamos abaixo via custom.
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 6);
      setCustomStart(iso(start));
      setCustomEnd(iso(end));
      setPeriod("custom");
    } else if (kind === "90d") {
      // "Mês anterior"
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      setCustomStart(iso(start));
      setCustomEnd(iso(end));
      setPeriod("custom");
    } else {
      setPeriod("custom");
    }
    if (kind !== "custom") setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex w-full items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3 text-left shadow-card"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-muted text-primary">
          <CalendarDays size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-muted-foreground">Resumo financeiro</span>
          <span className="block truncate text-sm font-semibold text-foreground">{label}</span>
        </span>
        <ChevronRight size={16} className="text-muted-foreground" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Escolher período</SheetTitle>
          </SheetHeader>
          <div className="mt-3 space-y-2">
            <Opt label="Este mês" onClick={() => pick("month")} />
            <Opt label="Últimos 7 dias" onClick={() => pick("30d")} />
            <Opt label="Mês anterior" onClick={() => pick("90d")} />
            <Opt label="Período personalizado" onClick={() => pick("custom")} />
          </div>
          {period === "custom" && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted-foreground">
                De
                <input
                  type="date"
                  value={customStart}
                  max={customEnd}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="mt-1 w-full rounded-[14px] border border-border bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="text-[11px] text-muted-foreground">
                Até
                <input
                  type="date"
                  value={customEnd}
                  min={customStart}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="mt-1 w-full rounded-[14px] border border-border bg-background px-3 py-2 text-sm"
                />
              </label>
              <button
                onClick={() => setOpen(false)}
                className="col-span-2 mt-1 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                Aplicar
              </button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Opt({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-[14px] border border-border bg-card px-4 py-3 text-left text-sm font-medium text-foreground hover:border-primary/40"
    >
      {label}
      <ChevronRight size={14} className="text-muted-foreground" />
    </button>
  );
}
