import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Download, Loader2, MoreHorizontal, Printer, RefreshCw } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { REPORT_TABS_V2, type ReportTabV2 } from "@/lib/reports/reportV2Client";
import { cn } from "@/lib/utils";
import { monthTitle } from "./ui";

// Estrutura da tela de Relatórios (handoff): cabeçalho compacto com menu de ações, seletor de período de 44 px,
// abas com a ativa em roxo sólido, e estados de carregamento/erro.

const shiftMonth = (ym: string, delta: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export function ReportHeader({ onExport, exporting, asOf }: { onExport: () => void; exporting: boolean; asOf?: string | null }) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold leading-7 tracking-tight">Relatórios</h1>
        <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{asOf ? `Dados até ${asOf.slice(8, 10)}/${asOf.slice(5, 7)}` : "Seu dinheiro, explicado"}</p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Ações do relatório" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground print:hidden">
          {exporting ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <MoreHorizontal size={18} aria-hidden />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onExport} disabled={exporting}><Download size={16} className="mr-2" aria-hidden />Exportar CSV</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => window.print()}><Printer size={16} className="mr-2" aria-hidden />Imprimir</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

export function PeriodSelector({ month, thisMonth, today, onPick }: { month: string; thisMonth: string; today: string; onPick: (m: string) => void }) {
  const options = Array.from({ length: 18 }, (_, i) => shiftMonth(thisMonth, -i));
  const sub = month === thisMonth ? `até o dia ${Number(today.slice(8, 10))}` : "mês inteiro";
  return (
    <div className="flex items-center gap-1 rounded-2xl border border-border bg-card p-1 print:hidden" role="group" aria-label="Período do relatório">
      <button type="button" aria-label="Mês anterior" onClick={() => onPick(shiftMonth(month, -1))} className="grid h-11 w-11 place-items-center rounded-xl text-muted-foreground"><ChevronLeft size={20} aria-hidden /></button>
      <div className="relative flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-2">
        <CalendarDays size={18} className="text-primary" aria-hidden />
        <span className="text-[15px] font-semibold leading-5">{monthTitle(month)}</span>
        <span className="text-xs leading-4 text-muted-foreground">· {sub}</span>
        <ChevronDown size={16} className="text-muted-foreground" aria-hidden />
        <select aria-label="Escolher o mês" value={month} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
          {options.map((m) => <option key={m} value={m}>{monthTitle(m)}</option>)}
        </select>
      </div>
      <button type="button" aria-label="Mês seguinte" disabled={month >= thisMonth} onClick={() => onPick(shiftMonth(month, 1))} className="grid h-11 w-11 place-items-center rounded-xl text-muted-foreground disabled:opacity-30"><ChevronRight size={20} aria-hidden /></button>
    </div>
  );
}

export function ReportTabs({ active, onChange }: { active: ReportTabV2; onChange: (id: ReportTabV2) => void }) {
  const ids = REPORT_TABS_V2.map((t) => t.id);
  return (
    <div role="tablist" aria-label="Seções do relatório" className="flex gap-0.5 overflow-x-auto rounded-2xl bg-secondary/70 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden print:hidden"
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const i = ids.indexOf(active);
        const next = ids[(i + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
        onChange(next);
        document.getElementById(`aba-${next}`)?.focus();
      }}>
      {REPORT_TABS_V2.map((t) => (
        <button key={t.id} type="button" role="tab" id={`aba-${t.id}`} aria-selected={t.id === active} aria-controls={`painel-${t.id}`} tabIndex={t.id === active ? 0 : -1} onClick={() => onChange(t.id)}
          className={cn("min-h-[44px] shrink-0 grow rounded-xl px-1.5 text-[12.5px] leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
            t.id === active ? "bg-primary font-semibold text-primary-foreground shadow-sm" : "font-medium text-muted-foreground")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function ReportSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <span className="sr-only">Calculando seu relatório</span>
      <Skeleton className="h-36 rounded-2xl" />
      <div className="grid grid-cols-2 gap-3"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div>
      <Skeleton className="h-56 rounded-2xl" />
    </div>
  );
}

export function ReportError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
      <p className="text-sm font-semibold">Não consegui montar o relatório agora</p>
      <p className="mt-1 text-xs text-muted-foreground">Seus dados estão seguros. Tente de novo em instantes.</p>
      <button type="button" onClick={onRetry} className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-border px-4 text-sm font-medium">
        <RefreshCw size={14} aria-hidden /> Tentar de novo
      </button>
    </div>
  );
}
