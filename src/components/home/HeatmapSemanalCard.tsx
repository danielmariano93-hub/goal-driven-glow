// Card comportamental: onde os gastos se concentram na semana.
// Só renderiza o output do motor `category_weekday_heatmap.v1` — nenhuma
// matemática financeira vive aqui.
import { useState } from "react";
import { CalendarCheck } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatBRL } from "@/lib/engine/facts";
import {
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  type CategoryWeekdayHeatmap,
  type HeatmapCell,
  type HeatmapCategory,
} from "@/lib/engine/categoryWeekdayHeatmap";

type Props = {
  data: CategoryWeekdayHeatmap | null;
  loading?: boolean;
  periodLabel?: string;
};

const LEVEL_CLASS: Record<HeatmapCell["level"], string> = {
  0: "bg-muted",
  1: "bg-primary/12",
  2: "bg-primary/28",
  3: "bg-primary/45",
  4: "bg-primary/65",
  5: "bg-primary/90",
};

function CellButton({ category, cell, periodLabel }: { category: HeatmapCategory; cell: HeatmapCell; periodLabel: string }) {
  const [open, setOpen] = useState(false);
  const dayFull = WEEKDAY_LABELS[cell.weekday].full;
  const label = `${category.categoryName}, ${dayFull}: média de ${formatBRL(cell.average)}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className={`h-7 w-full min-w-[18px] rounded-[6px] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${LEVEL_CLASS[cell.level]}`}
        />
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-auto max-w-[240px] p-3">
        <p className="text-[11px] font-bold text-primary">{category.categoryName} · {dayFull}</p>
        <p className="mt-1 font-display text-base font-bold tabular-nums text-foreground">{formatBRL(cell.average)}</p>
        <p className="text-[11px] text-muted-foreground">média por {dayFull}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {Math.round(cell.share * 100)}% do gasto médio semanal dessa categoria
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">{periodLabel}</p>
      </PopoverContent>
    </Popover>
  );
}

export function HeatmapSemanalCard({ data, loading, periodLabel = "Últimos 90 dias" }: Props) {
  if (loading) {
    return (
      <section aria-label="Onde seus gastos se concentram" className="overflow-hidden rounded-[18px] border border-border bg-card p-3.5 shadow-sm">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-40 animate-pulse rounded-2xl bg-muted" />
      </section>
    );
  }

  const hasGrid = (data?.categories.length ?? 0) > 0;

  return (
    <section aria-labelledby="heatmap-title" className="overflow-hidden rounded-[18px] border border-border bg-card shadow-sm">
      <div className="flex items-start justify-between gap-4 px-3.5 pb-2.5 pt-3.5">
        <div>
          <p className="text-[11px] font-bold text-primary">Seu padrão semanal</p>
          <h2 id="heatmap-title" className="mt-0.5 text-base font-bold text-foreground">Onde seus gastos se concentram</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Só gastos variáveis: contas fixas ficam de fora porque seguem o vencimento.</p>
        </div>
        <CalendarCheck className="h-5 w-5 shrink-0 text-muted-foreground" weight="duotone" />
      </div>

      {!hasGrid ? (
        <p className="px-3.5 pb-4 text-sm leading-[21px] text-muted-foreground">
          Conforme você registra seus gastos, o Nino vai mostrar em quais dias cada categoria costuma pesar mais.
        </p>
      ) : (
        <div className="px-3.5 pb-3.5">
          <div className="grid grid-cols-[minmax(64px,88px)_repeat(7,minmax(0,1fr))] items-center gap-1">
            <span aria-hidden className="text-[11px] text-muted-foreground">{periodLabel}</span>
            {WEEKDAY_ORDER.map((weekday) => (
              <abbr
                key={weekday}
                title={WEEKDAY_LABELS[weekday].full}
                aria-label={WEEKDAY_LABELS[weekday].full}
                className="text-center text-[11px] font-semibold text-muted-foreground no-underline"
              >
                {WEEKDAY_LABELS[weekday].short}
              </abbr>
            ))}

            {data!.categories.map((category) => (
              <div key={category.categoryId} className="col-span-8 grid grid-cols-[minmax(64px,88px)_repeat(7,minmax(0,1fr))] items-center gap-1">
                <span title={category.categoryName} className="truncate text-[11px] font-semibold text-foreground">
                  {category.categoryName}
                </span>
                {category.cells.map((cell) => (
                  <CellButton key={cell.weekday} category={category} cell={cell} periodLabel={periodLabel} />
                ))}
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Menor intensidade</span>
            <span className="flex items-center gap-0.5" aria-hidden>
              {([1, 2, 3, 4, 5] as const).map((level) => (
                <span key={level} className={`h-2.5 w-4 rounded-[3px] ${LEVEL_CLASS[level]}`} />
              ))}
            </span>
            <span className="text-[10px] text-muted-foreground">Maior intensidade</span>
          </div>

          {data!.insight ? (
            <p className="mt-2.5 text-[12px] font-semibold leading-[18px] text-foreground">{data!.insight.text}</p>
          ) : null}
          {!data!.dataQuality.sufficientHistory ? (
            <p className="mt-2 text-[11px] text-muted-foreground">Ainda estamos aprendendo seu padrão semanal.</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
