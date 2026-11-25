import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, BarChart3, Car, ChevronLeft, ChevronRight, ChevronDown, CalendarClock, CreditCard, Dumbbell, GraduationCap, HeartPulse, Home, Info, Landmark,
  Layers, PawPrint, ReceiptText, ShieldCheck, PiggyBank, Repeat, Scissors, Shirt, ShoppingBag, ShoppingCart, SlidersHorizontal, Sparkles, Tag, Target, Ticket, TrendingUp,
  Utensils, Wallet, Zap, type LucideIcon,
} from "lucide-react";
import type { ReportDashboard } from "@/lib/engine/reportDashboard";
import type { FutureView, ReportStory } from "@/lib/engine/reportStory";
import { cn } from "@/lib/utils";

// Blocos do relatório, desenhados sobre o protótipo aprovado (3 telas). Tudo aqui só desenha números que o
// servidor já calculou; cada bloco devolve `null` quando falta base, nunca um zero inventado.
// Estado nunca é só cor: seta/sinal + texto em toda variação.

/** Reais inteiros: análise, não extrato. Centavos continuam nos blocos de lançamentos. */
export const brl0 = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
/** Variação em %; acima de 500% vira ">500%" (de R$ 21 para R$ 356 não é "+1590%" legível). */
export const pctText = (ratio: number) => (Math.abs(ratio) > 5 ? `${ratio >= 0 ? "+" : "−"}>500%` : `${ratio >= 0 ? "+" : "−"}${Math.round(Math.abs(ratio) * 100)}%`);

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
const monthTitle = (ym: string) => `${monthName(ym).replace(/^./, (c) => c.toUpperCase())} ${ym.slice(0, 4)}`;

/** Ícone por nome de categoria (o protótipo mostra um por linha). Sem correspondência, ícone neutro. */
const CATEGORY_ICONS: Array<[RegExp, LucideIcon]> = [
  [/morad|alug|casa|condom/i, Home], [/aliment|restaur|deliver|lanche|comida/i, Utensils], [/mercado|supermerc/i, ShoppingCart],
  [/transport|uber|combust|carro|ônibus|onibus/i, Car], [/saúde|saude|farm|médic|medic/i, HeartPulse], [/lazer|entreten|viagem|ingresso/i, Ticket],
  [/educa|curso|escola/i, GraduationCap], [/assinatur|stream/i, Repeat], [/vestu|roupa/i, Shirt], [/belez|cabel/i, Scissors],
  [/pet|animal/i, PawPrint], [/d[ií]vid|empr[eé]stim|financ/i, Landmark], [/energia|luz|internet|conta|imposto|taxa/i, Zap],
  [/academia|esporte|fitness/i, Dumbbell], [/compra|shopping|presente/i, ShoppingBag],
];
export function categoryIcon(name: string): LucideIcon {
  return CATEGORY_ICONS.find(([rx]) => rx.test(name))?.[1] ?? Tag;
}

function IconBadge({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary", className)} aria-hidden><Icon size={18} /></span>;
}

/** ⓘ do protótipo: a definição de um número fica a um toque, sem poluir a tela. */
function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label={`O que é: ${label}`} aria-expanded={open} onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }}
        className="inline-grid h-4 w-4 place-items-center rounded-full text-muted-foreground"><Info size={13} aria-hidden /></button>
      {open ? <span role="note" className="mt-1 block w-full text-[11px] font-normal leading-snug text-muted-foreground">{children}</span> : null}
    </>
  );
}

/** Chip de variação contra o habitual. Subir gasto é "ruim" (vermelho + sinal). */
function VariationChip({ ratio, className }: { ratio: number; className?: string }) {
  const flat = Math.abs(ratio) < 0.005;
  const up = ratio > 0;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
      flat ? "bg-secondary text-muted-foreground" : up ? "bg-red-500/10 text-red-700" : "bg-emerald-500/10 text-emerald-700", className)}>
      {flat ? "no habitual" : pctText(ratio)}
      <span className="sr-only">{flat ? "" : up ? " acima do habitual" : " abaixo do habitual"}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Cabeçalho: seletor de mês e abas
// ---------------------------------------------------------------------------

