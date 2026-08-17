import { HealthPill, type PillTone } from "@/components/admin/kit/HealthPill";

/**
 * Uma linha compacta por serviço: nome, estado, tempo desde a última execução e
 * volume. Evita cartões de seis linhas no celular.
 */
export function ServiceRow({
  name,
  state,
  tone,
  lastRunAt,
  processed,
  failed,
  reason,
}: {
  name: string;
  state: string;
  tone: PillTone;
  lastRunAt: string | null;
  processed: number;
  failed: number;
  reason?: string | null;
}) {
  return (
    <li className="border-b border-border/60 py-2.5 last:border-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-full min-w-0 truncate text-sm font-medium text-foreground sm:w-auto sm:flex-1">
          {name}
        </span>
        <HealthPill tone={tone}>{state}</HealthPill>
        <span className="shrink-0 text-[11px] text-muted-foreground">{relative(lastRunAt)}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {processed} ok · {failed} falha{failed === 1 ? "" : "s"}
        </span>
      </div>
      {reason && (
        <p className="mt-1 truncate text-[11px] text-muted-foreground">Motivo: {reason}</p>
      )}
    </li>
  );
}

function relative(value: string | null) {
  if (!value) return "sem execução";
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return "sem execução";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} d`;
}
