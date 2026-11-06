import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, CircleDashed, Info, Siren } from "lucide-react";
import { GROUP_ORDER, STATUS_LABEL, healthHeadline, summarizeHealth, useFeatureHealth, type HealthRow, type HealthStatus } from "@/lib/admin/featureHealth";

const TONE: Record<HealthStatus, string> = {
  crit: "border-destructive/40 bg-destructive/5",
  warn: "border-warning/50 bg-warning/5",
  info: "border-border bg-muted/30",
  ok: "border-border",
  nodata: "border-dashed border-border bg-muted/20",
};

function StatusIcon({ status }: { status: HealthStatus }) {
  if (status === "crit") return <Siren size={16} className="shrink-0 text-destructive" aria-hidden />;
  if (status === "warn") return <AlertTriangle size={16} className="shrink-0 text-warning" aria-hidden />;
  if (status === "ok") return <CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden />;
  if (status === "info") return <Info size={16} className="shrink-0 text-muted-foreground" aria-hidden />;
  return <CircleDashed size={16} className="shrink-0 text-muted-foreground" aria-hidden />;
}

/** Cartão de uma feature: estado, número, o que significa e o que fazer. Só mostra "o que fazer" quando há o que fazer. */
export function HealthCard({ row }: { row: HealthRow }) {
  const needsAction = row.status === "crit" || row.status === "warn";
  return (
    <li className={`rounded-2xl border px-3.5 py-3 ${TONE[row.status]}`} data-testid={`health-${row.key}`} data-status={row.status}>
      <div className="flex items-start gap-2.5">
        <StatusIcon status={row.status} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold leading-snug">{row.title}</p>
          <p className="text-xs text-muted-foreground">{row.question}</p>
          {row.value ? (
            <p className="text-sm">
              <span className="font-semibold tabular-nums">{row.value}</span>
              {row.reference ? <span className="text-xs text-muted-foreground"> · {row.reference}</span> : null}
            </p>
          ) : null}
          {row.detail ? <p className="text-xs text-muted-foreground">{row.detail}</p> : null}
          {needsAction && row.action ? (
            <p className="rounded-xl bg-background/70 px-2.5 py-1.5 text-xs"><span className="font-semibold">O que fazer: </span>{row.action}</p>
          ) : null}
          {needsAction && row.link ? (
            <Link to={row.link} className="inline-block text-xs font-semibold text-primary hover:underline">Abrir a tela relacionada</Link>
          ) : null}
        </div>
        <span className="sr-only">{STATUS_LABEL[row.status]}</span>
      </div>
    </li>
  );
}

/** Página completa: o que exige ação primeiro; o que está bem e o que ainda não dá para medir, recolhidos. */
export function FeatureHealthPanel() {
  const { data, isLoading, isError } = useFeatureHealth();
  if (isLoading) return <p className="text-sm text-muted-foreground">Calculando a saúde das features…</p>;
  if (isError || !data) return <p role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">Não consegui calcular a saúde das features agora. Isso em si já é um sinal: tente de novo em instantes.</p>;
  const s = summarizeHealth(data.rows);
  const byGroup = (rows: HealthRow[]) => GROUP_ORDER.map((g) => ({ g, rows: rows.filter((r) => r.group === g) })).filter((x) => x.rows.length);

  return (
    <div className="space-y-5" data-testid="feature-health-panel">
      <p className={`rounded-2xl px-4 py-3 text-sm font-semibold ${s.critical ? "bg-destructive/10 text-destructive" : s.attention.length ? "bg-warning/10" : "bg-success/10 text-success"}`}>
        {healthHeadline(s)}
      </p>

      {s.attention.length > 0 && (
        <section aria-label="Precisa de ação" className="space-y-2">
          <h2 className="font-display text-sm font-semibold">Precisa de ação</h2>
          <ul className="space-y-2">{s.attention.map((r) => <HealthCard key={r.key} row={r} />)}</ul>
        </section>
      )}

      {byGroup([...s.working, ...s.informative]).map(({ g, rows }) => (
        <section key={g} aria-label={g} className="space-y-2">
          <h2 className="font-display text-sm font-semibold">{g}</h2>
          <ul className="space-y-2">{rows.map((r) => <HealthCard key={r.key} row={r} />)}</ul>
        </section>
      ))}

      {s.nodata.length > 0 && (
        <details className="rounded-2xl border border-dashed border-border px-3.5 py-3">
          <summary className="cursor-pointer text-sm font-semibold">Ainda sem dados suficientes ({s.nodata.length})</summary>
          <p className="mt-1 text-xs text-muted-foreground">Estas features têm pouco volume para medir. Elas não aparecem como verdes nem como vermelhas: viram alerta assim que houver amostra.</p>
          <ul className="mt-2 space-y-2">{s.nodata.map((r) => <HealthCard key={r.key} row={r} />)}</ul>
        </details>
      )}

      <p className="text-[11px] text-muted-foreground">Atualizado em {new Date(data.generated_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · confere a cada 5 minutos e avisa no painel, no app e no WhatsApp.</p>
    </div>
  );
}

/** Faixa curta para a Visão geral: some quando está tudo bem, para não virar ruído. */
export function FeatureHealthStrip() {
  const { data } = useFeatureHealth();
  if (!data) return null;
  const s = summarizeHealth(data.rows);
  if (s.attention.length === 0) return null;
  return (
    <section role="alert" data-testid="feature-health-strip" className={`rounded-2xl border px-4 py-3 ${s.critical ? "border-destructive/40 bg-destructive/10" : "border-warning/50 bg-warning/10"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{healthHeadline(s)}</p>
        <Link to="/admin/saude" className="text-xs font-semibold text-primary hover:underline">Ver saúde das features</Link>
      </div>
      <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
        {s.attention.slice(0, 3).map((r) => <li key={r.key}>• {r.title}: {r.value}</li>)}
      </ul>
    </section>
  );
}
