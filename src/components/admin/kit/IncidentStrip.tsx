import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import type { AdminIncident, IncidentSeverity } from "@/components/admin/AttentionCard";
import { SidePanel } from "@/components/admin/kit/SidePanel";

/**
 * Alertas compactos: uma faixa com rolagem lateral no celular e grade no
 * desktop. O detalhe completo abre em painel lateral, nunca na tela inteira.
 */

const TONE: Record<IncidentSeverity, { chip: string; ring: string; icon: typeof AlertTriangle; label: string }> = {
  critical: {
    chip: "bg-destructive/10 text-destructive border-destructive/30",
    ring: "border-destructive/30",
    icon: AlertOctagon,
    label: "Agir agora",
  },
  warning: {
    chip: "bg-warning/15 text-warning-foreground border-warning/40",
    ring: "border-warning/40",
    icon: AlertTriangle,
    label: "Observar",
  },
  healthy: {
    chip: "bg-success/10 text-success border-success/25",
    ring: "border-border",
    icon: CheckCircle2,
    label: "Saudável",
  },
};

const ORDER: IncidentSeverity[] = ["critical", "warning", "healthy"];

function formatWhen(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

export function IncidentStrip({
  incidents,
  emptyLabel = "Nada exige ação agora.",
}: {
  incidents: AdminIncident[];
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState<AdminIncident | null>(null);
  const sorted = [...incidents].sort(
    (a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity),
  );

  if (sorted.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        <CheckCircle2 size={14} aria-hidden className="text-success" />
        {emptyLabel}
      </p>
    );
  }

  return (
    <>
      <ul
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 xl:grid-cols-3"
        aria-label="Alertas que precisam de atenção"
      >
        {sorted.map((incident) => {
          const tone = TONE[incident.severity];
          const Icon = tone.icon;
          return (
            <li
              key={incident.id}
              className="min-w-[240px] max-w-[280px] shrink-0 snap-start md:min-w-0 md:max-w-none"
            >
              <button
                type="button"
                onClick={() => setOpen(incident)}
                className={`flex h-full w-full flex-col gap-2 rounded-2xl border bg-card p-3 text-left shadow-sm transition hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/40 ${tone.ring}`}
              >
                <span
                  className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone.chip}`}
                >
                  <Icon size={11} aria-hidden />
                  {tone.label}
                </span>
                <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                  {incident.title}
                </span>
                <span className="mt-auto inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                  {incident.action?.label ?? "Ver detalhe"}
                  <ChevronRight size={12} aria-hidden />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <SidePanel
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open?.title ?? ""}
        description={open ? TONE[open.severity].label : undefined}
        footer={
          open?.action?.to ? (
            <Link
              to={open.action.to}
              onClick={() => setOpen(null)}
              className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
            >
              {open.action.label}
              <ChevronRight size={14} aria-hidden />
            </Link>
          ) : undefined
        }
      >
        {open && (
          <div className="space-y-3 text-sm">
            {open.impact && <p className="text-muted-foreground">{open.impact}</p>}
            {open.probableCause && (
              <p className="text-xs text-muted-foreground">Provável causa: {open.probableCause}</p>
            )}
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              {open.startedAt && <li>Começou em {formatWhen(open.startedAt)}</li>}
              {open.affectedClients != null && <li>{open.affectedClients} cliente(s) afetado(s)</li>}
              {open.lastCheckedAt && <li>Verificado às {formatWhen(open.lastCheckedAt)}</li>}
            </ul>
            {open.technical && (
              <div className="rounded-2xl border border-border/70 bg-secondary/40 p-3 text-[11px] text-muted-foreground">
                {open.technical}
              </div>
            )}
          </div>
        )}
      </SidePanel>
    </>
  );
}
