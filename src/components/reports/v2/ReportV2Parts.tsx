import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Info, Search } from "lucide-react";
import type { BehaviorV2, CategoryRowV2, CompareKind, EvolutionV2, OverviewV2, ProjectionsV2, QualityNote, Recommendation, ReportV2 } from "@/lib/engine/reportV2";
import { brl0, categoryIcon, monthName, pctText } from "@/components/reports/format";
import { COMPARE_CHOICES, REPORT_TABS_V2, type ReportTabV2 } from "@/lib/reports/reportV2Client";
import { cn } from "@/lib/utils";

// Relatórios v2: só desenha o que o servidor calculou. Sem dado, o bloco some ou diz "aguardando"; nunca zero inventado.
// Estado nunca é só cor: sinal/seta + texto. Detalhe sob demanda (toque), não tudo aberto na primeira tela.

/** Centavos: onde o leitor vai somar de cabeça (projeções), a conta tem de fechar na tela. */
export const brl2 = (n: number) => `${n < 0 ? "−" : ""}R$ ${Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const brlS = (n: number) => `${n < 0 ? "−" : ""}R$ ${Math.abs(Math.round(n)).toLocaleString("pt-BR")}`;
const monthTitle = (ym: string) => `${monthName(ym).replace(/^./, (c) => c.toUpperCase())} ${ym.slice(0, 4)}`;
const shiftMonth = (ym: string, d: number) => {
  const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + d;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// ---------------------------------------------------------------------------
// Blocos básicos
// ---------------------------------------------------------------------------

export function Card({ title, subtitle, info, children, className, id }: { title?: string; subtitle?: string; info?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section id={id} aria-label={title} className={cn("rounded-2xl border border-border bg-card p-4 print:break-inside-avoid", className)}>
      {title ? (
        <header className="mb-2">
          <p className="flex items-center gap-1.5 text-[15px] font-bold">
            {title}
            {info ? (
              <button type="button" aria-label={`O que é: ${title}`} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-grid h-4 w-4 place-items-center rounded-full text-muted-foreground"><Info size={13} aria-hidden /></button>
            ) : null}
          </p>
          {subtitle ? <p className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</p> : null}
          {open && info ? <p role="note" className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">{info}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** Detalhe que abre com um toque. */
export function More({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 print:block">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1 text-[12px] font-semibold text-primary print:hidden">
        {label}<ChevronDown size={13} aria-hidden className={cn("transition-transform", open && "rotate-180")} />
      </button>
      <div className={cn("mt-2", open ? "block" : "hidden print:block")}>{children}</div>
    </div>
  );
}

function Chip({ ratio, base = "habitual" }: { ratio: number | null; base?: string }) {
  if (ratio == null) return null;
  const flat = Math.abs(ratio) < 0.02;
  const up = ratio > 0;
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", flat ? "bg-secondary text-muted-foreground" : up ? "bg-red-500/10 text-red-700" : "bg-emerald-500/10 text-emerald-700")}>
      {flat ? `no ${base}` : pctText(ratio)}
      <span className="sr-only">{flat ? "" : up ? ` acima do ${base}` : ` abaixo do ${base}`}</span>
    </span>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-2xl border border-dashed border-border p-4 text-[12.5px] text-muted-foreground">{children}</p>;

function Bar({ pct, tone = "primary" }: { pct: number; tone?: "primary" | "warn" | "danger" | "ok" }) {
  const cls = tone === "danger" ? "bg-red-500" : tone === "warn" ? "bg-amber-500" : tone === "ok" ? "bg-emerald-500" : "bg-primary";
  return <span className="block h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden><span className={cn("block h-full rounded-full", cls)} style={{ width: `${Math.min(100, Math.max(2, pct * 100))}%` }} /></span>;
}

// ---------------------------------------------------------------------------
// Cabeçalho
// ---------------------------------------------------------------------------

export function MonthPicker({ month, thisMonth, today, onPick }: { month: string; thisMonth: string; today: string; onPick: (m: string) => void }) {
  const options = Array.from({ length: 18 }, (_, i) => shiftMonth(thisMonth, -i));
  const sub = month === thisMonth ? `Até o dia ${Number(today.slice(8, 10))}` : "Mês inteiro";
  return (
    <div className="flex items-center gap-1 rounded-2xl border border-border bg-card px-1 py-1 print:hidden" role="group" aria-label="Mês do relatório">
      <button type="button" aria-label="Mês anterior" onClick={() => onPick(shiftMonth(month, -1))} className="grid h-10 w-10 place-items-center rounded-xl text-muted-foreground"><ChevronLeft size={18} aria-hidden /></button>
      <div className="relative min-w-0 flex-1 text-center">
        <p className="flex items-center justify-center gap-1 text-[15px] font-bold">{monthTitle(month)}<ChevronDown size={14} aria-hidden /></p>
        <p className="text-[11px] text-muted-foreground">{sub}</p>
        <select aria-label="Escolher o mês" value={month} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
          {options.map((m) => <option key={m} value={m}>{monthTitle(m)}</option>)}
        </select>
      </div>
      <button type="button" aria-label="Mês seguinte" disabled={month >= thisMonth} onClick={() => onPick(shiftMonth(month, 1))} className="grid h-10 w-10 place-items-center rounded-xl text-muted-foreground disabled:opacity-30"><ChevronRight size={18} aria-hidden /></button>
    </div>
  );
}

export function TabsV2({ active, onChange }: { active: ReportTabV2; onChange: (id: ReportTabV2) => void }) {
  return (
    <div role="tablist" aria-label="Seções do relatório" className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden print:hidden">
      {REPORT_TABS_V2.map((t) => (
        <button key={t.id} type="button" role="tab" id={`aba-${t.id}`} aria-selected={t.id === active} aria-controls={`painel-${t.id}`} onClick={() => onChange(t.id)}
          className={cn("shrink-0 rounded-full px-3.5 py-2 text-[13px] transition", t.id === active ? "bg-primary/10 font-bold text-primary" : "font-medium text-muted-foreground")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function QualityNotes({ notes }: { notes: QualityNote[] }) {
  if (notes.length === 0) return null;
  return (
    <Card title="Qualidade dos dados" subtitle="O que limita a precisão destes números.">
      <ul className="space-y-1.5">
        {notes.map((n) => (
          <li key={n.code} className="flex items-start gap-2 text-[12.5px] leading-snug">
            {n.level === "warn" ? <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" aria-hidden /> : <Info size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />}
            <span>{n.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Visão geral (A + E)
// ---------------------------------------------------------------------------

const CLASS_LABEL: Record<keyof OverviewV2["classes"], string> = { estrutural: "Fixos", ajustavel: "Ajustáveis", extraordinario: "Extraordinários", nao_classificado: "Sem categoria" };

export function ConsumptionHero({ o, isCurrent }: { o: OverviewV2; isCurrent: boolean }) {
  const h = o.habitual;
  return (
    <Card title="Consumo do mês" info="Consumo é o que você gastou de fato, no dia da compra, já descontando estornos. Não inclui transferências, pagamento de fatura nem o principal de dívida amortizado (esse aparece separado, como dívida paga)." className="bg-primary/5">
      <p className="text-3xl font-bold tabular-nums">{brlS(o.consumption)}</p>
      {h ? (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <Chip ratio={h.deltaPct} />
          <span>seu habitual {isCurrent ? `até o dia ${o.windowDays}` : "no mês"}: {brl0(h.value)} (mediana de {h.months.length} {h.months.length === 1 ? "mês" : "meses"})</span>
        </p>
      ) : <p className="mt-1 text-[12.5px] text-muted-foreground">Ainda sem histórico para comparar com o seu habitual.</p>}
      <More label="Entender composição">
        <ul className="space-y-1 text-[13px]">
          <li className="flex justify-between"><span>Despesas do período</span><span className="font-semibold tabular-nums">{brl2(o.reconciliation.gross)}</span></li>
          {o.reconciliation.refunds > 0 ? <li className="flex justify-between"><span>Estornos</span><span className="font-semibold tabular-nums">− {brl2(o.reconciliation.refunds)}</span></li> : null}
          <li className="flex justify-between border-t border-border pt-1 font-bold"><span>Consumo</span><span className="tabular-nums">{brl2(o.consumption)}</span></li>
        </ul>
        {o.debtPaid > 0 ? <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">Fora do consumo: {brl2(o.debtPaid)} de principal de dívida amortizado (sai do caixa, não é gasto novo). Transferências, pagamento de fatura e aplicações também ficam de fora.</p> : null}
        <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">Compras no cartão contam no mês da fatura. Método report_v2.1: pagamentos de dívida deixaram de contar inteiros, então o número é menor que o da versão anterior.</p>
      </More>
    </Card>
  );
}

export function SummaryTrioV2({ o }: { o: OverviewV2 }) {
  const income = o.income;
  const res = o.result;
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-2xl border border-border bg-card p-3">
        <p className="text-[11px] text-muted-foreground">Receitas</p>
        <p className="mt-0.5 text-[15px] font-bold tabular-nums">{brl0(income.realized)}</p>
        <p className="mt-0.5 text-[10.5px] leading-tight text-muted-foreground">{income.incomplete ? (income.expected ? `prevista ${fmtDay(income.expected.date)}: ${brl0(income.expected.amount)}` : `ainda não entrou tudo (típico ${brl0(income.typical)})`) : income.recurring > 0 && income.extraordinary > 0 ? `${brl0(income.recurring)} recorrente` : "realizadas"}</p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-3">
        <p className="text-[11px] text-muted-foreground">Resultado</p>
        <p className={cn("mt-0.5 text-[15px] font-bold tabular-nums", res.partial ? "text-muted-foreground" : res.value < 0 && "text-red-700")}>{res.value > 0 ? "+" : ""}{brlS(res.value)}</p>
        <p className="mt-0.5 text-[10.5px] leading-tight text-muted-foreground">{res.partial ? (o.income.expected ? `parcial, sem a renda de ${brl0(o.income.expected.amount)} (${fmtDay(o.income.expected.date)})` : "parcial, sem a renda do mês") : "receitas − consumo"}</p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-3">
        <p className="text-[11px] text-muted-foreground">Saldo hoje</p>
        {o.balance.available == null ? <><p className="mt-0.5 text-[13px] font-bold">Indisponível</p><p className="mt-0.5 text-[10.5px] leading-tight text-muted-foreground">aguarda atualização</p></>
          : <><p className="mt-0.5 text-[15px] font-bold tabular-nums">{brlS(o.balance.available)}</p><p className="mt-0.5 text-[10.5px] leading-tight text-muted-foreground">disponível agora</p></>}
      </div>
    </div>
  );
}

export function BridgeCard({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <Card title="Como esses números se relacionam" info="Consumo, resultado operacional, fluxo de caixa e saldo são coisas diferentes.">
      <ul className="space-y-1.5 text-[12.5px] leading-snug">{lines.map((l) => <li key={l}>• {l}</li>)}</ul>
    </Card>
  );
}

export function CurveChart({ o }: { o: OverviewV2 }) {
  const pts = o.curve;
  if (!pts || pts.length < 2) return null;
  const proj = o.curveProjection;
  const W = 320; const H = 160; const L = 36; const R = 10; const T = 14; const B = 22;
  const lastDay = proj ? proj[proj.length - 1].day : pts[pts.length - 1].day;
  const last = pts[pts.length - 1];
  const maxRaw = Math.max(last.current, last.habitual, ...(proj ? proj.map((p) => p.high) : [0]), 1);
  const step = maxRaw > 12000 ? 4000 : maxRaw > 6000 ? 2000 : maxRaw > 3000 ? 1000 : maxRaw > 1200 ? 500 : 250;
  const max = Math.ceil(maxRaw / step) * step;
  const x = (d: number) => L + ((d - 1) / Math.max(1, lastDay - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const line = (arr: Array<{ day: number; v: number }>) => arr.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  return (
    <Card title="Evolução do consumo" subtitle="Acumulado no mês contra o seu habitual.">
      <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />Este mês</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary/30" aria-hidden />Habitual</span>
        {proj ? <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 border-t-2 border-dashed border-primary" aria-hidden />Projeção</span> : null}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Consumo acumulado de ${brl0(last.current)} até o dia ${last.day}, contra ${brl0(last.habitual)} no habitual${proj ? `; projeção de ${brl0(proj[proj.length - 1].value)} no fim do mês` : ""}`}>
        {ticks.map((t) => (<g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={0.5} /><text x={L - 4} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={8}>{t.toLocaleString("pt-BR")}</text></g>))}
        {proj ? <path d={`${line(proj.map((p) => ({ day: p.day, v: p.high })))} ${proj.slice().reverse().map((p) => `L${x(p.day).toFixed(1)} ${y(p.low).toFixed(1)}`).join(" ")} Z`} className="fill-primary/10" /> : null}
        <path d={line(pts.map((p) => ({ day: p.day, v: p.habitual })))} fill="none" className="stroke-primary/35" strokeWidth={1.6} />
        {proj ? <path d={line(proj.map((p) => ({ day: p.day, v: p.value })))} fill="none" className="stroke-primary" strokeWidth={1.8} strokeDasharray="4 3" /> : null}
        <path d={line(pts.map((p) => ({ day: p.day, v: p.current })))} fill="none" className="stroke-primary" strokeWidth={2.2} strokeLinejoin="round" />
        <circle cx={x(last.day)} cy={y(last.current)} r={3.5} className="fill-background stroke-primary" strokeWidth={2} />
        {[1, 8, 15, 22, lastDay].filter((d, i, a) => a.indexOf(d) === i).map((d) => <text key={d} x={x(d)} y={H - 6} textAnchor="middle" className="fill-muted-foreground" fontSize={8}>{d}</text>)}
      </svg>
    </Card>
  );
}

