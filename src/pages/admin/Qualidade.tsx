import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Copy, FlaskConical } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SyntheticRunPanel } from "@/components/admin/SyntheticRunPanel";
import { dayFull, dayTick, xAxisProps } from "@/lib/admin/chartFormat";
import {
  AREA_LABEL, PERSONA_LABEL, STYLE_LABEL, VERDICT_LABEL, compareRuns, pct, qualityHeadline,
  REAL_WEEKS, groupFailures, summarizeReal, useQualityResults, useQualityRuns, useRealQuality, type FailureGroup, type GroupStat, type QualityResult, type QualityRun, type RealWeek,
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

function Conversation({ f }: { f: QualityResult }) {
  return (
    <div className="space-y-1 rounded-xl bg-muted/30 p-2.5 text-xs">
      {f.turns.map((t, k) => (
        <div key={k}><p><span className="font-semibold">Pessoa:</span> {t}</p><p className="whitespace-pre-wrap"><span className="font-semibold">Nino:</span> {f.replies[k]}</p></div>
      ))}
      <button type="button" className="inline-flex items-center gap-1 pt-1 text-primary hover:underline" onClick={() => void navigator.clipboard?.writeText(`${f.scenario_id} | ${f.persona_id} | ${f.style}\nMotivo: ${f.why}\n${f.turns.map((t, k) => `Pessoa: ${t}\nNino: ${f.replies[k] ?? ""}`).join("\n")}`)}><Copy size={12} aria-hidden />Copiar conversa</button>
    </div>
  );
}

function GroupRow({ g }: { g: FailureGroup }) {
  const first = g.examples[0];
  return (
    <details className="group rounded-xl border px-3 py-2 text-xs" data-testid="failure-group">
      <summary className="cursor-pointer list-none">
        <p className="font-semibold">{AREA_LABEL[g.area ?? ""] ?? g.area} · {g.count} {g.count === 1 ? "caso" : "casos"}</p>
        <p className="text-muted-foreground">{first?.turns[0] ? `Ex.: “${first.turns[0]}”` : ""}{g.why ? ` — ${g.why}` : ""}</p>
        <p className="text-muted-foreground">{g.personas.map((p) => PERSONA_LABEL[p] ?? p).join(", ")}</p>
      </summary>
      <div className="mt-2 space-y-2">
        {g.examples.map((f, i) => <Conversation key={i} f={f} />)}
        {g.count > g.examples.length ? <p className="text-muted-foreground">Mostrando {g.examples.length} de {g.count}.</p> : null}
      </div>
    </details>
  );
}

function FailuresSection({ results, loading }: { results: QualityResult[] | undefined; loading: boolean }) {
  const groups = useMemo(() => groupFailures(results), [results]);
  const byVerdict = (v: string[]) => groups.filter((g) => v.includes(g.verdict));
  const blocks = [
    { title: "Respondeu errado", items: byVerdict(["WRONG"]), tone: "border-destructive/50" },
    { title: "Não respondeu ou falhou", items: byVerdict(["MISS", "INFRA", "UNVERIFIED"]), tone: "" },
  ];
  return (
    <section className="space-y-2" data-testid="failures" aria-label="O que falhou nesta rodada">
      <h2 className="text-sm font-semibold">O que falhou nesta rodada</h2>
      {loading ? <p className="text-xs text-muted-foreground">Carregando…</p> : null}
      {!loading && !groups.length ? <p className="rounded-2xl border p-4 text-xs text-muted-foreground">Nada falhou na rodada selecionada.</p> : null}
      {blocks.filter((b) => b.items.length).map((b) => (
        <details key={b.title} className={`rounded-2xl border p-3 ${b.tone}`} data-testid="failure-block">
          <summary className="cursor-pointer list-none text-sm font-semibold">{b.title} <span className="font-normal text-muted-foreground">({b.items.reduce((s, g) => s + g.count, 0)} casos em {b.items.length} problemas)</span></summary>
          <div className="mt-2 space-y-2">{b.items.map((g) => <GroupRow key={g.key} g={g} />)}</div>
        </details>
      ))}
    </section>
  );
}

function RealTraffic({ weeks }: { weeks: RealWeek[] | undefined }) {
  const total = summarizeReal(weeks);
  const rate = (n: number) => pct(n / Math.max(1, total.respostas));
  return (
    <section className="rounded-2xl border p-4 space-y-2" data-testid="real-traffic">
      <h2 className="text-sm font-semibold">Clientes reais: últimas {REAL_WEEKS} semanas</h2>
      <p className="text-xs text-muted-foreground">Não é taxa de acerto (no uso real não há gabarito). Só mostra respostas com falha técnica, recusa ou pedido de esclarecimento. Contas de teste e o simulador ficam de fora.</p>
      {total.respostas ? (
        <p className="text-sm" data-testid="real-summary">{total.respostas} respostas · falha técnica {rate(total.falhas)} · recusa {rate(total.recusas)} · pediu esclarecimento {rate(total.esclarecimentos)}</p>
      ) : <p className="text-xs text-muted-foreground">Sem respostas no período.</p>}
      {total.respostas ? (
        <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="py-1">Semana</th><th>Respostas</th><th>Falha</th><th>Recusa</th><th>Esclarec.</th></tr></thead>
          <tbody>{(weeks ?? []).map((w) => (<tr key={w.semana} className="border-t"><td className="py-1">{dayTick(w.semana)}</td><td className="tabular-nums">{w.respostas}</td>
            <td className="tabular-nums">{pct(w.falhas / Math.max(1, w.respostas))}</td><td className="tabular-nums">{pct(w.recusas / Math.max(1, w.respostas))}</td><td className="tabular-nums">{pct(w.esclarecimentos / Math.max(1, w.respostas))}</td></tr>))}</tbody></table>
      ) : null}
    </section>
  );
}

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

      <SyntheticRunPanel />

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
        {synthetic[0]?.summary.degraded ? (
          <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs" data-testid="degraded-note">
            {synthetic[0].summary.degraded} conversas rodaram com o provedor de IA degradado (limite de tokens por minuto ou falha), e {synthetic[0].summary.fail_in_degraded ?? 0} das falhas estão entre elas. Rode de novo mais devagar antes de concluir que o erro é do Nino.
          </p>
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

      <FailuresSection results={failuresQ.data} loading={failuresQ.isLoading} />

      <RealTraffic weeks={realQ.data} />
    </div>
  );
}
