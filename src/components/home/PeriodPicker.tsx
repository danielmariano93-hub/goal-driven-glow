import { useMemo, useState } from "react";
import { CalendarBlank, CaretRight } from "@phosphor-icons/react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
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
    setPeriod(kind);
    if (kind !== "custom") setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex h-11 w-full items-center justify-start gap-3 rounded-xl border-border/80 bg-card px-3 text-left shadow-sm"
      >
        <span
          className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary"
        >
          <CalendarBlank size={15} weight="bold" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] text-muted-foreground">Período do resumo</span>
          <span className="block truncate text-[13px] font-semibold text-foreground">{label}</span>
        </span>
        <CaretRight size={14} weight="bold" className="text-muted-foreground" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Escolher período</SheetTitle>
          </SheetHeader>
          <div className="mt-3 space-y-2">
            <Opt label="Este mês" onClick={() => pick("month")} />
            <Opt label="Últimos 30 dias" onClick={() => pick("30d")} />
            <Opt label="Últimos 90 dias" onClick={() => pick("90d")} />
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
              <Button
                onClick={() => setOpen(false)}
                className="col-span-2 mt-1 rounded-full"
              >
                Aplicar
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Opt({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className="flex h-11 w-full items-center justify-between rounded-md bg-card px-4 text-left text-sm font-medium"
    >
      {label}
      <CaretRight size={14} weight="bold" className="text-muted-foreground" />
    </Button>
  );
}
