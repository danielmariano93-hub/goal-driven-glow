import { useId, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowDownLeft, BarChart3, CalendarClock, CalendarDays, CheckCircle2, Coins, CreditCard, Eye, HandCoins, Landmark, Layers,
  LineChart, PiggyBank, Repeat, Search, Sparkles, Target, TrendingDown, TrendingUp, Wallet, Zap,
} from "lucide-react";
import type { BehaviorV2, CompareKind, EvolutionV2, OverviewV2, ProjectionsV2, QualityNote, Recommendation, ReportMeta, ReportV2 } from "@/lib/engine/reportV2";
import { categoryIcon } from "@/components/reports/format";
import { useRecommendationAction } from "@/lib/reports/recommendationActions";
import { COMPARE_CHOICES } from "@/lib/reports/reportV2Client";
import { cn } from "@/lib/utils";
import {
  ActionCard, ChartReadout, Chip, ContextNotice, DetailLink, DisclosureSheet, IconBadge, LedgerLines, Legend, MetricTile, Money, Panel, RankedRows, TONE, smoothPath,
  brl0, brl2, ddmm, mon, monthFull, pct0, signed0, useSheet,
} from "./ui";

// As quatro abas, na ordem do handoff de design. Tudo vem calculado do servidor (report_v2); aqui só se arruma.

const CLASS_LABEL = { estrutural: "Fixos", ajustavel: "Ajustáveis", extraordinario: "Extraordinários", nao_classificado: "Sem categoria" } as const;

// ---------------------------------------------------------------------------
// Visão geral — entender em 5 segundos
// ---------------------------------------------------------------------------

