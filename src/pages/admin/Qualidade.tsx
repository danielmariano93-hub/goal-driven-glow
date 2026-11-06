import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Copy, FlaskConical } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { dayFull, dayTick, xAxisProps } from "@/lib/admin/chartFormat";
import {
  AREA_LABEL, PERSONA_LABEL, STYLE_LABEL, VERDICT_LABEL, compareRuns, pct, qualityHeadline,
  useQualityResults, useQualityRuns, useRealQuality, type GroupStat, type QualityRun,
} from "@/lib/admin/qualidade";

function Bars({ data, labels }: { data?: Record<string, GroupStat>; labels: Record<string, string> }) {
  const rows = Object.entries(data ?? {}).map(([k, g]) => ({ k, label: labels[k] ?? k, rate: g.total ? g.ok / g.total : 0, ...g })).sort((a, b) => a.rate - b.rate);
  if (!rows.length) return <p className="text-xs text-muted-foreground">Sem dados.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.k} className="text-xs">
          <div className="flex justify-between gap-2"><span>{r.label}</span><span className="tabular-nums text-muted-foreground">{pct(r.rate)} · {r.ok}/{r.total}{r.wrong ? ` · ${r.wrong} errada${r.wrong > 1 ? "s" : ""}` : ""}</span></div>
          <div className="mt-0.5 h-1.5 rounded-full bg-muted"><div className={`h-full rounded-full ${r.wrong ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.round(r.rate * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

const runName = (r: QualityRun) => `${r.label} · ${new Date(r.started_at).toLocaleDateString("pt-BR")} · ${pct(r.summary.ok_rate)}`;

export default function Qualidade() {
  const runsQ = useQualityRuns();
  const realQ = useRealQuality();
  const synthetic = useMemo(() => (runsQ.data ?? []).filter((r) => r.suite === "synthetic" && r.finished_at), [runsQ.data]);
  const [afterId, setAfterId] = useState<string | null>(null);
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const after = synthetic.find((r) => r.id === afterId) ?? synthetic[0];
  const before = synthetic.find((r) => r.id === beforeId) ?? synthetic[synthetic.length - 1];
  const failuresQ = useQualityResults(after?.id ?? null, true);
  const trend = useMemo(() => [...synthetic].reverse().map((r) => ({ dia: r.started_at.slice(0, 10), taxa: Math.round((r.summary.ok_rate ?? 0) * 1000) / 10 })), [synthetic]);
  const deltas = after && before && after.id !== before.id ? compareRuns(before.summary, after.summary) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Qualidade das respostas" description="Conversas simuladas com contas de teste, com gabarito calculado dos próprios dados. Mostra o que o Nino acerta e erra antes de um cliente real passar por isso." />

      <section className="rounded-2xl border p-4 space-y-2" data-testid="quality-headline">
        <div className="flex items-center gap-2"><FlaskConical size={16} aria-hidden /><h2 className="text-sm font-semibold">Última rodada</h2></div>
        <p className="text-sm">{qualityHeadline(synthetic[0])}</p>
        {synthetic[0] ? (
          <dl className="grid grid-cols-2 gap-3 pt-1 text-xs sm:grid-cols-4">
            <div><dt className="text-muted-foreground">Acertos</dt><dd className="text-lg font-semibold tabular-nums">{pct(synthetic[0].summary.ok_rate)}</dd></div>
            <div><dt className="text-muted-foreground">Respostas erradas</dt><dd className={`text-lg font-semibold tabular-nums ${synthetic[0].summary.wrong ? "text-destructive" : ""}`}>{synthetic[0].summary.wrong ?? 0}</dd></div>
            <div><dt className="text-muted-foreground">Acerta sempre (3 tentativas)</dt><dd className="text-lg font-semibold tabular-nums">{pct(synthetic[0].summary.consistency)}</dd></div>
            <div><dt className="text-muted-foreground">Naturalidade das respostas</dt><dd className="text-lg font-semibold tabular-nums">{pct(synthetic[0].summary.natural_avg)}</dd></div>
          </dl>
        ) : null}
      </section>

      {trend.length > 1 ? (
        <section className="rounded-2xl border p-4" aria-label="Evolução da taxa de acerto">
          <h2 className="mb-2 text-sm font-semibold">Evolução do acerto por rodada</h2>
          <div className="h-48"><ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="dia" tickFormatter={dayTick} {...xAxisProps(trend.length)} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={44} />
              <Tooltip labelFormatter={dayFull} formatter={(v: number) => [`${v}%`, "Acerto"]} />
              <Line type="monotone" dataKey="taxa" stroke="hsl(var(--primary))" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer></div>
        </section>
      ) : null}

      {synthetic.length > 1 ? (
        <section className="rounded-2xl border p-4 space-y-3" data-testid="before-after">
          <h2 className="text-sm font-semibold">Antes e depois</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs">Antes<select className="mt-1 w-full rounded-lg border bg-background p-2 text-sm" value={before?.id} onChange={(e) => setBeforeId(e.target.value)}>{synthetic.map((r) => <option key={r.id} value={r.id}>{runName(r)}</option>)}</select></label>
            <label className="text-xs">Depois<select className="mt-1 w-full rounded-lg border bg-background p-2 text-sm" value={after?.id} onChange={(e) => setAfterId(e.target.value)}>{synthetic.map((r) => <option key={r.id} value={r.id}>{runName(r)}</option>)}</select></label>
          </div>
          {deltas.length ? (
            <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="py-1">Área</th><th>Antes</th><th>Depois</th><th>Diferença</th></tr></thead>
              <tbody>{deltas.map((d) => (<tr key={d.label} className="border-t"><td className="py-1">{d.label}</td><td className="tabular-nums">{pct(d.before)}</td><td className="tabular-nums">{pct(d.after)}</td>
                <td className={`tabular-nums ${d.diff == null ? "" : d.diff > 0.5 ? "text-success" : d.diff < -0.5 ? "text-destructive" : ""}`}>{d.diff == null ? "—" : `${d.diff > 0 ? "+" : ""}${d.diff.toFixed(1)} pontos`}</td></tr>))}</tbody></table>
          ) : <p className="text-xs text-muted-foreground">Escolha duas rodadas diferentes.</p>}
        </section>
      ) : null}

      {after ? (
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border p-4"><h2 className="mb-2 text-sm font-semibold">Por assunto</h2><Bars data={after.summary.by_area} labels={AREA_LABEL} /></div>
          <div className="rounded-2xl border p-4"><h2 className="mb-2 text-sm font-semibold">Por tipo de cliente</h2><Bars data={after.summary.by_persona} labels={PERSONA_LABEL} /></div>
          <div className="rounded-2xl border p-4"><h2 className="mb-2 text-sm font-semibold">Por jeito de escrever</h2><Bars data={after.summary.by_style} labels={STYLE_LABEL} /></div>
        </section>
      ) : null}

      <section className="rounded-2xl border p-4 space-y-3" data-testid="failures">
        <h2 className="text-sm font-semibold">O que falhou nesta rodada</h2>
        {failuresQ.isLoading ? <p className="text-xs text-muted-foreground">Carregando…</p> : null}
        {!failuresQ.isLoading && !(failuresQ.data ?? []).length ? <p className="text-xs text-muted-foreground">Nada falhou na rodada selecionada.</p> : null}
        <ul className="space-y-2">
          {(failuresQ.data ?? []).sort((a, b) => (a.verdict === "WRONG" ? -1 : 0) - (b.verdict === "WRONG" ? -1 : 0)).slice(0, 60).map((f, i) => (
            <li key={`${f.scenario_id}-${f.persona_id}-${i}`} className={`rounded-xl border p-3 text-xs ${f.verdict === "WRONG" ? "border-destructive/50 bg-destructive/5" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{VERDICT_LABEL[f.verdict] ?? f.verdict} · {AREA_LABEL[f.area ?? ""] ?? f.area} · {PERSONA_LABEL[f.persona_id ?? ""] ?? f.persona_id}</p>
                <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => void navigator.clipboard?.writeText(`${f.scenario_id} | ${f.persona_id} | ${f.style}\nMotivo: ${f.why}\n${f.turns.map((t, k) => `Pessoa: ${t}\nNino: ${f.replies[k] ?? ""}`).join("\n")}`)}><Copy size={12} aria-hidden />Copiar conversa</button>
              </div>
              <p className="mt-1 text-muted-foreground">{f.why}</p>
              <div className="mt-2 space-y-1">{f.turns.map((t, k) => (<div key={k}><p><span className="font-semibold">Pessoa:</span> {t}</p><p className="whitespace-pre-wrap"><span className="font-semibold">Nino:</span> {f.replies[k]}</p></div>))}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border p-4 space-y-2" data-testid="real-traffic">
        <h2 className="text-sm font-semibold">Clientes reais: sinais nas respostas enviadas</h2>
        <p className="text-xs text-muted-foreground">Não é taxa de acerto (no uso real não há gabarito). Mostra a parte das respostas com falha técnica, recusa ou pedido de esclarecimento. Contas de teste ficam de fora.</p>
        <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="py-1">Semana</th><th>Respostas</th><th>Falha técnica</th><th>Recusa</th><th>Pediu esclarecimento</th></tr></thead>
          <tbody>{(realQ.data ?? []).map((w) => (<tr key={w.semana} className="border-t"><td className="py-1">{dayTick(w.semana)}</td><td className="tabular-nums">{w.respostas}</td>
            <td className="tabular-nums">{pct(w.falhas / Math.max(1, w.respostas))}</td><td className="tabular-nums">{pct(w.recusas / Math.max(1, w.respostas))}</td><td className="tabular-nums">{pct(w.esclarecimentos / Math.max(1, w.respostas))}</td></tr>))}</tbody></table>
      </section>
    </div>
  );
}
