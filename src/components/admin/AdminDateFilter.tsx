import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  PRESET_LABELS,
  formatPeriodLabel,
  resolvePreset,
  todaySP,
  type PeriodPresetKey,
  type PeriodRange,
} from "@/lib/admin/periodPresets";

type Props = {
  value: PeriodRange;
  preset: PeriodPresetKey;
  onChange: (next: { preset: PeriodPresetKey; range: PeriodRange }) => void;
};

const PRESETS: PeriodPresetKey[] = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "current_month",
  "previous_month",
  "custom",
];

function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateToYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AdminDateFilter({ value, preset, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const handlePreset = (p: PeriodPresetKey) => {
    if (p === "custom") {
      onChange({ preset: "custom", range: value });
      return;
    }
    onChange({ preset: p, range: resolvePreset(p) });
    setOpen(false);
  };

  const handleRange = (range: { from?: Date; to?: Date } | undefined) => {
    if (!range?.from) return;
    const from = dateToYmd(range.from);
    const to = range.to ? dateToYmd(range.to) : from;
    onChange({ preset: "custom", range: { from, to } });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-2 font-normal", "min-w-[220px] justify-between")}
        >
          <span className="flex items-center gap-2 truncate">
            <CalendarIcon size={14} className="text-muted-foreground" />
            <span className="truncate">
              {preset === "custom" ? formatPeriodLabel(value) : PRESET_LABELS[preset]}
            </span>
          </span>
          {preset !== "custom" && (
            <span className="text-[10px] text-muted-foreground">{formatPeriodLabel(value)}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="flex">
          <div className="flex flex-col gap-1 border-r border-border p-2 min-w-[160px]">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handlePreset(p)}
                className={cn(
                  "rounded-md px-3 py-2 text-left text-sm hover:bg-secondary",
                  preset === p && "bg-secondary font-medium",
                )}
              >
                {PRESET_LABELS[p]}
              </button>
            ))}
          </div>
          <div className="p-2">
            <Calendar
              mode="range"
              defaultMonth={ymdToDate(value.from)}
              selected={{ from: ymdToDate(value.from), to: ymdToDate(value.to) }}
              onSelect={handleRange as any}
              numberOfMonths={1}
              disabled={{ after: ymdToDate(todaySP()) }}
              className={cn("p-2 pointer-events-auto")}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