const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const shiftMonth = (ym: string, d: number) => {
  const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + d;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

/** "Novembro 2026 ˅ / Até o dia 24", com setas para o mês anterior e o seguinte. */
export function MonthSelector({ start, end, today, onPick }: { start: string; end: string; today: string; onPick: (range: { start: string; end: string; isCurrent: boolean }) => void }) {
  const aligned = start.slice(8, 10) === "01" && start.slice(0, 7) === end.slice(0, 7);
  const ym = aligned ? start.slice(0, 7) : today.slice(0, 7);
  const thisMonth = today.slice(0, 7);
  const pick = (m: string) => {
    const current = m === thisMonth;
    onPick({ start: `${m}-01`, end: current ? today : `${m}-${String(lastDay(m)).padStart(2, "0")}`, isCurrent: current });
  };
  const options = Array.from({ length: 12 }, (_, i) => shiftMonth(thisMonth, -i));
  const sub = !aligned ? `${start.slice(8, 10)}/${start.slice(5, 7)} a ${end.slice(8, 10)}/${end.slice(5, 7)}` : ym === thisMonth ? `Até o dia ${Number(today.slice(8, 10))}` : "Mês inteiro";
  return (
    <div className="flex items-center gap-1 rounded-2xl border border-border bg-card px-1 py-1 print:hidden" role="group" aria-label="Mês do relatório">
      <button type="button" aria-label="Mês anterior" onClick={() => pick(shiftMonth(ym, -1))} className="grid h-10 w-10 place-items-center rounded-xl text-muted-foreground"><ChevronLeft size={18} aria-hidden /></button>
      <div className="relative min-w-0 flex-1 text-center">
        <p className="flex items-center justify-center gap-1 text-[15px] font-bold">{aligned ? monthTitle(ym) : "Período personalizado"}<ChevronDown size={14} aria-hidden /></p>
        <p className="text-[11px] text-muted-foreground">{sub}</p>
        <select aria-label="Escolher o mês" value={aligned ? ym : ""} onChange={(e) => e.target.value && pick(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
          {!aligned ? <option value="">Personalizado</option> : null}
          {options.map((m) => <option key={m} value={m}>{monthTitle(m)}</option>)}
        </select>
      </div>
      <button type="button" aria-label="Mês seguinte" disabled={ym >= thisMonth} onClick={() => pick(shiftMonth(ym, 1))} className="grid h-10 w-10 place-items-center rounded-xl text-muted-foreground disabled:opacity-30"><ChevronRight size={18} aria-hidden /></button>
    </div>
  );
}

export const REPORT_TABS = [
  { id: "geral", label: "Visão geral" },
  { id: "categorias", label: "Categorias e mais" },
] as const;
export type ReportTabId = (typeof REPORT_TABS)[number]["id"];
export const parseTab = (v: string | null): ReportTabId => (REPORT_TABS.some((t) => t.id === v) ? (v as ReportTabId) : "geral");

export function ReportTabs({ active, onChange }: { active: ReportTabId; onChange: (id: ReportTabId) => void }) {
  return (
    <div role="tablist" aria-label="Seções do relatório" className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden print:hidden">
      {REPORT_TABS.map((t) => (
        <button key={t.id} type="button" role="tab" id={`aba-${t.id}`} aria-selected={t.id === active} aria-controls={`painel-${t.id}`} onClick={() => onChange(t.id)}
          className={cn("shrink-0 rounded-full px-3.5 py-2 text-[13px] transition", t.id === active ? "bg-primary/10 font-bold text-primary" : "font-medium text-muted-foreground")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Título de cada "tela" do protótipo quando elas ficam empilhadas na mesma página. */
export function StorySection({ id, title, subtitle, children }: { id: string; title: string; subtitle: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="scroll-mt-4 space-y-3">
      <header className="pt-2">
        <h2 id={`${id}-titulo`} className="font-display text-xl font-bold leading-tight tracking-tight">{title}</h2>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{subtitle}</p>
      </header>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tela 1 — Visão geral
// ---------------------------------------------------------------------------

/** "Você consumiu R$ X", contra o habitual (a mesma janela de dias dos últimos meses fechados). */
export function ConsumptionHero({ d, story }: { d: ReportDashboard; story: ReportStory }) {
  const h = story.habitual;
  const above = (h?.deltaAbs ?? 0) > 0;
  const flat = Math.abs(h?.deltaPct ?? 0) < 0.03;
  const sentence = !h
    ? "Ainda não há histórico suficiente (2 meses fechados) para comparar com o seu habitual."
    : flat ? "Seu gasto está dentro do habitual para este período." : above ? "Seu gasto está acima do habitual para este período." : "Seu gasto está abaixo do habitual para este período.";
  return (
    <section aria-label="Consumo do período" className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <IconBadge icon={BarChart3} className="h-12 w-12 rounded-2xl" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold">Você consumiu</p>
          <p className="font-display text-[28px] font-bold leading-none tabular-nums">{brl0(d.totals.expense)}</p>
        </div>
        {h && h.deltaPct != null ? (
          <div className="shrink-0 text-right">
            <VariationChip ratio={h.deltaPct} className="text-[14px]" />
            <p className="mt-1 text-[11px] leading-tight text-muted-foreground">vs. seu habitual<br />({brl0(h.expense)})</p>
          </div>
        ) : null}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
        {sentence}
        {h ? <InfoTip label="habitual">Habitual é o valor típico (mediana) dos mesmos {story.windowDays} dias em {h.months.map((m) => monthName(m)).join(", ")}.</InfoTip> : null}
      </p>
    </section>
  );
}

/**
 * Aviso curto quando o dado limita a leitura: muito gasto sem categoria ou habitual com só 2 meses de base.
 * Sem problema, não aparece nada.
 */
export function DataQualityNote({ story }: { story: ReportStory }) {
  const q = story.quality;
  if (!q) return null;
  const uncategorized = q.uncategorizedShare >= 0.1;
  const thin = story.habitual != null && q.habitualMonths < 3;
  if (!uncategorized && !thin) return null;
  return (
    <aside aria-label="Qualidade dos dados" className="flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
      <div className="min-w-0 text-[12px] leading-snug text-foreground">
        {uncategorized ? (
          <p>
            {brl0(q.uncategorizedAmount)} ({Math.round(q.uncategorizedShare * 100)}%) dos gastos estão sem categoria, então as comparações por categoria ficam menos precisas.{" "}
            <Link to="/app/lancamentos" className="font-semibold text-primary">Categorizar</Link>
          </p>
        ) : null}
        {thin ? <p className={uncategorized ? "mt-1" : ""}>Seu habitual usa só {q.habitualMonths} meses de histórico; ele fica mais firme com 3.</p> : null}
      </div>
    </aside>
  );
}

/** Receitas, resultado e saldo disponível. O saldo é o da Home; sem snapshot de hoje, o terceiro cartão some. */
export function SummaryTrio({ d, story, future }: { d: ReportDashboard; story: ReportStory | null | undefined; future: FutureView | null | undefined }) {
  // Salário que ainda não caiu: "Resultado" seria só o gasto com sinal negativo, o que engana. Mostra o que falta.
  const waiting = story?.income?.incomplete === true;
  const expected = future?.outlook?.expectedIncome ?? null;
  const cells: Array<{ label: string; icon: LucideIcon; value: number | null; tone?: "good" | "bad"; note?: string }> = [
    { label: "Receitas", icon: Wallet, value: d.totals.income, note: waiting ? (expected ? `prevista para ${expected.date.slice(8, 10)}/${expected.date.slice(5, 7)}` : `costuma ser ${brl0(story?.income?.typical ?? 0)}`) : undefined },
    waiting
      ? { label: "Resultado", icon: TrendingUp, value: null, note: "aguardando a renda do mês" }
      : { label: "Resultado", icon: TrendingUp, value: d.totals.net, tone: d.totals.net >= 0 ? "good" : "bad" },
  ];
  if (future?.balance != null) cells.push({ label: "Saldo disponível", icon: Layers, value: future.balance });
  return (
    <section aria-label="Receitas, resultado e saldo" className={cn("grid gap-2", cells.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {cells.map((c) => (
        <div key={c.label} className="rounded-2xl border border-border bg-card p-3">
          <c.icon size={18} className="text-primary" aria-hidden />
          <p className="mt-2 text-[11.5px] text-muted-foreground">{c.label}</p>
          <p className={cn("font-display text-[16px] font-bold tabular-nums leading-tight", c.tone === "good" && "text-emerald-700", c.tone === "bad" && "text-red-700")}>
            {c.value == null ? "—" : `${c.value < 0 ? "−" : ""}${brl0(Math.abs(c.value))}`}
          </p>
          {c.note ? <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{c.note}</p> : null}
        </div>
      ))}
    </section>
  );
}

/** Evolução do consumo: acumulado do mês contra o acumulado do habitual. */
export function CumulativeChart({ story }: { story: ReportStory }) {
  const points = story.cumulative;
  if (!points || points.length < 2) return null;
  const W = 320; const H = 156; const L = 34; const R = 10; const T = 16; const B = 22;
  const last = points[points.length - 1];
  const maxRaw = Math.max(last.current, last.habitual, 1);
  const step = maxRaw > 12000 ? 4000 : maxRaw > 6000 ? 2000 : maxRaw > 3000 ? 1000 : maxRaw > 1200 ? 500 : 250;
  const max = Math.ceil(maxRaw / step) * step;
  const x = (day: number) => L + ((day - 1) / Math.max(1, points.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const line = (pick: (p: (typeof points)[number]) => number) => points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)} ${y(pick(p)).toFixed(1)}`).join(" ");
  const area = (pick: (p: (typeof points)[number]) => number) => `${line(pick)} L${x(last.day).toFixed(1)} ${y(0)} L${x(1).toFixed(1)} ${y(0)} Z`;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const xTicks = [1, 7, 14, 21, last.day].filter((d, i, a) => d <= last.day && a.indexOf(d) === i);
  const diff = story.habitual?.deltaPct;
  const mon = monthName(story.month).slice(0, 3);
  const bubbleX = Math.min(Math.max(x(last.day), L + 32), W - R - 32);
  return (
    <section aria-label="Evolução do consumo" className="rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <p className="text-[15px] font-bold">Evolução do consumo</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />Este mês (acumulado)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary/30" aria-hidden />Seu habitual</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img"
        aria-label={`Consumo acumulado de ${brl0(last.current)} até o dia ${last.day}, contra ${brl0(last.habitual)} no seu habitual${diff != null ? ` (${pctText(diff)})` : ""}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={0.5} />
            <text x={L - 4} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={8}>{t.toLocaleString("pt-BR")}</text>
          </g>
        ))}
        <path d={area((p) => p.habitual)} className="fill-primary/10" />
        <path d={line((p) => p.habitual)} fill="none" className="stroke-primary/35" strokeWidth={1.6} />
        <path d={area((p) => p.current)} className="fill-primary/10" />
        <path d={line((p) => p.current)} fill="none" className="stroke-primary" strokeWidth={2.2} strokeLinejoin="round" />
        <circle cx={x(last.day)} cy={y(last.current)} r={3.5} className="fill-background stroke-primary" strokeWidth={2} />
        <g transform={`translate(${bubbleX}, ${Math.max(2, y(last.current) - 28)})`}>
          <rect x={-30} width={60} height={22} rx={6} className="fill-card stroke-border" strokeWidth={0.8} />
          <text y={10} textAnchor="middle" className="fill-foreground" fontSize={8.5} fontWeight={700}>{brl0(last.current)}</text>
          {diff != null ? <text y={18.5} textAnchor="middle" className="fill-muted-foreground" fontSize={7}>({pctText(diff)})</text> : null}
        </g>
        {xTicks.map((day) => (
          <text key={day} x={day === last.day && day > 21 ? x(day) + 4 : x(day)} y={H - 6} textAnchor={day === last.day && day > 21 ? "end" : "middle"} className="fill-muted-foreground" fontSize={8}>{day} {mon}</text>
        ))}
      </svg>
    </section>
  );
}

/** Principais categorias do período (as 3 maiores), cada uma com a variação contra o habitual. */
export function TopCategories({ story, windowEnd }: { story: ReportStory; windowEnd: string }) {
  const rows = story.categories.slice(0, 3);
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.total), 1);
  const [, mm, dd] = windowEnd.split("-");
  return (
    <section aria-label="Principais categorias" className="rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <p className="text-[15px] font-bold">Principais categorias <span className="text-[12px] font-normal text-muted-foreground">(até {Number(dd)} {monthName(`2000-${mm}`).slice(0, 3)})</span></p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => {
          const Icon = categoryIcon(r.name);
          return (
            <li key={r.id ?? r.name} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3">
              <Icon size={18} className="text-primary" aria-hidden />
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-[88px] shrink-0 truncate text-[13px] font-medium">{r.name}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-secondary" aria-hidden>
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (r.total / max) * 100)}%` }} />
                </span>
              </span>
              <span className="text-[13px] font-semibold tabular-nums">{brl0(r.total)}</span>
              {r.deltaPct != null ? <VariationChip ratio={r.deltaPct} /> : <span />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tela 2 — O que mudou no seu mês
// ---------------------------------------------------------------------------

export function CostSplitCards({ story }: { story: ReportStory }) {
  const s = story.split;
  if (!s) return null;
  const cells = [
    { label: "Gastos fixos", icon: Layers, value: s.essential, share: s.essentialShare, tip: "Fixos são as categorias que você marcou como essenciais (moradia, contas, dívidas…)." },
    { label: "Gastos ajustáveis", icon: SlidersHorizontal, value: s.adjustable, share: 1 - s.essentialShare, tip: "Ajustáveis é todo o resto: o que dá para escolher de um mês para o outro." },
  ];
  return (
    <section aria-label="Gastos fixos e ajustáveis" className="grid grid-cols-2 gap-2">
      {cells.map((c) => (
        <div key={c.label} className="rounded-2xl border border-border bg-card p-3">
          <c.icon size={18} className="text-primary" aria-hidden />
          <p className="mt-2 flex items-center gap-1 text-[13px] font-semibold">{c.label}<InfoTip label={c.label}>{c.tip}</InfoTip></p>
          <p className="font-display text-[22px] font-bold leading-tight tabular-nums">{brl0(c.value)}</p>
          <p className="text-[12px] text-muted-foreground tabular-nums">{Math.round(c.share * 100)}% do total</p>
        </div>
      ))}
    </section>
  );
}

/** O que mais subiu contra o habitual, por estabelecimento. */
export function VariationsCard({ story }: { story: ReportStory }) {
  const rows = story.variations.slice(0, 3);
  if (rows.length === 0) return null;
  return (
    <section aria-label="Principais variações" className="rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <p className="text-[15px] font-bold">Principais variações</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">Categorias que mais aumentaram em relação ao seu habitual.</p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3">
            <IconBadge icon={categoryIcon(r.label)} className="rounded-full" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold capitalize">{r.label}</p>
              <p className="text-[12px] text-muted-foreground">{brl0(r.total)} no mês</p>
            </div>
            <span className="shrink-0 rounded-full bg-red-500/10 px-2.5 py-1 text-[12px] font-semibold tabular-nums text-red-700">
              +{brl0(r.deltaAbs)} ({pctText(r.deltaPct)})
              <span className="sr-only"> acima do habitual</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Contas e assinaturas que ficaram mais caras (mesma cobrança, valor maior). */
export function PriceChangesCard({ story }: { story: ReportStory }) {
  const rows = (story.priceChanges ?? []).slice(0, 2);
  if (rows.length === 0) return null;
  return (
    <section aria-label="Preços que subiram" className="rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <p className="flex items-center gap-1 text-[15px] font-bold">Preços que subiram
        <InfoTip label="preços que subiram">Cobranças mensais que se repetem com valor parecido e neste mês vieram mais caras. Vale conferir se mudou de plano ou se foi reajuste.</InfoTip>
      </p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3">
            <IconBadge icon={ReceiptText} className="rounded-full" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold capitalize">{r.label}</p>
              <p className="text-[12px] text-muted-foreground tabular-nums">de {brl0(r.from)} para {brl0(r.to)} por mês</p>
            </div>
            <span className="shrink-0 rounded-full bg-red-500/10 px-2.5 py-1 text-[12px] font-semibold tabular-nums text-red-700">
              +{brl0(r.deltaAbs)} (+{Math.round(r.deltaPct * 100)}%)
              <span className="sr-only"> a mais por mês</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Média diária por dia da semana, com o destaque de fim de semana quando ele pesa. */
export function WeekdayCard({ story }: { story: ReportStory }) {
  const w = story.weekday;
  if (!w) return null;
  const max = Math.max(...w.rows.map((r) => r.avg), 1);
  return (
    <section aria-label="Gastos por dia da semana" className="rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <p className="flex items-center gap-1 text-[15px] font-bold">Seu padrão de gastos por dia da semana
        {w.scope === "adjustable" ? <InfoTip label="padrão por dia">Sem os gastos fixos (aluguel, contas e dívidas), que caem num dia só e não dizem nada sobre o seu comportamento.</InfoTip> : null}
      </p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">Média diária por dia da semana ({monthName(story.month)}).</p>
      <ul className="mt-4 grid grid-cols-7 items-end gap-1.5">
        {w.rows.map((r) => (
          <li key={r.dow} className="flex flex-col items-center gap-1">
            <span className="text-[9.5px] font-semibold tabular-nums">{brl0(r.avg)}</span>
            <span className="flex h-24 w-full items-end">
              <span className={cn("w-full rounded-t-md", r.dow === w.peakDow ? "bg-primary" : "bg-primary/30")} style={{ height: `${Math.max(4, (r.avg / max) * 100)}%` }} aria-hidden />
            </span>
            <span className={cn("text-[11px]", r.dow === w.peakDow ? "font-bold" : "text-muted-foreground")}>{r.label}</span>
          </li>
        ))}
      </ul>
      {w.weekend ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl bg-amber-500/10 p-3">
          <Zap size={20} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
          <div className="min-w-0">
            <p className="text-[14px] font-bold leading-snug">Seus gastos de fim de semana estão acima do resto da semana</p>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              Você gasta, em média, {Math.round(w.weekend.pct * 100)}% a mais por dia no sábado e no domingo ({brl0(w.weekend.weekendAvg)} vs. {brl0(w.weekend.weekdayAvg)} no restante da semana).
            </p>
            <Link to="/app/lancamentos" className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-primary">Ver detalhes e transações <ArrowRight size={12} aria-hidden /></Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tela 3 — Para onde você vai
// ---------------------------------------------------------------------------

const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Como o mês deve fechar, em saldo: o que sobra depois de pagar tudo e o saldo previsto no fim do mês. */
export function BalanceOutlookCard({ future }: { future: FutureView | null | undefined }) {
  const o = future?.outlook;
  if (!o || (o.freeAfterCommitments == null && o.projectedEnd == null)) return null;
  const rows: Array<{ label: string; value: number; hint?: string; strong?: boolean }> = [];
  if (o.expectedIncome) rows.push({ label: `Renda prevista · ${dayMonth(o.expectedIncome.date)}`, value: o.expectedIncome.amount, hint: o.expectedIncome.source === "configured" ? "informada no seu perfil" : "estimada pelo seu histórico" });
  if (o.freeAfterCommitments != null) rows.push({ label: "Livre depois de pagar tudo", value: o.freeAfterCommitments, strong: true });
  if (o.projectedEnd != null) rows.push({ label: "Saldo previsto no fim do mês", value: o.projectedEnd });
  return (
    <section aria-label="Como o mês deve fechar" className="rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <p className="flex items-center gap-2 text-[14px] font-bold"><ShieldCheck size={18} className="text-primary" aria-hidden /> Como o mês deve fechar
        <InfoTip label="como o mês deve fechar">Livre depois de pagar tudo = saldo de hoje + renda prevista − compromissos e fatura do cartão. O saldo previsto desconta também o ritmo de gasto até o fim do mês.</InfoTip>
      </p>
      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start justify-between gap-3">
            <span className="min-w-0 text-[13px]">
              <span className={cn(r.strong && "font-semibold")}>{r.label}</span>
              {r.hint ? <span className="block text-[11px] text-muted-foreground">{r.hint}</span> : null}
            </span>
            <span className={cn("shrink-0 tabular-nums", r.strong ? "font-display text-[20px] font-bold" : "text-[14px] font-semibold")}>{r.value < 0 ? "−" : ""}{brl0(Math.abs(r.value))}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const GOAL_STATUS: Record<string, { label: string; cls: string }> = {
  on_track: { label: "No ritmo", cls: "bg-emerald-500/10 text-emerald-700" },
  attention: { label: "Atenção", cls: "bg-amber-500/15 text-amber-700" },
  at_risk: { label: "Em risco", cls: "bg-amber-500/15 text-amber-700" },
  limit_reached: { label: "No limite", cls: "bg-amber-500/15 text-amber-700" },
  exceeded: { label: "Estourou", cls: "bg-red-500/10 text-red-700" },
};

/** Metas de gasto por categoria que estão valendo hoje (as mesmas da aba Metas). */
export function SpendingGoalsCard({ future }: { future: FutureView | null | undefined }) {
  const goals = future?.spendingGoals ?? [];
  if (goals.length === 0) return null;
  return (
    <Link to="/app/metas" aria-label="Metas de gasto" className="block rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <p className="flex items-center justify-between text-[14px] font-bold"><span className="flex items-center gap-2"><Target size={18} className="text-primary" aria-hidden /> Metas de gasto</span><ChevronRight size={16} className="text-muted-foreground" aria-hidden /></p>
      <ul className="mt-3 space-y-3.5">
        {goals.map((g) => {
          const st = GOAL_STATUS[g.status] ?? GOAL_STATUS.on_track;
          const Icon = categoryIcon(g.category);
          return (
            <li key={g.id}>
              <div className="flex items-center gap-2">
                <Icon size={16} className="shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{g.category}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>{st.label}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary" role="img" aria-label={`${Math.round(g.pct * 100)}% da meta de ${g.category}`}>
                <div className={cn("h-full rounded-full", g.pct > 1 ? "bg-red-500" : "bg-primary")} style={{ width: `${Math.min(100, Math.max(2, g.pct * 100))}%` }} />
              </div>
              <p className="mt-1 flex justify-between text-[11.5px] text-muted-foreground tabular-nums">
                <span>{brl0(g.spent)} de {brl0(g.limit)}</span>
                <span>{Math.round(g.pct * 100)}%{g.daysRemaining != null && g.daysRemaining > 0 ? ` · faltam ${g.daysRemaining} dias` : ""}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </Link>
  );
}

const COMMITMENT_ROWS: Record<string, { label: string; icon: LucideIcon }> = {
  cards: { label: "Parcelas (cartão e compras)", icon: CreditCard },
  debts: { label: "Dívidas", icon: Landmark },
  recurring: { label: "Recorrências (assinaturas, planos etc.)", icon: Repeat },
};

export function CommitmentsCard({ future }: { future: FutureView | null | undefined }) {
  const c = future?.commitments;
  if (!c) return null;
  return (
    <section aria-label="Compromissos próximos" className="rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <div className="flex items-start gap-3">
        <IconBadge icon={CalendarClock} className="h-11 w-11 rounded-2xl" />
        <div>
          <p className="text-[14px] font-bold">Compromissos próximos (30 dias)</p>
          <p className="font-display text-[28px] font-bold leading-tight tabular-nums">{brl0(c.total)}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {c.groups.map((g) => {
          const row = COMMITMENT_ROWS[g.key];
          return (
            <li key={g.key} className="flex items-center gap-3 text-[13px]">
              <row.icon size={16} className="shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex-1">{row.label}</span>
              <span className="font-semibold tabular-nums">{brl0(g.amount)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ReceivableCard({ future }: { future: FutureView | null | undefined }) {
  const r = future?.receivable;
  if (!r) return null;
  return (
    <Link to={r.fromPeople > 0 ? "/app/divisao-do-role" : "/app/compromissos"} aria-label={`A receber ${brl0(r.total)}`}
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <Wallet size={20} className="text-primary" aria-hidden />
      <span className="flex-1 text-[14px] font-bold">A receber</span>
      <span className="font-display text-[18px] font-bold tabular-nums">{brl0(r.total)}</span>
      <ChevronRight size={16} className="text-muted-foreground" aria-hidden />
    </Link>
  );
}

/** Poupança sustentável (renda típica − gasto típico) e gasto recuperável (excesso em itens ajustáveis). */
export function OpportunityTiles({ story }: { story: ReportStory }) {
  const savings = story.sustainableSavings;
  const rec = story.recoverable;
  if (!savings && !rec) return null;
  return (
    <section aria-label="Oportunidades" className="grid grid-cols-2 gap-2">
      {savings ? (
        <div className="rounded-2xl border border-border bg-primary/5 p-3">
          <p className="flex items-center gap-1 text-[12.5px] font-bold"><PiggyBank size={16} className="text-primary" aria-hidden /> Poupança sustentável
            <InfoTip label="poupança sustentável">É a renda típica menos o gasto típico dos últimos {savings.months} meses fechados (mediana).</InfoTip></p>
          <p className="mt-1.5 font-display text-[22px] font-bold leading-tight tabular-nums">{brl0(savings.monthly)}<span className="text-[13px]">/mês</span></p>
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">Valor que você pode guardar mantendo seu padrão atual.</p>
        </div>
      ) : null}
      {rec ? (
        <div className="rounded-2xl border border-border bg-amber-500/10 p-3">
          <p className="flex items-center gap-1 text-[12.5px] font-bold"><Sparkles size={16} className="text-amber-600" aria-hidden /> Gasto recuperável
            <InfoTip label="gasto recuperável">Quanto você gastou acima do seu habitual, só em categorias que não são fixas: {rec.items.map((i) => i.name).join(", ")}.</InfoTip></p>
          <p className="mt-1.5 font-display text-[22px] font-bold leading-tight tabular-nums">{brl0(rec.amount)}<span className="text-[13px]"> neste mês</span></p>
          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">Despesas que podem ser reduzidas sem impactar seu dia a dia.</p>
        </div>
      ) : null}
    </section>
  );
}

export function ActionCard({ story, future }: { story: ReportStory; future?: FutureView | null }) {
  const a = story.action;
  if (!a) return null;
  // Se a categoria da ação tem meta de gasto valendo, mostra quanto dela já foi usado.
  const goal = a.categoryId ? future?.spendingGoals?.find((g) => g.categoryId === a.categoryId) ?? null : null;
  return (
    <Link to="/app/lancamentos" aria-label={`Ação recomendada: reduzir ${a.merchant}`} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <IconBadge icon={Target} className="rounded-full" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold">Ação recomendada</p>
        <p className="text-[16px] font-bold leading-tight">Reduzir <span className="capitalize">{a.merchant}</span> em {brl0(a.excess)}</p>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
          Você gastou {brl0(a.total)} em {a.merchant} neste mês. Voltar ao seu habitual ({brl0(a.habitual)}) é uma redução de {Math.round(a.reductionPct * 100)}%.
        </p>
        {goal ? <p className="mt-1 text-[12px] font-semibold text-primary">Meta de {goal.category}: {Math.round(goal.pct * 100)}% usada ({brl0(goal.spent)} de {brl0(goal.limit)}).</p> : null}
      </div>
      <ChevronRight size={16} className="mt-1 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

export function GoalProgressCard({ future }: { future: FutureView | null | undefined }) {
  const g = future?.goal;
  if (!g) return null;
  return (
    <Link to="/app/metas" aria-label={`Meta ${g.name}`} className="block rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[14px] font-bold"><PiggyBank size={18} className="text-primary" aria-hidden /> Meta: {g.name}</p>
        <p className="text-[14px] font-bold tabular-nums">{brl0(g.target)}</p>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-secondary" role="img" aria-label={`${Math.round(g.pct * 100)}% da meta`}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(g.pct > 0 ? 2 : 0, g.pct * 100)}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[12px]">
        <span className="font-semibold tabular-nums">{brl0(g.contributed)} ({Math.round(g.pct * 100)}%)</span>
        <span className="text-muted-foreground tabular-nums">Faltam {brl0(g.remaining)}</span>
      </div>
    </Link>
  );
}