export function TopCategoriesV2({ categories, onSeeAll }: { categories: CategoryRowV2[]; onSeeAll: () => void }) {
  const top = categories.slice(0, 3);
  if (top.length === 0) return null;
  return (
    <Card title="Principais categorias">
      <ul className="divide-y divide-border">
        {top.map((c) => {
          const Icon = categoryIcon(c.name);
          return (
            <li key={c.name} className="py-2.5">
              <span className="flex items-center gap-3"><Icon size={18} className="shrink-0 text-primary" aria-hidden /><span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{c.name}</span><span className="text-[14px] font-bold tabular-nums">{brl0(c.total)}</span><Chip ratio={c.deltaPct} base="mês anterior" /></span>
              <span className="mt-1.5 block"><Bar pct={c.share} /></span>
              <span className="mt-1 block text-[11.5px] text-muted-foreground">{Math.round(c.share * 100)}% do consumo</span>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={onSeeAll} className="mt-1 text-[12.5px] font-semibold text-primary print:hidden">Ver categorias e estabelecimentos</button>
    </Card>
  );
}

export function RecommendationsCard({ r }: { r: ReportV2["recommendations"] }) {
  if (r.items.length === 0) return null;
  return (
    <Card title="O que fazer agora" subtitle="Ordenado por urgência de caixa e impacto em reais, não pela variação em %." info="Cada ação é pontuada por impacto em reais, recorrência e confiança dos dados. Organizar o caixa não é economizar: essas ações não têm valor mensal.">
      <ol className="space-y-3">
        {r.items.map((it, i) => <RecItem key={it.key} it={it} n={i + 1} />)}
      </ol>
      <p className="mt-3 text-[11.5px] leading-snug text-muted-foreground">Cada valor é uma estimativa própria e não deve ser somado: as ações podem se sobrepor.</p>
    </Card>
  );
}

function RecItem({ it, n }: { it: Recommendation; n: number }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[12px] font-bold text-primary" aria-hidden>{n}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold leading-snug">{it.title}</p>
        {it.body ? <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{it.body}</p> : null}
        {it.nature === "saving" && it.monthlyImpact > 0 ? <p className="mt-0.5 text-[12px] font-semibold">Economia estimada: {brl0(it.monthlyImpact)} por mês</p> : null}
        <More label="Como calculamos"><p className="text-[11.5px] leading-snug text-muted-foreground">{it.basis} Confiança: {Math.round(it.confidence * 100)}%.</p></More>
        {it.route && it.routeLabel ? <Link to={it.route} className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary print:hidden">{it.routeLabel}<ArrowRight size={12} aria-hidden /></Link> : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Comportamento (B)
// ---------------------------------------------------------------------------

export function CompareControlV2({ compare, onChange }: { compare: CompareKind; onChange: (k: CompareKind) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 text-[13px] print:hidden">
      <span className="font-semibold">Comparar com</span>
      <select value={compare} onChange={(e) => onChange(e.target.value as CompareKind)} className="min-w-0 max-w-[60%] rounded-lg bg-transparent py-1 text-right text-[13px] text-muted-foreground">
        {COMPARE_CHOICES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function SplitCard({ b }: { b: BehaviorV2 }) {
  const { classes, total } = b.split;
  const parts = (Object.keys(CLASS_LABEL) as Array<keyof typeof classes>).map((k) => ({ k, v: classes[k] })).filter((p) => p.v !== 0);
  if (total <= 0 || parts.length === 0) return null;
  const note: Record<string, string> = { estrutural: "moradia, saúde, contas, educação e parcelas: o que você paga antes de decidir", ajustavel: "o que ainda dá para ajustar mês a mês", extraordinario: "compras muito acima do seu padrão", nao_classificado: "sem categoria; valor negativo = estornos sem categoria que abateram o consumo" };
  return (
    <Card title="Gastos fixos e ajustáveis" subtitle="Cada real do consumo cai em um só grupo; os grupos somam o total." info="Fixo não é o mesmo que essencial, e ajustável não é supérfluo: a divisão mostra o que dá para mexer no mês, não o que é necessário.">
      <ul className="space-y-3">
        {parts.map((p) => (
          <li key={p.k}>
            <span className="flex items-baseline justify-between"><span className="text-[13.5px] font-semibold">{p.k === "nao_classificado" && p.v < 0 ? "Estornos sem categoria" : CLASS_LABEL[p.k]}</span><span className="text-[14px] font-bold tabular-nums">{brlS(p.v)} <span className="text-[11px] font-medium text-muted-foreground">{Math.round((p.v / total) * 100)}%</span></span></span>
            <span className="mt-1 block"><Bar pct={Math.abs(p.v) / total} tone={p.v < 0 ? "ok" : "primary"} /></span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">{note[p.k]}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function DriversCard({ b }: { b: BehaviorV2 }) {
  const d = b.drivers;
  if (!d || d.rows.length === 0) return null;
  const max = Math.max(...d.rows.map((r) => Math.abs(r.impact)), 1);
  return (
    <Card title="Principais fatores de mudança" subtitle={`Contra o seu habitual (mediana de ${b.habitualBase?.months ?? "vários"} meses, mesmos dias): ${d.totalDelta >= 0 ? "+" : "−"}${brl0(Math.abs(d.totalDelta))} no total.`}>
      <ul className="space-y-2.5">
        {d.rows.map((r) => (
          <li key={r.name}>
            <span className="flex items-baseline justify-between text-[13px]"><span className="truncate font-semibold">{r.name}</span><span className={cn("font-bold tabular-nums", r.impact > 0 ? "text-red-700" : r.klass === "estrutural" ? "text-foreground" : "text-emerald-700")}>{r.impact > 0 ? "+" : "−"}{brl0(Math.abs(r.impact))}</span></span>
            <span className="mt-1 block"><Bar pct={Math.abs(r.impact) / max} tone={r.impact > 0 ? "danger" : r.klass === "estrutural" ? "primary" : "ok"} /></span>
          </li>
        ))}
      </ul>
      {Math.abs(d.residual) >= 1 ? <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">Resíduo: {d.residual > 0 ? "+" : "−"}{brl0(Math.abs(d.residual))}. Medianas por categoria não somam à mediana do total, e as categorias menores ficam fora da lista.</p> : null}
      {d.rows.some((r) => r.impact < 0 && r.klass === "estrutural") ? <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">Queda em gasto fixo pode ser só uma conta que ainda não venceu este mês, não economia.</p> : null}
    </Card>
  );
}

function ChangeChipV2({ total, previous, deltaPct }: { total: number; previous: number; deltaPct: number | null }) {
  if (deltaPct != null) return <Chip ratio={deltaPct} base="período anterior" />;
  return <span className="inline-flex shrink-0 items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{total > 0 && previous <= 0 ? "novo" : "—"}</span>;
}

type SortKey = "spend" | "up" | "down";
const SORTS: Array<{ id: SortKey; label: string }> = [{ id: "spend", label: "Maior gasto" }, { id: "up", label: "Mais subiu" }, { id: "down", label: "Mais caiu" }];

export function CategoriesAndMerchants({ b, compared }: { b: BehaviorV2; compared: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("spend");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(10);
  const [view, setView] = useState<"cat" | "est">("cat");
  const sorter = <T extends { total: number; deltaAbs: number }>(a: T, c: T) => (sort === "spend" ? c.total - a.total : sort === "up" ? c.deltaAbs - a.deltaAbs : a.deltaAbs - c.deltaAbs);
  const cats = useMemo(() => [...b.categories].sort(sorter), [b.categories, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = query.trim().toLowerCase();
  const mer = useMemo(() => b.merchants.filter((m) => !q || m.label.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)).sort(sorter), [b.merchants, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card title="Categorias e estabelecimentos" subtitle={compared && b.previousLabel ? `Comparado com ${b.previousRange ? `${fmtDay(b.previousRange.start)} a ${fmtDay(b.previousRange.end)} de ` : ""}${monthTitle(b.previousLabel)} (mesmos dias do mês).` : "Para onde foi o dinheiro."}>
      <div className="mb-2 flex gap-1 text-[12.5px]" role="tablist" aria-label="Agrupar por">
        {([["cat", "Categorias"], ["est", "Estabelecimentos"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={cn("rounded-full px-3 py-1.5", view === id ? "bg-primary/10 font-bold text-primary" : "text-muted-foreground")}>{label}</button>
        ))}
        <span className="flex-1" />
        <select aria-label="Ordenar por" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-lg bg-transparent text-[12px] text-muted-foreground">
          {SORTS.filter((s) => compared || s.id === "spend").map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      {view === "est" ? (
        <label className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 print:hidden">
          <Search size={15} className="text-muted-foreground" aria-hidden />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(10); }} placeholder="Buscar estabelecimento ou categoria" aria-label="Buscar estabelecimento ou categoria" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
        </label>
      ) : null}
      {view === "cat" ? (
        <ul className="divide-y divide-border">
          {cats.slice(0, limit).map((c) => {
            const Icon = categoryIcon(c.name);
            const isOpen = open === c.name;
            return (
              <li key={c.name}>
                <button type="button" onClick={() => setOpen(isOpen ? null : c.name)} aria-expanded={isOpen} className="w-full py-3 text-left">
                  <span className="flex items-center gap-3"><Icon size={18} className="shrink-0 text-primary" aria-hidden /><span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{c.name}</span><span className="text-[14px] font-bold tabular-nums">{brl0(c.total)}</span>{compared ? <ChangeChipV2 total={c.total} previous={c.previous} deltaPct={c.deltaPct} /> : null}<ChevronDown size={14} aria-hidden className={cn("shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} /></span>
                  <span className="mt-1.5 block"><Bar pct={c.share} /></span>
                  <span className="mt-1 block text-[11.5px] text-muted-foreground tabular-nums">{Math.round(c.share * 100)}% do consumo · {c.count} {c.count === 1 ? "compra" : "compras"}{c.ticket != null ? ` · ticket ${brl0(c.ticket)}` : ""}{compared ? ` · antes ${brl0(c.previous)}` : ""}</span>
                </button>
                {isOpen && c.merchants.length > 0 ? (
                  <ul className="mb-3 ml-7 space-y-2 border-l border-border pl-3">
                    {c.merchants.map((m) => (
                      <li key={m.key} className="flex items-center gap-2 text-[13px]">
                        <span className="min-w-0 flex-1"><span className="block truncate capitalize">{m.label}</span><span className="block text-[11px] text-muted-foreground tabular-nums">{m.count} {m.count === 1 ? "compra" : "compras"}{compared ? ` · antes ${brl0(m.previous)}` : ""}</span></span>
                        <span className="shrink-0 font-semibold tabular-nums">{brl0(m.total)}</span>
                        {compared ? <ChangeChipV2 total={m.total} previous={m.previous} deltaPct={m.deltaPct} /> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : mer.length === 0 ? <p className="text-[12.5px] text-muted-foreground">Nenhum estabelecimento encontrado neste mês.</p> : (
        <ul className="divide-y divide-border">
          {mer.slice(0, limit).map((m) => (
            <li key={m.key} className="flex items-center gap-3 py-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold text-muted-foreground" aria-hidden>{m.label.trim().slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-semibold capitalize">{m.label}</span><span className="block truncate text-[11.5px] text-muted-foreground tabular-nums">{m.category} · {m.count} {m.count === 1 ? "compra" : "compras"}{m.ticket != null ? ` · ticket ${brl0(m.ticket)}` : ""}</span></span>
              <span className="shrink-0 text-[13.5px] font-bold tabular-nums">{brl0(m.total)}</span>
              {compared ? <ChangeChipV2 total={m.total} previous={m.previous} deltaPct={m.deltaPct} /> : null}
            </li>
          ))}
        </ul>
      )}
      {(view === "cat" ? cats.length : mer.length) > limit ? <button type="button" onClick={() => setLimit((n) => n + 15)} className="mt-2 w-full rounded-full border border-border py-2 text-[12.5px] font-semibold text-primary print:hidden">Ver mais</button> : null}
    </Card>
  );
}

export function WeekdayCardV2({ b }: { b: BehaviorV2 }) {
  const w = b.weekday;
  if (!w) return null;
  const max = Math.max(...w.rows.map((r) => r.avg), 1);
  return (
    <Card title="Padrão por dia da semana" subtitle="Gasto ajustável por dia, contando os dias sem gasto." info="É o consumo ajustável dividido pelo número de dias daquele tipo no período, incluindo os dias em que você não gastou nada.">
      <div className="flex h-28 items-end gap-1.5" role="img" aria-label={`Maior média por dia: ${w.rows[w.peakDow].label}, ${brl0(w.rows[w.peakDow].avg)}`}>
        {w.rows.map((r) => (
          <div key={r.dow} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] font-semibold tabular-nums">{r.avg > 0 ? brl0(r.avg).replace("R$ ", "") : "0"}</span>
            <span className={cn("w-full rounded-t-md", r.dow === w.peakDow ? "bg-primary" : "bg-primary/30")} style={{ height: `${Math.max(3, (r.avg / max) * 76)}%` }} aria-hidden />
            <span className="text-[10.5px] text-muted-foreground">{r.label}</span>
          </div>
        ))}
      </div>
      {w.weekend ? <p className="mt-2 text-[12.5px] leading-snug">Nos fins de semana você gasta em média <b>{brl0(w.weekend.weekendAvg)}</b> por dia, contra <b>{brl0(w.weekend.weekdayAvg)}</b> nos dias úteis ({pctText(w.weekend.pct)}).</p> : null}
    </Card>
  );
}

export function SmallSpendCard({ b }: { b: BehaviorV2 }) {
  const s = b.smallSpend;
  if (!s) return null;
  return (
    <Card title="Pequenos gastos acumulados" subtitle={`Compras de até R$ ${s.ceiling}, fora os fixos.`}>
      <p className="text-2xl font-bold tabular-nums">{brl0(s.total)}</p>
      <p className="text-[12.5px] text-muted-foreground">{s.count} compras · {Math.round(s.share * 100)}% do consumo</p>
      <More label="Onde mais aparecem">
        <ul className="space-y-1 text-[13px]">{s.topMerchants.map((m) => <li key={m.label} className="flex justify-between"><span className="capitalize">{m.label} <span className="text-muted-foreground">({m.count})</span></span><span className="font-semibold tabular-nums">{brl0(m.total)}</span></li>)}</ul>
        {s.history.length > 0 ? <p className="mt-2 text-[11.5px] text-muted-foreground">Meses anteriores: {s.history.map((h) => `${monthName(h.month).slice(0, 3)} ${brl0(h.total)}`).join(" · ")}</p> : null}
      </More>
    </Card>
  );
}

export function PatternsCard({ b }: { b: BehaviorV2 }) {
  if (b.patterns.length === 0 && b.priceChanges.length === 0) return null;
  return (
    <Card title="Padrões que o Nino observou" subtitle="Repetições nos seus dados, não julgamentos." info="São padrões estatísticos do seu histórico. Eles não dizem por que você gasta assim.">
      <ul className="space-y-2.5 text-[13px] leading-snug">
        {b.patterns.map((p) => (
          <li key={p.label}><span className="font-semibold">{p.label}</span>{p.upliftPct != null ? <span className="text-muted-foreground"> · {pctText(p.upliftPct / 100)} em relação ao seu normal</span> : null}<span className="block text-[11px] text-muted-foreground">{p.status === "validated" ? "Confirmado" : "Em observação"} · {p.sampleSize} ocorrências</span></li>
        ))}
        {b.priceChanges.map((p) => (
          <li key={p.key}><span className="font-semibold capitalize">{p.label}</span> subiu de {brl0(p.from)} para {brl0(p.to)} <span className="text-muted-foreground">({pctText(p.deltaPct)})</span></li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Projeções (C)
// ---------------------------------------------------------------------------

export function ConsumptionProjectionCard({ p }: { p: ProjectionsV2 }) {
  const c = p.consumption;
  if (!c) return null;
  return (
    <Card title="Projeção de consumo" subtitle="Onde o mês deve terminar." info="Realizado + obrigações de consumo que ainda vão vencer (recorrências e planejados; parcela de dívida não entra, é amortização) + gasto ajustável esperado pelo seu padrão dos meses anteriores.">
      <p className="text-2xl font-bold tabular-nums">{brl2(c.total)}</p>
      <p className="text-[12px] text-muted-foreground">faixa provável: {brl2(c.low)} a {brl2(c.high)}</p>
      <ul className="mt-2 space-y-1 text-[13px]">
        <li className="flex justify-between"><span>Já consumido</span><span className="font-semibold tabular-nums">{brl2(c.realized)}</span></li>
        <li className="flex justify-between"><span>Obrigações de consumo por vencer</span><span className="font-semibold tabular-nums">+ {brl2(c.structuralPending)}</span></li>
        <li className="flex justify-between"><span>Gasto ajustável esperado</span><span className="font-semibold tabular-nums">+ {brl2(c.adjustableFuture)}</span></li>
        <li className="flex justify-between border-t border-border pt-1 font-bold"><span>Projeção</span><span className="tabular-nums">{brl2(c.total)}</span></li>
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{c.method}</p>
    </Card>
  );
}

export function CashProjectionCard({ p }: { p: ProjectionsV2 }) {
  const c = p.cash;
  if (!c) return null;
  return (
    <Card title="Projeção de saldo até o fim do mês" subtitle="A conta aberta, passo a passo, em centavos." info="Saldo de caixa, não consumo: compras no cartão só afetam o caixa quando a fatura é paga, e parcelas de dívida saem do caixa mesmo sem serem consumo. Valores a receber de terceiros não entram aqui.">
      <ul className="space-y-1 text-[13px]">
        {c.steps.map((s) => (
          <li key={s.key} className={cn("flex justify-between", s.sign === "result" && "border-t border-border pt-1 font-bold")}>
            <span>{s.label}{s.uncertain ? " *" : ""}</span>
            <span className="font-semibold tabular-nums">{s.sign === "plus" ? "+ " : s.sign === "minus" ? "− " : ""}{brl2(s.value)}</span>
          </li>
        ))}
      </ul>
      {c.steps.some((s) => s.uncertain) ? <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">* Receita ainda não confirmada. Sem ela, o saldo projetado seria <b>{brl2(c.conservativeEnd)}</b> (cenário conservador).</p> : null}
      {c.expectedIncome ? <p className="mt-1 text-[11.5px] text-muted-foreground">Próxima renda: {brl2(c.expectedIncome.amount)} em {fmtDay(c.expectedIncome.date)} ({c.expectedIncome.configured ? "informada no perfil, ainda não recebida" : "estimada"}).</p> : null}
      {!c.reconciles ? <p className="mt-1 text-[11.5px] text-amber-700">Esta conta não fecha exatamente com a da Home.</p> : null}
    </Card>
  );
}

const GROUP_LABEL = { cards: "Cartões e parcelas", debts: "Dívidas e empréstimos", recurring: "Contas e recorrências" } as const;

export function CommitmentsCardV2({ p }: { p: ProjectionsV2 }) {
  const c = p.commitments;
  if (!c) return null;
  return (
    <Card title="Compromissos futuros" subtitle="O que já está agendado.">
      <p className="text-2xl font-bold tabular-nums">{brl0(c.next30)}<span className="ml-1 text-[12px] font-medium text-muted-foreground">{c.horizonEnd ? `até ${fmtDay(c.horizonEnd)}` : "nos próximos 30 dias"}</span></p>
      {c.groups.length > 0 ? <ul className="mt-2 space-y-1 text-[13px]">{c.groups.map((g) => <li key={g.key} className="flex justify-between"><span>{GROUP_LABEL[g.key]}{g.estimated ? " (estimada)" : ""}</span><span className="font-semibold tabular-nums">{brl0(g.amount)}</span></li>)}</ul> : null}
      {p.committedIncome ? (
        <p className="mt-2 rounded-xl bg-primary/5 p-3 text-[12.5px] leading-snug"><b>{Math.round(p.committedIncome.pct * 100)}%</b> da renda mensal de {brl0(p.committedIncome.income)} ({p.committedIncome.basis}) já está comprometida nos próximos 30 dias. A renda típica dos meses anteriores pode ser diferente.</p>
      ) : null}
      {c.months.length > 0 ? (
        <More label="Parcelas de cartão nos próximos meses">
          <ul className="space-y-1 text-[13px]">{c.months.map((m) => <li key={m.month} className="flex justify-between"><span className="capitalize">{monthName(m.month)}</span><span className="font-semibold tabular-nums">{brl0(m.cards + m.debts + m.recurring)}</span></li>)}</ul>
          <p className="mt-1 text-[11px] text-muted-foreground">Só parcelas já contratadas; contas fixas e recorrências futuras não entram.</p>
        </More>
      ) : null}
    </Card>
  );
}

export function ReceivablesCardV2({ p }: { p: ProjectionsV2 }) {
  const r = p.receivables;
  if (!r || (r.toDue + r.overdue + r.receivedInPeriod) <= 0) return null;
  return (
    <Card title="Valores a receber" subtitle="Divisões de contas com outras pessoas." info="Não entram no saldo nem na projeção de caixa: só viram dinheiro quando forem pagos.">
      <ul className="space-y-1.5 text-[13px]">
        <li className="flex justify-between"><span>A vencer</span><span className="font-semibold tabular-nums">{brl0(r.toDue)}</span></li>
        <li className="flex justify-between"><span>Vencido</span><span className={cn("font-semibold tabular-nums", r.overdue > 0 && "text-red-700")}>{brl0(r.overdue)}</span></li>
        <li className="flex justify-between"><span>Recebido neste mês</span><span className="font-semibold tabular-nums text-emerald-700">{brl0(r.receivedInPeriod)}</span></li>
      </ul>
      <Link to="/app/divisao-do-role" className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary print:hidden">Ver divisões<ArrowRight size={12} aria-hidden /></Link>
    </Card>
  );
}

export function SavingsCardV2({ p }: { p: ProjectionsV2 }) {
  const s = p.savings;
  if (!s) return null;
  const msg: Record<typeof s.status, string> = {
    ok: "Quanto você consegue guardar por mês sem apertar o orçamento, pela mediana dos meses fechados.",
    zero_real: "Pelos meses fechados, seu resultado médio não deixa folga para guardar. Isso é um resultado real, não falta de dado.",
    insufficient_history: `Ainda há poucos meses fechados (${s.closedMonths}) para estimar com segurança. Com 3 ou mais, a estimativa fica firme.`,
    stale: "O cálculo está desatualizado; ele será refeito na próxima atualização.",
  };
  return (
    <Card title="Poupança sustentável" info="Estimativa do quanto sobra por mês de forma recorrente, usando só meses fechados.">
      {s.status === "ok" ? <p className="text-2xl font-bold tabular-nums">{brl0(s.monthly ?? 0)}<span className="ml-1 text-[12px] font-medium text-muted-foreground">por mês</span></p> : s.status === "zero_real" ? <p className="text-xl font-bold">R$ 0 por mês</p> : <p className="text-[15px] font-bold">Em formação</p>}
      <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{msg[s.status]}</p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Método: mediana de {s.closedMonths} {s.closedMonths === 1 ? "mês fechado" : "meses fechados"}{s.incomeBaseline ? `, sobre renda de referência de ${brl0(s.incomeBaseline)}` : ""}.</p>
    </Card>
  );
}

export function RecoverableCardV2({ p }: { p: ProjectionsV2 }) {
  const r = p.recoverable;
  if (!r) return null;
  return (
    <Card title="Gasto recuperável" subtitle="Onde há margem realista para economizar." info="Diferença entre o que você gasta hoje e o seu padrão mais baixo recorrente nas categorias ajustáveis. As partes somam o total, sem contar duas vezes.">
      <p className="text-2xl font-bold tabular-nums">{brl0(r.monthly)}<span className="ml-1 text-[12px] font-medium text-muted-foreground">por mês</span></p>
      <ul className="mt-2 space-y-1 text-[13px]">{r.sources.map((s) => <li key={s.label} className="flex justify-between"><span>{s.label}</span><span className="font-semibold tabular-nums">{brl0(s.monthly)}</span></li>)}</ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Evolução (D)
// ---------------------------------------------------------------------------

export function MonthlyResultCard({ e }: { e: EvolutionV2 }) {
  const months = e.months;
  if (months.length < 2) return null;
  const maxAbs = Math.max(...months.map((m) => Math.abs(m.result)), 1);
  const H = 110; const mid = H / 2;
  return (
    <Card title="Evolução mensal do resultado" subtitle="Receitas − consumo, mês a mês." info="Resultado = receitas − consumo (mesma definição da Visão geral). Barra para cima = sobrou; para baixo = faltou. O mês em aberto aparece tracejado e é parcial.">
      <svg viewBox={`0 0 320 ${H + 22}`} className="w-full" role="img" aria-label={`Resultado dos últimos ${months.length} meses`}>
        <line x1={0} x2={320} y1={mid} y2={mid} className="stroke-border" strokeWidth={1} />
        <text x={2} y={mid - 3} className="fill-muted-foreground" fontSize={8}>R$ 0</text>
        {months.map((m, i) => {
          const w = 320 / months.length;
          const x = i * w + w * 0.2;
          const h = Math.max(1, (Math.abs(m.result) / maxAbs) * (mid - 14));
          const up = m.result >= 0;
          const y = up ? mid - h : mid;
          return (
            <g key={m.month}>
              <rect x={x} y={y} width={w * 0.6} height={h} rx={3} className={up ? "fill-emerald-500/70" : "fill-red-500/70"} stroke={m.partial ? "currentColor" : "none"} strokeDasharray={m.partial ? "3 2" : undefined} fillOpacity={m.partial ? 0.35 : 1} />
              <text x={x + w * 0.3} y={up ? y - 3 : y + h + 9} textAnchor="middle" className="fill-foreground" fontSize={8.5} fontWeight={600}>{`${m.result > 0 ? "+" : "−"}${Math.abs(Math.round(m.result)).toLocaleString("pt-BR")}`}</text>
              <text x={x + w * 0.3} y={H + 16} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>{monthName(m.month).slice(0, 3)}{m.partial ? "*" : ""}</text>
            </g>
          );
        })}
      </svg>
      {months.some((m) => m.partial) ? <p className="text-[11px] text-muted-foreground">* Mês em aberto: resultado parcial, a renda do mês ainda não entrou por inteiro.</p> : null}
      <More label="Receitas, consumo e dívida por mês">
        <ul className="divide-y divide-border text-[12.5px]">
          {months.slice().reverse().map((m) => (
            <li key={m.month} className="py-1.5">
              <span className="flex items-center justify-between"><span className="capitalize">{monthName(m.month)}{m.open ? " (em aberto)" : ""}</span>
                <span className={cn("font-semibold tabular-nums", m.result < 0 && "text-red-700")}>{m.result > 0 ? "+" : ""}{brlS(m.result)}{m.partial ? " parcial" : ""}</span></span>
              <span className="block text-[11px] text-muted-foreground tabular-nums">receitas {brl0(m.income)} − consumo {brl0(m.consumption)}{m.debtPaid > 0 ? ` · dívida paga (fora) ${brl0(m.debtPaid)}` : ""}</span>
            </li>
          ))}
        </ul>
      </More>
    </Card>
  );
}

export function NetWorthCard({ e }: { e: EvolutionV2 }) {
  const nw = e.netWorth;
  if (!nw) return null;
  const s = nw.series;
  const W = 320; const H = 110; const L = 8; const R = 8; const T = 10; const B = 18;
  const vals = s.map((p) => p.value);
  const lo = Math.min(...vals, 0); const hi = Math.max(...vals, 1);
  const x = (i: number) => L + (i / Math.max(1, s.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  return (
    <Card title="Evolução patrimonial" subtitle={nw.label}>
      {nw.current != null ? <p className={cn("text-2xl font-bold tabular-nums", nw.current < 0 && "text-red-700")}>{brlS(nw.current)}</p> : null}
      {nw.composition ? (
        <More label="Ativos e passivos">
          <ul className="space-y-1 text-[13px]">
            <li className="flex justify-between"><span>Dinheiro em contas</span><span className="font-semibold tabular-nums">{brl2(nw.composition.cash)}</span></li>
            <li className="flex justify-between"><span>Investimentos</span><span className="font-semibold tabular-nums">{brl2(nw.composition.invested)}</span></li>
            <li className="flex justify-between border-t border-border pt-1"><span>Ativos</span><span className="font-bold tabular-nums">{brl2(nw.composition.assets)}</span></li>
            <li className="flex justify-between"><span>Dívidas e empréstimos</span><span className="font-semibold tabular-nums">− {brl2(nw.composition.otherDebts)}</span></li>
            <li className="flex justify-between"><span>Cartões (fatura em aberto)</span><span className="font-semibold tabular-nums">− {brl2(nw.composition.cardsOwed)}</span></li>
            <li className="flex justify-between border-t border-border pt-1"><span>Passivos</span><span className="font-bold tabular-nums">− {brl2(nw.composition.liabilities)}</span></li>
            <li className="flex justify-between border-t border-border pt-1 font-bold"><span>Patrimônio líquido</span><span className="tabular-nums">{brl2(nw.composition.net)}</span></li>
          </ul>
          <p className="mt-1 text-[11px] text-muted-foreground">Posição de hoje ({fmtDay(nw.composition.asOf)}), só com o que foi registrado no Nino. Sem registro novo, o valor não muda: isso não significa estabilidade.</p>
        </More>
      ) : null}
      {s.length >= 2 ? (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={`Patrimônio de ${brlS(s[0].value)} para ${brlS(s[s.length - 1].value)}`}>
          <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="stroke-border" strokeWidth={0.6} />
          <path d={s.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ")} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" />
          {s.map((p, i) => <g key={p.month}><circle cx={x(i)} cy={y(p.value)} r={2.5} className="fill-primary" /><text x={x(i)} y={H - 4} textAnchor="middle" className="fill-muted-foreground" fontSize={8}>{monthName(p.month).slice(0, 3)}</text></g>)}
        </svg>
      ) : <p className="mt-1 text-[12px] text-muted-foreground">A curva aparece quando houver mais de um mês registrado.</p>}
    </Card>
  );
}

const GOAL_TONE: Record<string, string> = { on_track: "no ritmo", attention: "atenção", at_risk: "em risco", exceeded: "estourou", limit_reached: "no limite" };

export function GoalsCardV2({ e }: { e: EvolutionV2 }) {
  const g = e.goals;
  if (g.spending.length === 0 && g.savings.length === 0) return null;
  return (
    <Card title="Evolução das metas" subtitle={g.summary ?? undefined}>
      {g.spending.length > 0 ? (
        <div>
          <p className="text-[12px] font-semibold text-muted-foreground">Metas de gasto</p>
          <ul className="mt-1.5 space-y-2.5">{g.spending.map((s) => (
            <li key={s.id}><span className="flex items-baseline justify-between text-[13px]"><span className="font-semibold">{s.category}</span><span className="tabular-nums">{brl0(s.spent)} de {brl0(s.limit)} <span className="text-[11px] text-muted-foreground">· {GOAL_TONE[s.status] ?? s.status}</span></span></span><span className="mt-1 block"><Bar pct={s.pct} tone={s.pct >= 1 ? "danger" : s.pct >= 0.8 ? "warn" : "ok"} /></span></li>
          ))}</ul>
        </div>
      ) : null}
      {g.savings.length > 0 ? (
        <div className={g.spending.length > 0 ? "mt-4" : ""}>
          <p className="text-[12px] font-semibold text-muted-foreground">Metas de acumulação</p>
          <ul className="mt-1.5 space-y-2.5">{g.savings.map((s) => (
            <li key={s.id}><span className="flex items-baseline justify-between text-[13px]"><span className="font-semibold">{s.name}</span><span className="tabular-nums">{brl0(s.contributed)} de {brl0(s.target)}</span></span><span className="mt-1 block"><Bar pct={s.pct} tone="ok" /></span><span className="mt-0.5 block text-[11px] text-muted-foreground">faltam {brl0(s.remaining)}</span></li>
          ))}</ul>
        </div>
      ) : null}
      <Link to="/app/metas" className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary print:hidden">Abrir metas<ArrowRight size={12} aria-hidden /></Link>
    </Card>
  );
}
