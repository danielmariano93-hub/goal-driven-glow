import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { AlertTriangle, AlertOctagon, CheckCircle2, ChevronRight, Eye } from "lucide-react";
import { useState } from "react";

export type IncidentSeverity = "critical" | "warning" | "healthy";

export type AdminIncident = {
  id: string;
  /** O que aconteceu, em linguagem de negócio. */
  title: string;
  /** Por que isso importa. */
  impact?: string;
  startedAt?: string | null;
  affectedClients?: number | null;
  probableCause?: string;
  lastCheckedAt?: string | null;
  severity: IncidentSeverity;
  action?: { label: string; to?: string; onClick?: () => void };
  /** Contexto técnico opcional, exibido só sob demanda. */
  technical?: ReactNode;
};

const TONE: Record<IncidentSeverity, { ring: string; text: string; icon: typeof AlertTriangle; label: string }> = {
  critical: {
    ring: "border-rose-300/70 bg-rose-50/70",
    text: "text-rose-700",
    icon: AlertOctagon,
    label: "Ação necessária",
  },
  warning: {
    ring: "border-amber-300/70 bg-amber-50/70",
    text: "text-amber-700",
    icon: AlertTriangle,
    label: "Em observação",
  },
  healthy: {
    ring: "border-border bg-card",
    text: "text-emerald-700",
    icon: CheckCircle2,
    label: "Saudável",
  },
};

function formatWhen(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

export function AttentionCard({ incident }: { incident: AdminIncident }) {
  const tone = TONE[incident.severity];
  const Icon = tone.icon;
  const started = formatWhen(incident.startedAt);
  const checked = formatWhen(incident.lastCheckedAt);

  const meta = [
    started ? `Começou em ${started}` : null,
    incident.affectedClients != null ? `${incident.affectedClients} cliente(s) afetado(s)` : null,
    checked ? `Verificado às ${checked}` : null,
  ].filter(Boolean) as string[];

  const actionClasses =
    "inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary/40";

  return (
    <article className={`rounded-3xl border p-4 shadow-sm ${tone.ring}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 shrink-0 ${tone.text}`}>
          <Icon size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{incident.title}</p>
          {incident.impact && (
            <p className="mt-1 text-xs text-muted-foreground">{incident.impact}</p>
          )}
          {incident.probableCause && (
            <p className="mt-1 text-xs text-muted-foreground">
              Provável causa: {incident.probableCause}
            </p>
          )}
          {meta.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">{meta.join(" · ")}</p>
          )}
        </div>
      </div>

      {(incident.action || incident.technical) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {incident.action?.to && (
            <Link to={incident.action.to} className={actionClasses}>
              {incident.action.label}
              <ChevronRight size={14} aria-hidden />
            </Link>
          )}
          {!incident.action?.to && incident.action?.onClick && (
            <button type="button" onClick={incident.action.onClick} className={actionClasses}>
              {incident.action.label}
            </button>
          )}
          {incident.technical && <TechnicalToggle>{incident.technical}</TechnicalToggle>}
        </div>
      )}
    </article>
  );
}

function TechnicalToggle({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-2 text-xs font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Eye size={13} aria-hidden />
        Detalhes técnicos
      </button>
      {open && (
        <div className="mt-2 w-full rounded-2xl border border-border/70 bg-secondary/40 p-3 text-[11px] text-muted-foreground">
          {children}
        </div>
      )}
    </>
  );
}

/**
 * Agrupa incidentes por severidade. Estados saudáveis ocupam menos espaço:
 * vêm recolhidos em uma linha única.
 */
export function IncidentGroup({
  severity,
  incidents,
  emptyLabel,
}: {
  severity: IncidentSeverity;
  incidents: AdminIncident[];
  emptyLabel?: string;
}) {
  const tone = TONE[severity];
  const [open, setOpen] = useState(severity !== "healthy");

  if (incidents.length === 0) {
    if (!emptyLabel) return null;
    return (
      <p className="rounded-2xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mb-2 flex w-full items-center justify-between gap-2 text-left focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <h3 className={`text-xs font-semibold uppercase tracking-wider ${tone.text}`}>
          {tone.label} · {incidents.length}
        </h3>
        <ChevronRight
          size={14}
          aria-hidden
          className={`text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-3">
          {incidents.map((incident) => (
            <AttentionCard key={incident.id} incident={incident} />
          ))}
        </div>
      )}
    </section>
  );
}
