import { cn } from "@/lib/utils";

/** Escolha entre poucas opções (no padrão visual dos formulários de Hábitos). */
export function Segmented<T extends string | number>({ value, options, onChange, label, disabled }: { value: T | null; options: Array<[T, string]>; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-xl bg-muted p-[3px]">
      {options.map(([k, l]) => (
        <button key={String(k)} type="button" disabled={disabled} aria-pressed={value === k} onClick={() => onChange(k)} className={cn("h-[34px] flex-1 rounded-[9px] px-2 text-[13px] font-medium transition-colors", value === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>{l}</button>
      ))}
    </div>
  );
}