export function OverviewTab({ rep, onTab }: { rep: ReportV2; onTab: (t: "comportamento" | "projecoes" | "evolucao") => void }) {
  const o = rep.overview;
  const sheet = useSheet();
  if (!o) return <EmptyMonth />;
  const h = o.habitual;
  const warn = rep.quality.find((q) => q.level === "warn" && ["uncategorized"].includes(q.code)) ?? rep.quality.find((q) => q.code === "debt_unsplit");
  const top = o.causes[0];
  const bigDrop = rep.isCurrentMonth && h?.deltaPct != null && h.deltaPct < -0.3;
  return (
    <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
      {/* Hero: KPI dominante e comparação à direita */}
      <section aria-label="Consumo do mês" className="rounded-[24px] border border-border/60 bg-card p-5 shadow-[0_1px_2px_rgba(33,22,79,0.04),0_12px_32px_-16px_rgba(109,59,255,0.18)] lg:col-span-2">
        <div className="flex items-start gap-3">
          <IconBadge icon={BarChart3} />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-5 text-muted-foreground">Você consumiu{rep.isCurrentMonth ? ` até o dia ${o.windowDays}` : ""}</p>
            <Money value={o.consumption} size="hero" className="mt-0.5" />
          </div>
          {h?.deltaPct != null ? (
            <div className="shrink-0 text-right">
              <Chip ratio={h.deltaPct} base="seu habitual" />
              <p className="mt-1.5 text-xs leading-4 text-muted-foreground">habitual<br /><span className="font-semibold text-foreground tabular-nums">{brl0(h.value)}</span></p>
            </div>
          ) : null}
        </div>
        {warn ? (
          <button type="button" onClick={() => sheet.show("quality")} className="mt-2 flex min-h-[44px] items-center gap-1.5 text-left text-xs leading-4 text-[#B7791F]">
            <AlertTriangle size={14} className="shrink-0" aria-hidden />{warn.code === "debt_unsplit" ? "Dívidas sem juros informados: o consumo pode estar subestimado" : "Gastos sem categoria reduzem a precisão"}
          </button>
        ) : null}
        <button type="button" onClick={() => sheet.show("composition")} className="mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-primary print:hidden">Entender composição</button>
      </section>

      {/* Dois KPIs em linha */}
      <div className="grid grid-cols-2 gap-3 lg:col-span-2">
        <MetricTile icon={ArrowDownLeft} label="Receitas" value={brl0(o.income.realized)} sub={o.income.incomplete ? "renda do mês ainda não entrou" : "realizadas no mês"} />
        <MetricTile icon={Wallet} label="Saldo disponível" value={o.balance.available != null ? brl0(o.balance.available) : "Indisponível"} sub={o.balance.available != null ? "agora, nas contas" : "aguarda atualização"} tone={o.balance.available == null ? "muted" : undefined} />
      </div>
      {/* Resultado em faixa discreta */}
      <p className="rounded-xl bg-secondary/60 px-3.5 py-2.5 text-sm leading-5 lg:col-span-2">
        Resultado {o.result.partial ? "parcial" : "do mês"}: <b className={cn("tabular-nums", !o.result.partial && o.result.value < 0 && TONE.risk)}>{signed0(o.result.value)}</b>
        <span className="text-muted-foreground"> · receitas − consumo</span>
      </p>

      {o.income.incomplete && o.income.expected ? (
        <div className="lg:col-span-2">
          <ContextNotice icon={CalendarClock} title={`Renda prevista em ${ddmm(o.income.expected.date)}: ${brl0(o.income.expected.amount)}`} text={bigDrop ? "Parte da queda pode refletir contas que ainda não venceram." : "O resultado fecha quando ela entrar."} />
        </div>
      ) : bigDrop ? <div className="lg:col-span-2"><ContextNotice icon={CalendarClock} title="Parte da queda pode ser calendário" text="Contas do mês ainda vão vencer." /></div> : null}

      <CurvePanel o={o} isCurrent={rep.isCurrentMonth} />

      <div className="space-y-3">
        {top ? (
          <Panel title="O que mais mudou" scope={`Contra o seu habitual · mesmos dias · ${h?.months.length ?? 0} meses`} icon={TrendingUp}>
            <p className="flex items-baseline justify-between text-sm leading-5"><span className="font-semibold">{top.name}</span><span className={cn("font-bold tabular-nums", top.impact > 0 ? TONE.risk : "")}>{signed0(top.impact)}</span></p>
            {top.impact < 0 && top.klass === "estrutural" ? <p className="text-xs leading-4 text-muted-foreground">Gasto fixo: pode ser só uma conta que ainda não venceu.</p> : null}
            <DetailLink onClick={() => onTab("comportamento")}>Ver fatores de mudança</DetailLink>
          </Panel>
        ) : null}
        {rep.behavior && rep.behavior.categories.length > 0 ? (
          <Panel title="Principais categorias" scope="Participação no consumo do mês" icon={Layers}>
            <RankedRows rows={rep.behavior.categories.slice(0, 3).map((c) => ({ key: c.name, icon: categoryIcon(c.name), label: c.name, value: brl0(c.total), bar: { ratio: c.share }, detail: `${Math.round(c.share * 100)}% do consumo` }))} />
            <DetailLink onClick={() => onTab("comportamento")}>Ver categorias</DetailLink>
          </Panel>
        ) : null}
      </div>

      <DisclosureSheet {...sheet.props("composition")} title="Composição do consumo" description="De onde vem o número e o que fica de fora.">
        <LedgerLines lines={[{ label: "Despesas do período", value: brl2(o.reconciliation.gross) }, ...(o.reconciliation.refunds > 0 ? [{ label: "Estornos e reembolsos", value: brl2(o.reconciliation.refunds), sign: "−" as const }] : [])]} total={{ label: "Consumo", value: brl2(o.consumption) }} />
        {o.debt.items.length > 0 ? (
          <div className="mt-4">
            <p className="font-semibold">Fora do consumo: dívida paga {brl2(o.debt.paid)}</p>
            <ul className="mt-1 space-y-1 text-xs leading-4 text-muted-foreground">{o.debt.items.map((d, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{ddmm(d.date)} · {d.label}{d.split ? "" : " · juros não informados"}</span><span className="tabular-nums">{brl2(d.amount)}</span></li>)}</ul>
          </div>
        ) : null}
        {o.cashBridge ? (
          <div className="mt-4">
            <p className="font-semibold">Ponte do caixa no mês</p>
            <div className="mt-1">
              <LedgerLines lines={[
                { label: "Saldo no início do mês (derivado)", value: brl2(o.cashBridge.opening) },
                ...o.cashBridge.inflows.map((i) => ({ label: i.label, value: brl2(i.amount), sign: "+" as const })),
                ...o.cashBridge.outflows.map((x) => ({ label: x.label, value: brl2(x.amount), sign: "−" as const })),
              ]} total={{ label: "Saldo hoje", value: brl2(o.cashBridge.closing) }} />
            </div>
            <p className="mt-1 text-xs leading-4 text-muted-foreground">O saldo inicial é derivado (saldo de hoje − movimento do mês). Entradas de fora e empréstimos movem o caixa, mas não são receita.</p>
          </div>
        ) : null}
        <p className="mt-4 text-xs leading-4 text-muted-foreground">Compra no cartão conta no mês da fatura; estornos abatem; transferências, fatura paga e aplicações ficam de fora. Juros conhecidos entram; juros desconhecidos não são inventados. Método {rep.meta.formulaVersion}.</p>
      </DisclosureSheet>
      <DisclosureSheet {...sheet.props("quality")} title="Qualidade dos dados">
        <QualityList notes={rep.quality} meta={rep.meta} />
      </DisclosureSheet>
    </div>
  );
}

function CurvePanel({ o, isCurrent }: { o: OverviewV2; isCurrent: boolean }) {
  const pts = o.curve;
  const gid = useId().replace(/:/g, "");
  const [sel, setSel] = useState<number | null>(null);
  if (!pts || pts.length < 2) return null;
  const proj = o.curveProjection;
  const W = 340; const H = 190; const L = 34; const R = 14; const T = 20; const B = 22;
  const lastDay = proj ? proj[proj.length - 1].day : pts[pts.length - 1].day;
  const last = pts[pts.length - 1];
  const maxRaw = Math.max(...pts.map((p) => Math.max(p.current, p.habitual)), ...(proj ? proj.map((p) => p.high) : [0]), 1);
  const step = maxRaw > 12000 ? 4000 : maxRaw > 6000 ? 2000 : maxRaw > 3000 ? 1000 : maxRaw > 1200 ? 500 : 250;
  const max = Math.ceil(maxRaw / step) * step;
  const x = (d: number) => L + ((d - 1) / Math.max(1, lastDay - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const P = (arr: Array<{ day: number; v: number }>) => arr.map((p) => [x(p.day), y(p.v)] as [number, number]);
  // O acumulado diário anda em degraus; para a curva suave, ligamos valores reais a cada 3 dias (o toque mostra o dia exato).
  const sampled = pts.filter((p, i) => i === 0 || i === pts.length - 1 || (p.day - 1) % 3 === 0);
  const real = P(sampled.map((p) => ({ day: p.day, v: p.current })));
  const hab = P(sampled.map((p) => ({ day: p.day, v: p.habitual })));
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const end = proj ? proj[proj.length - 1] : null;
  const s = sel != null ? pts[sel] : null;
  const projPts = proj ? P([{ day: last.day, v: last.current }, ...proj.filter((p) => p.day > last.day).map((p) => ({ day: p.day, v: p.value }))]) : null;
  const bandHi = proj ? P(proj.map((p) => ({ day: p.day, v: p.high }))) : null;
  const bandLo = proj ? P(proj.map((p) => ({ day: p.day, v: p.low }))).reverse() : null;
  return (
    <Panel title="Evolução do consumo" scope="Acumulado no mês, em R$" icon={LineChart} className="lg:row-span-2">
      <Legend items={[{ label: "Real", swatch: "bg-primary" }, { label: "Habitual", swatch: "bg-[#C4B5FD]" }, ...(proj ? [{ label: "Projeção", swatch: "border-primary", dashed: true }] : [])]} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none lg:max-h-[280px]" role="img" aria-label={`Consumo acumulado de ${brl0(last.current)} até o dia ${last.day}, contra ${brl0(last.habitual)} no habitual${end ? `; projeção de ${brl0(end.value)} no fim do mês` : ""}`}
        onPointerDown={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const d = Math.round(((px - L) / (W - L - R)) * (lastDay - 1)) + 1; setSel(Math.max(0, Math.min(pts.length - 1, d - 1))); }}>
        <defs>
          <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6D3BFF" stopOpacity={0.18} /><stop offset="100%" stopColor="#6D3BFF" stopOpacity={0} /></linearGradient>
        </defs>
        {ticks.map((t) => (<g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-border" strokeWidth={0.7} strokeDasharray={t === 0 ? undefined : "2 4"} /><text x={L - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={9.5}>{t >= 1000 ? `${t / 1000}k` : t}</text></g>))}
        {bandHi && bandLo ? <path d={`${smoothPath(bandHi)} ${smoothPath(bandLo, false)} Z`} className="fill-primary/[0.07]" /> : null}
        <path d={smoothPath(hab)} fill="none" stroke="#C4B5FD" strokeWidth={2} strokeLinecap="round" />
        <path d={`${smoothPath(real)} L${real[real.length - 1][0].toFixed(1)} ${y(0).toFixed(1)} L${real[0][0].toFixed(1)} ${y(0).toFixed(1)} Z`} fill={`url(#g${gid})`} />
        {projPts ? <path d={smoothPath(projPts)} fill="none" className="stroke-primary" strokeWidth={2} strokeDasharray="4 5" strokeLinecap="round" opacity={0.8} /> : null}
        <path d={smoothPath(real)} fill="none" className="stroke-primary" strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round" />
        {isCurrent && proj ? <><line x1={x(last.day)} x2={x(last.day)} y1={T - 2} y2={H - B} className="stroke-primary/30" strokeDasharray="2 3" /><text x={x(last.day)} y={T - 8} textAnchor="middle" className="fill-primary" fontSize={9.5} fontWeight={600}>hoje</text></> : null}
        <circle cx={x(last.day)} cy={y(last.current)} r={8} className="fill-primary/15" />
        <circle cx={x(last.day)} cy={y(last.current)} r={4} className="fill-card stroke-primary" strokeWidth={2.4} />
        {s ? <><line x1={x(s.day)} x2={x(s.day)} y1={T} y2={H - B} className="stroke-foreground/20" /><circle cx={x(s.day)} cy={y(s.habitual)} r={3} fill="#C4B5FD" /><circle cx={x(s.day)} cy={y(s.current)} r={4} className="fill-primary stroke-card" strokeWidth={1.5} /></> : null}
        {[1, 8, 15, 22, lastDay].filter((d, i, a) => a.indexOf(d) === i).map((d) => <text key={d} x={x(d)} y={H - 5} textAnchor="middle" className="fill-muted-foreground" fontSize={9.5}>{d}</text>)}
      </svg>
      <ChartReadout>
        {s ? <>Dia {s.day}: <b>{brl0(s.current)}</b> acumulado · habitual {brl0(s.habitual)}</> : end ? <>Hoje <b>{brl0(last.current)}</b> · fim do mês projetado <b>{brl0(end.value)}</b>{Math.round(end.high) > Math.round(end.low) ? ` (faixa histórica ${brl0(end.low)}–${brl0(end.high)})` : ""}. Toque no gráfico para ver um dia.</> : <>Toque no gráfico para ver um dia.</>}
      </ChartReadout>
    </Panel>
  );
}

function EmptyMonth() {
  return <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">Ainda não há movimentações neste mês.</div>;
}

export function QualityList({ notes, meta }: { notes: QualityNote[]; meta: ReportMeta }) {
  return (
    <div className="space-y-3">
      {notes.length === 0 ? <p className="text-muted-foreground">Sem alertas de qualidade neste mês.</p> : notes.map((n) => (
        <div key={n.code}>
          <p className="flex items-start gap-2">{n.level === "warn" ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[#B7791F]" aria-hidden /> : <Eye size={15} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />}<span>{n.text}</span></p>
          {n.affects?.length ? <p className="pl-6 text-xs leading-4 text-muted-foreground">Afeta: {n.affects.join(", ")}.</p> : null}
          {n.fix ? <p className="pl-6 text-xs leading-4 text-muted-foreground">Como corrigir: {n.fix}</p> : null}
        </div>
      ))}
      <div className="border-t border-border pt-3 text-xs leading-4 text-muted-foreground">
        <p>Versão {meta.formulaVersion} · dados até {ddmm(meta.asOf)} · {Math.round(meta.coverage.categorizedShare * 100)}% do gasto com categoria · {meta.coverage.historyMonths} meses de histórico.</p>
        <p className="mt-1">{meta.competenceRule}</p>
        <p className="mt-1">{meta.previousVersionNote}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comportamento — explicar o desvio
// ---------------------------------------------------------------------------

export function BehaviorTab({ rep, compare, onCompare, month }: { rep: ReportV2; compare: CompareKind; onCompare: (c: CompareKind) => void; month: string }) {
  const b = rep.behavior;
  const sheet = useSheet();
  if (!b) return <EmptyMonth />;
  const d = b.drivers;
  const maxImpact = d ? Math.max(...d.rows.map((r) => Math.abs(r.impact)), 1) : 1;
  return (
    <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
      {d && d.rows.length > 0 ? (
        <Panel title="O que mais impactou seus gastos" scope={`Habitual · mesmos dias · ${b.habitualBase?.months ?? 0} meses · ${signed0(d.totalDelta)} no total`} icon={TrendingUp} info={() => sheet.show("drivers")}>
          <div className="mb-1 flex justify-between text-[11px] leading-4 text-muted-foreground"><span>← abaixo do habitual</span><span>acima →</span></div>
          <RankedRows rows={d.rows.map((r) => ({
            key: r.name, icon: categoryIcon(r.name), label: r.name, value: signed0(r.impact),
            bar: { ratio: r.impact / maxImpact, diverging: true, tone: r.impact > 0 ? "risk" : "neutral" },
            detail: r.impact < 0 && r.klass === "estrutural" ? "fixo · calendário a verificar" : undefined,
          }))} />
        </Panel>
      ) : null}

      {b.signals.length + b.patterns.length > 0 ? (
        <Panel title="O Nino observou" scope="Padrões nos seus dados, sem afirmar causa" icon={Sparkles}>
          <ul className="space-y-2">
            {[...b.signals.map((s) => s.title), ...b.patterns.map((p) => `${p.label}${p.status === "validated" ? "" : " (em observação)"}`)].slice(0, 3).map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm leading-5"><CheckCircle2 size={17} className="mt-0.5 shrink-0 text-primary" aria-hidden />{t}</li>
            ))}
          </ul>
          <DetailLink onClick={() => sheet.show("signals")}>Ver evidências</DetailLink>
        </Panel>
      ) : null}

      <WeekdayPanel b={b} />

      {b.smallSpend ? (
        <Panel title="Pequenos gastos" scope={`Compras de até R$ ${b.smallSpend.ceiling}, fora os fixos`} icon={Coins}>
          <p className="text-xl font-bold leading-6 tabular-nums">{brl0(b.smallSpend.total)} <span className="text-sm font-medium text-muted-foreground">em {b.smallSpend.count} compras · {Math.round(b.smallSpend.share * 100)}% do consumo</span></p>
          <Link to={`/app/lancamentos?start=${month}-01&end=${month}-31`} className="mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-primary print:hidden">Ver lançamentos ›</Link>
        </Panel>
      ) : null}

      <Panel title="Composição do consumo" scope="Cada real cai em um grupo; estorno é ajuste negativo" icon={Layers}>
        <LedgerLines
          lines={(Object.keys(CLASS_LABEL) as Array<keyof typeof CLASS_LABEL>).filter((k) => b.split.classes[k] !== 0).map((k) => {
            const v = b.split.classes[k];
            return { label: `${k === "nao_classificado" && v < 0 ? "Estornos sem categoria" : CLASS_LABEL[k]} · ${pct0(v / (b.split.total || 1)).replace("+", "")}`, value: brl0(Math.abs(v)), sign: v < 0 ? "−" as const : "+" as const };
          })}
          total={{ label: "Consumo", value: brl0(b.split.total) }}
        />
        <p className="mt-2 text-xs leading-4 text-muted-foreground">Fixo não é o mesmo que essencial; ajustável não é supérfluo.</p>
      </Panel>

      <CategoriesPanel b={b} compare={compare} onCompare={onCompare} month={month} />

      <DisclosureSheet {...sheet.props("drivers")} title="Como lemos os fatores" description="Cada categoria contra a mediana dos meses anteriores, nos mesmos dias.">
        {d ? (
          <LedgerLines lines={[...d.rows.map((r) => ({ label: r.name, value: signed0(r.impact) })), ...(d.omitted != null ? [{ label: "Outras categorias", value: signed0(d.omitted), muted: true }] : []), ...(d.medianEffect != null ? [{ label: "Efeito de comparar medianas", value: signed0(d.medianEffect), muted: true }] : [])]} total={{ label: "Diferença total", value: signed0(d.totalDelta) }} />
        ) : null}
        <p className="mt-3 text-xs leading-4 text-muted-foreground">Medianas por categoria não somam à mediana do total; essa diferença aparece separada, em vez de esconder na última linha. Queda em gasto fixo pode ser só uma conta ainda não vencida.</p>
      </DisclosureSheet>
      <DisclosureSheet {...sheet.props("signals")} title="Evidências" description="Correlação não é causa; nada aqui infere motivo.">
        <ul className="space-y-3">
          {b.signals.map((s) => <li key={s.key}><p className="font-semibold">{s.title}</p><p className="text-muted-foreground">{s.evidence}</p><p className="text-xs leading-4 text-muted-foreground">Amostra: {s.sample} · confiança {s.confidence}</p></li>)}
          {b.patterns.map((p) => <li key={p.label}><p className="font-semibold">{p.label}</p><p className="text-xs leading-4 text-muted-foreground">{p.status === "validated" ? "Confirmado" : "Em observação"} · {p.sampleSize} ocorrências{p.upliftPct != null ? ` · ${pct0(p.upliftPct / 100)} contra o normal` : ""}{p.confidence != null ? ` · confiança ${Math.round(p.confidence * 100)}%` : ""}</p></li>)}
          {b.priceChanges.map((p) => <li key={p.key}><p className="font-semibold">{p.label}: de {brl0(p.from)} para {brl0(p.to)}</p><p className="text-xs leading-4 text-muted-foreground">Cobrança mensal estável nos 3 meses anteriores.</p></li>)}
        </ul>
      </DisclosureSheet>
    </div>
  );
}

function WeekdayPanel({ b }: { b: BehaviorV2 }) {
  const w = b.weekday;
  const [sel, setSel] = useState<number | null>(null);
  if (!w) return null;
  const max = Math.max(...w.rows.map((r) => Math.max(r.avg, r.habitualAvg ?? 0)), 1);
  const s = sel != null ? w.rows[sel] : null;
  return (
    <Panel title="Quando você gasta mais" scope={`Gasto ajustável por dia (R$/dia), incluindo dias sem gasto · ${w.sample.days} dias`} icon={CalendarDays}>
      <Legend items={[{ label: "Este mês", swatch: "bg-primary" }, ...(w.rows.some((r) => r.habitualAvg != null) ? [{ label: `Histórico (${w.sample.refMonths} meses)`, swatch: "border-foreground/50", dashed: true }] : [])]} />
      <div className="flex h-36 items-end gap-1.5" role="img" aria-label={`Maior média: ${w.rows[w.peakDow].label}, ${brl0(w.rows[w.peakDow].avg)} por dia`}>
        {w.rows.map((r, i) => (
          <button key={r.dow} type="button" onClick={() => setSel(i)} aria-label={`${r.label}: ${brl0(r.avg)} por dia`} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className={cn("text-[11px] font-semibold tabular-nums", r.dow === w.peakDow || sel === i ? "text-foreground" : "text-transparent")}>{Math.round(r.avg)}</span>
            <span className="relative flex w-full flex-1 items-end">
              <span className={cn("mx-auto w-[70%] rounded-full transition-colors", r.dow === w.peakDow || sel === i ? "bg-primary" : "bg-primary/20")} style={{ height: `${Math.max(3, (r.avg / max) * 100)}%` }} />
              {r.habitualAvg != null ? <span className="absolute inset-x-1 border-t-[1.5px] border-dashed border-foreground/40" style={{ bottom: `${(r.habitualAvg / max) * 100}%` }} /> : null}
            </span>
            <span className="text-xs text-muted-foreground">{r.label}</span>
          </button>
        ))}
      </div>
      <ChartReadout>
        {s ? <>{s.label}: <b>{brl0(s.avg)}/dia</b> em {s.days} dias{s.habitualAvg != null ? ` · histórico ${brl0(s.habitualAvg)}/dia` : ""}</>
          : w.weekend ? <>Fim de semana <b>{brl0(w.weekend.weekendAvg)}/dia</b> · dias úteis <b>{brl0(w.weekend.weekdayAvg)}/dia</b>{w.persistence ? ` · repetiu em ${w.persistence.withPattern} de ${w.persistence.months} meses` : ""}</>
            : <>Toque numa barra para ver o dia.</>}
      </ChartReadout>
    </Panel>
  );
}

type SortKey = "spend" | "up" | "down";

export function CategoriesPanel({ b, compare, onCompare, month }: { b: BehaviorV2; compare: CompareKind; onCompare: (c: CompareKind) => void; month: string }) {
  const [view, setView] = useState<"cat" | "est">("cat");
  const [sort, setSort] = useState<SortKey>("spend");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(6);
  const navigate = useNavigate();
  const compared = compare !== "none" && b.previousRange != null;
  const sorter = <T extends { total: number; deltaAbs: number }>(a: T, c: T) => (sort === "spend" ? c.total - a.total : sort === "up" ? c.deltaAbs - a.deltaAbs : a.deltaAbs - c.deltaAbs);
  const cats = useMemo(() => [...b.categories].sort(sorter), [b.categories, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const mers = useMemo(() => b.merchants.filter((m) => !q || `${m.label} ${m.category}`.toLowerCase().includes(q.toLowerCase())).sort(sorter), [b.merchants, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const scope = compared && b.previousRange ? `vs. ${ddmm(b.previousRange.start)} a ${ddmm(b.previousRange.end)} (mesmos dias)` : "sem comparação";
  const list = view === "cat" ? cats : mers;
  return (
    <Panel title="Categorias e estabelecimentos" scope={scope} icon={Search} className="lg:col-span-2">
      <div role="tablist" aria-label="Agrupar por" className="mb-2 flex rounded-xl bg-secondary p-0.5">
        {([["cat", "Categorias"], ["est", "Estabelecimentos"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => { setView(id); setLimit(6); }} className={cn("min-h-[44px] flex-1 rounded-[10px] px-3 text-[13px]", view === id ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{label}</button>
        ))}
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="min-w-0 text-xs leading-4 text-muted-foreground">Comparar com
          <select aria-label="Comparar com" value={compare} onChange={(e) => onCompare(e.target.value as CompareKind)} className="mt-1 h-11 w-full rounded-xl border border-border bg-card px-2.5 text-sm text-foreground">
            {COMPARE_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-xs leading-4 text-muted-foreground">Ordenar por
          <select aria-label="Ordenar por" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="mt-1 h-11 w-full rounded-xl border border-border bg-card px-2.5 text-sm text-foreground">
            <option value="spend">Maior gasto</option>{compared ? <><option value="up">Mais subiu</option><option value="down">Mais caiu</option></> : null}
          </select>
        </label>
      </div>
      {view === "est" ? <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar estabelecimento" aria-label="Buscar estabelecimento" className="mb-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" /> : null}
      <RankedRows rows={list.slice(0, limit).map((c) => {
        const isCat = view === "cat";
        const name = isCat ? (c as BehaviorV2["categories"][number]).name : (c as BehaviorV2["merchants"][number]).label;
        const catId = isCat ? (c as BehaviorV2["categories"][number]).id : null;
        return {
          key: isCat ? name : (c as BehaviorV2["merchants"][number]).key, icon: categoryIcon(isCat ? name : (c as BehaviorV2["merchants"][number]).category), label: name, value: brl0(c.total),
          bar: isCat ? { ratio: (c as BehaviorV2["categories"][number]).share } : undefined,
          detail: `${c.count} ${c.count === 1 ? "compra" : "compras"}${c.count > 1 && c.ticket != null ? ` · ${brl0(c.ticket)} cada` : ""}${compared ? ` · antes ${brl0(c.previous)}` : ""}`,
          trailing: compared ? (c.deltaPct != null ? <Chip ratio={c.deltaPct} base="o período anterior" /> : <span className="text-xs text-muted-foreground">novo</span>) : undefined,
          onClick: catId ? () => navigate(`/app/lancamentos?category=${catId}&start=${month}-01&end=${month}-31`) : undefined,
        };
      })} />
      {list.length > limit ? <button type="button" onClick={() => setLimit((n) => n + 10)} className="mt-1 min-h-[44px] w-full rounded-full border border-border text-sm font-semibold text-primary print:hidden">Ver mais ({list.length - limit})</button> : null}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Projeções — antecipar e decidir
// ---------------------------------------------------------------------------

export function ProjectionsTab({ rep, month }: { rep: ReportV2; month: string }) {
  const p = rep.projections;
  const sheet = useSheet();
  const act = useRecommendationAction(month);
  const [hidden, setHidden] = useState<string[]>([]);
  const [pctAdj, setPctAdj] = useState<Record<string, number>>({});
  const c = p.cash;
  const actions = rep.recommendations.items.filter((r) => !hidden.includes(r.key));
  const next = actions[0];
  return (
    <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
      {!rep.isCurrentMonth ? <div className="lg:col-span-2"><ContextNotice icon={CalendarClock} title="Projeções valem para o mês em andamento" text="Abaixo, o que continua valendo hoje." /></div> : null}
      {c ? (
        <section aria-label="Saldo esperado" className="rounded-[24px] border border-border/60 bg-card p-5 shadow-[0_1px_2px_rgba(33,22,79,0.04),0_12px_32px_-16px_rgba(109,59,255,0.18)] lg:col-span-2">
          <div className="flex items-start gap-3">
            <IconBadge icon={Target} />
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-5 text-muted-foreground">Saldo esperado no fim do mês</p>
              <Money value={c.projectedEnd} size="hero" className="mt-0.5" />
              {c.expectedIncome ? <p className="text-xs leading-4 text-muted-foreground">Condicionado à renda prevista em {ddmm(c.expectedIncome.date)} ({brl0(c.expectedIncome.amount)})</p> : null}
            </div>
          </div>
          {c.expectedIncome && c.withoutIncomeEnd != null ? <p className="mt-3 rounded-xl bg-secondary/60 px-3 py-2 text-sm leading-5">Sem a renda prevista: <b className={cn("tabular-nums", c.withoutIncomeEnd < 0 && TONE.risk)}>{brl0(c.withoutIncomeEnd)}</b><span className="text-muted-foreground"> · demais premissas iguais</span></p> : null}
          <button type="button" onClick={() => sheet.show("cash")} className="mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-primary print:hidden">Como chegamos aqui</button>
        </section>
      ) : <div className="lg:col-span-2"><ContextNotice icon={AlertTriangle} tone="alert" title="Saldo esperado indisponível" text="O retrato de hoje ainda não foi atualizado; nada é estimado no lugar." /></div>}

      {p.consumption ? (
        <Panel title="Consumo projetado" scope="Fim do mês · faixa histórica estimada" icon={BarChart3} info={() => sheet.show("consumption")}>
          <Money value={p.consumption.total} />
          <p className="text-xs leading-4 text-muted-foreground">{Math.round(p.consumption.high) > Math.round(p.consumption.low) ? `faixa ${brl0(p.consumption.low)} a ${brl0(p.consumption.high)} · ` : "sem variação histórica suficiente para faixa · "}não é saldo</p>
        </Panel>
      ) : null}

      <CommitmentsPanel p={p} />

      {p.receivables && p.receivables.toDue + p.receivables.overdue > 0 ? (
        <Panel title="A receber" scope="Divisões com outras pessoas · não entra no saldo" icon={HandCoins}>
          <Money value={p.receivables.toDue + p.receivables.overdue} />
          <p className="text-xs leading-4 text-muted-foreground"><span className={p.receivables.overdue > 0 ? TONE.risk : ""}>{brl0(p.receivables.overdue)} vencidos</span> · {brl0(p.receivables.toDue)} a vencer · {brl0(p.receivables.receivedInPeriod)} recebidos no mês</p>
          <Link to="/app/divisao-do-role" className="mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-primary print:hidden">Ver cobranças ›</Link>
        </Panel>
      ) : null}

      {p.savings || p.recoverable ? (
        <div className="grid grid-cols-2 gap-3">
          {p.savings ? <MetricTile icon={PiggyBank} label="Capacidade de poupança" value={p.savings.status === "ok" ? `${brl0(p.savings.monthly ?? 0)}/mês` : p.savings.status === "zero_real" ? "R$ 0/mês" : "Indisponível"} sub={p.savings.status === "zero_real" ? `mediana de ${p.savings.closedMonths} meses fechados` : p.savings.status === "ok" ? "sustentável" : p.savings.status === "stale" ? "cálculo desatualizado" : "histórico curto"} /> : null}
          {p.recoverable ? <MetricTile icon={Repeat} label="Gasto recuperável" value={`${brl0(p.recoverable.monthly)}/mês`} sub="estimado" /> : null}
        </div>
      ) : null}

      {next ? (
        <Panel title="Próxima ação" icon={Zap} className="lg:col-span-2">
          <ActionRow r={next} pct={pctAdj[next.key]} onPct={(v) => setPctAdj((m) => ({ ...m, [next.key]: v }))}
            onAccept={() => { void act(next, "accepted"); }} onDismiss={() => { setHidden((h) => [...h, next.key]); void act(next, "dismissed"); }} onMethod={() => sheet.show(`rec:${next.key}`)} />
          {actions.length > 1 ? (
            <details className="mt-2 border-t border-border pt-2">
              <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-primary">Outras ações ({actions.length - 1})</summary>
              <div className="space-y-3 pt-1">
                {actions.slice(1).map((r) => <ActionRow key={r.key} r={r} pct={pctAdj[r.key]} onPct={(v) => setPctAdj((m) => ({ ...m, [r.key]: v }))} onAccept={() => { void act(r, "accepted"); }} onDismiss={() => { setHidden((h) => [...h, r.key]); void act(r, "dismissed"); }} onMethod={() => sheet.show(`rec:${r.key}`)} />)}
              </div>
            </details>
          ) : null}
          <p className="mt-2 text-xs leading-4 text-muted-foreground">Estimativas independentes: não somar.</p>
        </Panel>
      ) : null}

      {c ? (
        <DisclosureSheet {...sheet.props("cash")} title="Como chegamos aqui" description="Saldo de caixa, em centavos. Cartão afeta o caixa quando a fatura é paga.">
          <LedgerLines lines={c.steps.filter((s) => s.sign !== "result").map((s) => ({ label: `${s.label}${s.uncertain ? " (estimada)" : ""}`, value: brl2(s.value), sign: s.sign === "plus" ? "+" as const : s.sign === "minus" ? "−" as const : "" as const, icon: s.key === "start" ? Wallet : s.key.startsWith("income") ? ArrowDownLeft : s.key === "card" ? CreditCard : s.key === "commitments" ? CalendarClock : TrendingDown }))} total={{ label: "Saldo esperado", value: brl2(c.projectedEnd) }} />
          {c.freeCash != null ? <p className="mt-3 text-xs leading-4 text-muted-foreground">Livre depois dos compromissos conhecidos, antes do consumo variável: {brl2(c.freeCash)}.</p> : null}
          <p className="mt-1 text-xs leading-4 text-muted-foreground">Renda prevista não é renda recebida. Valores a receber de terceiros não entram.</p>
        </DisclosureSheet>
      ) : null}
      {p.consumption ? (
        <DisclosureSheet {...sheet.props("consumption")} title="Premissas do consumo projetado">
          <LedgerLines lines={[{ label: "Já consumido", value: brl2(p.consumption.realized) }, { label: "Obrigações de consumo por vencer", value: brl2(p.consumption.structuralPending), sign: "+" }, { label: "Gasto ajustável esperado", value: brl2(p.consumption.adjustableFuture), sign: "+" }]} total={{ label: "Consumo projetado", value: brl2(p.consumption.total) }} />
          {p.consumption.structuralItems.length ? <ul className="mt-2 space-y-1 text-xs leading-4 text-muted-foreground">{p.consumption.structuralItems.map((i) => <li key={`${i.label}${i.date}`} className="flex justify-between"><span>{ddmm(i.date)} · {i.label}</span><span className="tabular-nums">{brl2(i.amount)}</span></li>)}</ul> : null}
          <p className="mt-3 text-xs leading-4 text-muted-foreground">{p.consumption.method} A faixa é histórica (P25–P75), não uma probabilidade calibrada. Parcela de dívida não entra: é amortização.</p>
        </DisclosureSheet>
      ) : null}
      {rep.recommendations.items.map((r) => (
        <DisclosureSheet key={r.key} {...sheet.props(`rec:${r.key}`)} title="Como calculamos">
          <p>{r.basis}</p><p className="mt-2 text-xs leading-4 text-muted-foreground">Confiança {Math.round(r.confidence * 100)}%.</p>
        </DisclosureSheet>
      ))}
    </div>
  );
}

function ActionRow({ r, pct, onPct, onAccept, onDismiss, onMethod }: { r: Recommendation; pct?: number; onPct: (v: number) => void; onAccept: () => void; onDismiss: () => void; onMethod: () => void }) {
  const p = pct ?? r.adjustable?.pct;
  const impact = r.nature === "saving"
    ? (r.adjustable && p != null ? `Até ${brl0(r.adjustable.base * p)}/mês estimados (hipótese de ${Math.round(p * 100)}%)` : r.monthlyImpact > 0 ? `Até ${brl0(r.monthlyImpact)}/mês estimados` : null)
    : r.cashImpact ? `Protege ${brl0(r.cashImpact)} no caixa · não é economia` : "Organização do caixa · sem economia mensal";
  return (
    <div>
      <ActionCard icon={r.nature === "cash" ? CalendarClock : r.kind === "price" ? Repeat : r.kind === "small_spend" ? Coins : Target} title={r.title} body={r.body} impact={impact}
        cta={r.route && r.routeLabel ? { label: r.routeLabel, href: r.route } : null} onCta={r.nature === "saving" ? onAccept : undefined}
        menu={[{ label: "Como calculamos", onSelect: onMethod }, { label: "Dispensar", onSelect: onDismiss }]} />
      {r.adjustable ? (
        <label className="ml-11 mt-1 flex items-center gap-2 text-xs text-muted-foreground">Hipótese
          <select value={p} onChange={(e) => onPct(Number(e.target.value))} className="h-11 rounded-lg border border-border bg-card px-2">{[0.1, 0.2, 0.3, 0.5].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}</select>
        </label>
      ) : null}
    </div>
  );
}

const SERIES = { cards: { label: "Cartões", color: "#6D3BFF" }, debts: { label: "Dívidas", color: "#A78BFA" }, recurring: { label: "Recorrências", color: "#DDD6FE" } } as const;

function CommitmentsPanel({ p }: { p: ProjectionsV2 }) {
  const c = p.commitments;
  const [sel, setSel] = useState<number | null>(null);
  if (!c) return null;
  const months = c.months.filter((m) => m.cards + m.debts + m.recurring > 0);
  const max = Math.max(...months.map((m) => m.cards + m.debts + m.recurring), 1);
  const s = sel != null ? months[sel] : null;
  return (
    <Panel title={`Compromissos até ${c.horizonEnd ? ddmm(c.horizonEnd) : "30 dias"}`} scope={p.committedIncome ? `${Math.round(p.committedIncome.pct * 100)}% da renda mensal informada (referência)` : "O que já está agendado"} icon={CalendarClock} className="lg:col-span-2">
      <Money value={c.next30} />
      <p className="text-xs leading-4 text-muted-foreground">{c.groups.map((g) => `${SERIES[g.key].label} ${brl0(g.amount)}${g.estimated ? " (estimada)" : ""}`).join(" · ")}</p>
      {months.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-semibold leading-5">Próximos 6 meses</p>
          <Legend items={(Object.keys(SERIES) as Array<keyof typeof SERIES>).map((k) => ({ label: SERIES[k].label, swatch: "", color: SERIES[k].color }))} />
          <div className="flex h-36 items-end gap-2" role="img" aria-label="Compromissos por mês: cartões, dívidas e recorrências">
            {months.map((m, i) => {
              const total = m.cards + m.debts + m.recurring;
              return (
                <button key={m.month} type="button" onClick={() => setSel(i)} aria-label={`${monthFull(m.month)}: ${brl0(total)}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span className={cn("text-[11px] tabular-nums", sel === i ? "font-semibold text-foreground" : "text-muted-foreground")}>{(total / 1000).toFixed(1).replace(".", ",")}k</span>
                  <span className={cn("flex w-[68%] flex-col-reverse gap-[2px] transition-opacity", sel != null && sel !== i && "opacity-45")} style={{ height: `${Math.max(3, (total / max) * 80)}%` }}>
                    {(["cards", "debts", "recurring"] as const).filter((k) => m[k] > 0).map((k, idx, arr) => <span key={k} className={cn("rounded-[3px]", idx === arr.length - 1 && "rounded-t-lg")} style={{ height: `${(m[k] / total) * 100}%`, background: SERIES[k].color }} />)}
                  </span>
                  <span className="text-xs text-muted-foreground">{mon(m.month)}</span>
                </button>
              );
            })}
          </div>
          <ChartReadout>{s ? <>{monthFull(s.month)}: <b>{brl0(s.cards + s.debts + s.recurring)}</b> · cartões {brl0(s.cards)} · dívidas {brl0(s.debts)} · recorrências {brl0(s.recurring)}</> : <>Só o que já está contratado. Toque numa barra para ver a composição.</>}</ChartReadout>
        </div>
      ) : null}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Evolução — mostrar progresso real
// ---------------------------------------------------------------------------

export function EvolutionTab({ rep }: { rep: ReportV2 }) {
  const e = rep.evolution;
  return (
    <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
      <IncomeVsConsumption e={e} />
      <NetWorthPanel e={e} />
      <GoalsPanel e={e} />
      {e.tracked.length > 0 || e.forecast.length > 0 ? (
        <Panel title="Impacto das metas e ações" scope="Observado contra a referência" icon={Target}>
          {e.tracked.length > 0 ? <RankedRows rows={e.tracked.map((t) => ({ key: t.key, icon: t.status === "reduzindo" ? TrendingDown : TrendingUp, label: t.title, value: signed0(t.delta), detail: `partida ${brl0(t.baseline)} → agora ${brl0(t.current)} · ${t.status.replace("_", " ")}` }))} /> : null}
          {e.forecast.length > 0 ? (
            <div className={e.tracked.length ? "mt-3 border-t border-border pt-3" : ""}>
              <p className="text-sm font-semibold leading-5">Previsto x realizado</p>
              <ul className="mt-1 space-y-1 text-xs leading-4 tabular-nums">{e.forecast.map((f) => <li key={f.month} className="flex justify-between"><span className="capitalize">{monthFull(f.month)}</span><span>previsto {f.predictedConsumption != null ? brl0(f.predictedConsumption) : "—"} · real {brl0(f.actualConsumption)}{f.consumptionErrorPct != null ? ` · erro ${pct0(f.consumptionErrorPct)}` : ""}</span></li>)}</ul>
            </div>
          ) : null}
        </Panel>
      ) : <Panel title="Impacto das metas e ações" icon={Target}><p className="text-sm leading-5 text-muted-foreground">Aparece quando você aceitar uma ação ou quando um mês com previsão fechar.</p></Panel>}
    </div>
  );
}

function IncomeVsConsumption({ e }: { e: EvolutionV2 }) {
  const [mode, setMode] = useState<"bars" | "result">("bars");
  const [sel, setSel] = useState<number | null>(null);
  const ms = e.months;
  if (ms.length < 2) return null;
  const s = sel != null ? ms[sel] : null;
  const max = Math.max(...ms.map((m) => Math.max(m.income, m.consumption)), 1);
  const maxAbs = Math.max(...ms.map((m) => Math.abs(m.result)), 1);
  return (
    <Panel title="Receitas × consumo" scope={`Últimos ${ms.length} meses · R$`} icon={BarChart3} className="lg:col-span-2">
      <div role="tablist" aria-label="Visão do gráfico" className="mb-3 flex rounded-xl bg-secondary p-0.5 text-[13px]">{([["bars", "Receitas e consumo"], ["result", "Resultado"]] as const).map(([id, l]) => <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={cn("min-h-[44px] flex-1 rounded-[10px] px-2.5", mode === id ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{l}</button>)}</div>
      {mode === "bars" ? <Legend items={[{ label: "Receitas", swatch: "bg-[#16A37A]" }, { label: "Consumo", swatch: "bg-primary" }, { label: "Mês em aberto (hachurado)", swatch: "bg-primary/30" }]} /> : <Legend items={[{ label: "Sobrou", swatch: "bg-[#16A37A]" }, { label: "Faltou", swatch: "bg-[#DC4C64]" }]} />}
      <svg width="0" height="0" className="absolute" aria-hidden><defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="currentColor" opacity="0.25" /><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="2.5" /></pattern></defs></svg>
      <div className="relative flex h-40 items-end gap-2" role="img" aria-label={mode === "bars" ? "Receitas e consumo por mês" : "Resultado por mês, com zero ao centro"}>
        {mode === "result" ? <span className="absolute inset-x-0 top-1/2 border-t border-foreground/30" aria-hidden><span className="absolute -top-2.5 left-0 bg-card pr-1 text-[10px] text-muted-foreground">R$ 0</span></span> : null}
        {ms.map((m, i) => (
          <button key={m.month} type="button" onClick={() => setSel(i)} aria-label={`${monthFull(m.month)}: receitas ${brl0(m.income)}, consumo ${brl0(m.consumption)}, resultado ${signed0(m.result)}${m.partial ? " (parcial)" : ""}`} className={cn("relative flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-xl transition-colors", sel === i && "bg-primary/[0.06]")}>
            {mode === "bars" ? (
              <span className="flex h-[calc(100%-18px)] w-full items-end justify-center gap-1">
                <span className={cn("w-[34%] overflow-hidden rounded-t-md", m.partial ? "text-[#16A37A]" : "bg-[#16A37A]/85")} style={{ height: `${Math.max(1.5, (m.income / max) * 100)}%` }}>{m.partial ? <svg className="h-full w-full"><rect width="100%" height="100%" fill="url(#hatch)" /></svg> : null}</span>
                <span className={cn("w-[34%] overflow-hidden rounded-t-md", m.partial ? "text-primary" : "bg-primary")} style={{ height: `${Math.max(1.5, (m.consumption / max) * 100)}%` }}>{m.partial ? <svg className="h-full w-full"><rect width="100%" height="100%" fill="url(#hatch)" /></svg> : null}</span>
              </span>
            ) : (
              <span className="relative h-[calc(100%-18px)] w-full">
                <span className={cn("absolute left-1/2 w-[40%] -translate-x-1/2", m.result >= 0 ? "bottom-1/2 rounded-t-md bg-[#16A37A]/85" : "top-1/2 rounded-b-md bg-[#DC4C64]/85", m.partial && "opacity-40")} style={{ height: `${Math.max(1, (Math.abs(m.result) / maxAbs) * 48)}%` }} />
              </span>
            )}
            <span className="mt-1 text-xs text-muted-foreground">{mon(m.month)}{m.partial ? "*" : ""}</span>
          </button>
        ))}
      </div>
      <ChartReadout>{s ? <>{monthFull(s.month)}{s.partial ? " (parcial)" : ""}: receitas <b>{brl0(s.income)}</b> · consumo <b>{brl0(s.consumption)}</b> · resultado <b className={s.result < 0 ? TONE.risk : TONE.success}>{signed0(s.result)}</b>{s.debtPaid > 0 ? ` · dívida paga (fora) ${brl0(s.debtPaid)}` : ""}</> : <>* Mês em aberto, parcial. Toque numa coluna para ver os valores.</>}</ChartReadout>
    </Panel>
  );
}

function NetWorthPanel({ e }: { e: EvolutionV2 }) {
  const nw = e.netWorth;
  const sheet = useSheet();
  const [sel, setSel] = useState<number | null>(null);
  if (!nw) return null;
  const s = nw.series;
  const W = 340; const H = 130; const L = 44; const R = 12; const T = 12; const B = 22;
  const vals = s.map((p) => p.value);
  const lo = Math.min(...vals); const hi = Math.max(...vals);
  const pad = Math.max(1, (hi - lo) * 0.15);
  const y0 = lo - pad; const y1 = hi + pad;
  const x = (i: number) => L + (i / Math.max(1, s.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - y0) / Math.max(1, y1 - y0)) * (H - T - B);
  const sp = sel != null ? s[sel] : null;
  const pts = s.map((p, i) => [x(i), y(p.value)] as [number, number]);
  const fmtK = (v: number) => `${v < 0 ? "−" : ""}${Math.abs(Math.round(v / 1000))}k`;
  return (
    <Panel title="Patrimônio líquido registrado" scope={nw.composition ? `Atualizado em ${ddmm(nw.composition.asOf)} · ativos − passivos informados` : "Ativos − passivos informados"} icon={Landmark}>
      {nw.current != null ? <Money value={nw.current} size="hero" className={nw.current < 0 ? TONE.risk : undefined} /> : null}
      {s.length >= 2 ? (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={`Patrimônio de ${brl0(s[0].value)} em ${monthFull(s[0].month)} para ${brl0(s[s.length - 1].value)} em ${monthFull(s[s.length - 1].month)}`}>
            {[y1, (y0 + y1) / 2, y0].map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-border" strokeWidth={0.7} strokeDasharray="2 4" /><text x={L - 5} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={10}>{fmtK(t)}</text></g>)}
            <defs><linearGradient id="nwfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#6D3BFF" stopOpacity={0.14} /><stop offset="100%" stopColor="#6D3BFF" stopOpacity={0} /></linearGradient></defs>
            <path d={`${smoothPath(pts)} L${pts[pts.length - 1][0].toFixed(1)} ${(H - B).toFixed(1)} L${pts[0][0].toFixed(1)} ${(H - B).toFixed(1)} Z`} fill="url(#nwfill)" />
            <path d={smoothPath(pts)} fill="none" className="stroke-primary" strokeWidth={2.5} strokeLinecap="round" />
            {s.map((p, i) => (
              <g key={p.month} onClick={() => setSel(i)} className="cursor-pointer">
                <circle cx={x(i)} cy={y(p.value)} r={12} fill="transparent" />
                <circle cx={x(i)} cy={y(p.value)} r={sel === i || i === s.length - 1 ? 4.5 : 3} className={sel === i || i === s.length - 1 ? "fill-card stroke-primary" : "fill-primary"} strokeWidth={2.2} />
                <text x={x(i)} y={H - 5} textAnchor="middle" className="fill-muted-foreground" fontSize={10}>{mon(p.month)}</text>
              </g>
            ))}
          </svg>
          <ChartReadout>{sp ? <>{monthFull(sp.month)}: <b>{brl0(sp.value)}</b></> : <>Um ponto por mês com registro; meses sem registro não são interpolados. Toque num ponto.</>}</ChartReadout>
        </>
      ) : <p className="mt-1 text-xs leading-4 text-muted-foreground">A curva aparece com mais de um mês registrado.</p>}
      {nw.composition ? <DetailLink onClick={() => sheet.show("nw")}>Ativos e passivos</DetailLink> : null}
      {nw.composition ? (
        <DisclosureSheet {...sheet.props("nw")} title="Ativos e passivos" description={`Posição de ${ddmm(nw.composition.asOf)}, só com o que foi registrado no Nino.`}>
          <LedgerLines lines={[{ label: "Dinheiro em contas", value: brl2(nw.composition.cash), icon: Wallet }, { label: "Investimentos", value: brl2(nw.composition.invested), icon: PiggyBank }, { label: "Dívidas e empréstimos", value: brl2(nw.composition.otherDebts), sign: "−", icon: Landmark }, { label: "Cartões (fatura em aberto)", value: brl2(nw.composition.cardsOwed), sign: "−", icon: CreditCard }]} total={{ label: "Patrimônio líquido", value: brl2(nw.composition.net) }} />
          <p className="mt-2 text-xs leading-4 text-muted-foreground">Sem registro novo, o valor não muda; isso não significa estabilidade.</p>
        </DisclosureSheet>
      ) : null}
    </Panel>
  );
}

const VERDICT = { no_ritmo: "no ritmo", atencao: "atenção", vai_estourar: "deve estourar", estourou: "estourou" } as const;

function GoalsPanel({ e }: { e: EvolutionV2 }) {
  const g = e.goals;
  if (g.spending.length === 0 && g.savings.length === 0) return null;
  const onTrack = g.spending.filter((s) => s.verdict === "no_ritmo").length;
  return (
    <Panel title="Metas em andamento" scope={g.spending.length ? `${onTrack} de ${g.spending.length} metas de gasto no ritmo` : undefined} icon={Target} action={<Link to="/app/metas" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary">Ver todas</Link>} className="lg:col-span-2">
      {g.spending.length > 0 ? (
        <>
          <p className="text-xs leading-4 text-muted-foreground">Gasto · barra cheia = usado; clara = projeção no fim do período; linha = limite</p>
          <ul className="mt-2 space-y-3">
            {g.spending.map((s) => {
              const color = s.verdict === "no_ritmo" ? "bg-[#16A37A]" : s.verdict === "atencao" ? "bg-[#E9A23B]" : "bg-[#DC4C64]";
              const scale = Math.max(1, s.projectedPct ?? 0, s.pct) * 1.05;
              return (
                <li key={s.id}>
                  <p className="flex items-baseline justify-between text-sm leading-5"><span className="font-semibold">{s.category}</span><span className="tabular-nums">{Math.round(s.pct * 100)}%{s.projectedPct != null ? ` · projeção ${Math.round(s.projectedPct * 100)}%` : ""} · <span className={s.verdict === "no_ritmo" ? TONE.success : s.verdict === "atencao" ? TONE.alert : TONE.risk}>{VERDICT[s.verdict]}</span></span></p>
                  <span className="relative mt-1.5 block h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
                    {s.projectedPct != null ? <span className="absolute inset-y-0 left-0 rounded-full bg-primary/25" style={{ width: `${(s.projectedPct / scale) * 100}%` }} /> : null}
                    <span className={cn("absolute inset-y-0 left-0 rounded-full", color)} style={{ width: `${Math.max(2, (s.pct / scale) * 100)}%` }} />
                    <span className="absolute inset-y-[-2px] w-0.5 bg-foreground/60" style={{ left: `${(1 / scale) * 100}%` }} />
                  </span>
                  <p className="mt-0.5 text-xs leading-4 text-muted-foreground tabular-nums">{brl0(s.spent)} de {brl0(s.limit)}{s.daysRemaining != null ? ` · ${s.daysRemaining} dias restantes` : ""}</p>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs leading-4 text-muted-foreground">Critério: atenção quando a projeção passa de 85% do limite; "deve estourar" acima de 100%.</p>
        </>
      ) : null}
      {g.savings.length > 0 ? (
        <div className={g.spending.length ? "mt-4 border-t border-border pt-3" : ""}>
          <p className="text-xs leading-4 text-muted-foreground">Acumulação · progresso = acumulado ÷ alvo</p>
          <ul className="mt-2 space-y-2.5">{g.savings.map((s) => (
            <li key={s.id}><p className="flex items-baseline justify-between text-sm leading-5"><span className="font-semibold">{s.name}</span><span className="tabular-nums">{Math.round(s.pct * 100)}%</span></p>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, s.pct * 100)}%` }} /></span>
              <p className="mt-0.5 text-xs leading-4 text-muted-foreground tabular-nums">{brl0(s.contributed)} de {brl0(s.target)} · faltam {brl0(s.remaining)}</p></li>
          ))}</ul>
        </div>
      ) : null}
    </Panel>
  );
}
