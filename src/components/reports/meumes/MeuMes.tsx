import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Download, Loader2, MoreHorizontal, Printer, RefreshCw, RotateCcw } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { CompareKind, OverviewV2, Recommendation, ReportV2 } from "@/lib/engine/reportV2";
import { buildEditorial, type Anchor, type Editorial } from "@/lib/engine/reportEditorial";
import { useRecommendationAction } from "@/lib/reports/recommendationActions";
import { cn } from "@/lib/utils";
import { CategoriesPanel, QualityList } from "@/components/reports/v2/tabs";
import { ActionCard, ChartReadout, Chip, DisclosureSheet, LedgerLines, brl0, brl2, ddmm, mon, monthFull, monthTitle, signed0, smoothPath, useSheet } from "@/components/reports/v2/ui";

// "Meu mês" (handoff one page, 25/11/2026): uma rota, seis capítulos em ordem fixa, índice por âncoras e
// detalhes sob demanda. Só apresentação: todos os números vêm do relatório canônico (report_v2).
// Tokens do handoff: profundo #21164F; primário #6D3BFF; violeta #8B5CF6; canvas #F8F7FC; neutros #EAE4F7/#DDD8E9;
// texto secundário #666274; sucesso #16A37A, risco #DC4C64, atenção #E9A23B.
// Tipografia: título 26/32 700; capítulo 22/28 700; subtítulo 16/22 600; KPI hero 36/40; KPI de capítulo 32/36;
// KPI secundário 22/28; corpo 14/21; legenda 12/16. Hero: padding 20, raio 24. Cartão pontual: padding 16, raio 16.

export const CHAPTERS: Array<{ id: Anchor; n: string; nav: string; label: string }> = [
  { id: "momento", n: "01", nav: "Hoje", label: "Seu momento" },
  { id: "gastos", n: "02", nav: "Gastos", label: "O que aconteceu" },
  { id: "habitos", n: "03", nav: "Hábitos", label: "Conheça seus hábitos" },
  { id: "futuro", n: "04", nav: "Futuro", label: "Olhando para frente" },
  { id: "evolucao", n: "05", nav: "Evolução", label: "Sua trajetória" },
  { id: "acao", n: "06", nav: "Ação", label: "Seu próximo passo" },
];

const C = { deep: "#21164F", primary: "#6D3BFF", violet: "#8B5CF6", lilac: "#C4B5FD", neutral: "#EAE4F7", line: "#DDD8E9", muted: "#666274", success: "#16A37A", risk: "#DC4C64", alert: "#E9A23B" };
const ANCHOR_OFFSET = 72; // altura do índice fixo + respiro

const lastDayOf = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const shiftMonth = (ym: string, delta: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const kfmt = (v: number) => `${v < 0 ? "−" : v > 0 ? "+" : ""}${Math.abs(v) >= 1000 ? `${(Math.abs(v) / 1000).toFixed(1).replace(".", ",")}k` : Math.round(Math.abs(v))}`;
/** Largura real do contêiner, para o gráfico não esticar texto nem ficar pequeno no desktop. */
function useWidth(fallback = 340) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Valor monetário: "R$" menor, número tabular. hero 36/40 · ch 32/36 · sec 22/28. */
function Amount({ v, size = "sec", className }: { v: number; size?: "hero" | "ch" | "sec"; className?: string }) {
  const cls = { hero: "text-[32px] leading-9", ch: "text-[32px] leading-[36px]", sec: "text-[22px] leading-7" }[size];
  const cur = { hero: "text-lg", ch: "text-base", sec: "text-sm" }[size];
  return (
    <span className={cn("inline-flex items-baseline font-bold tabular-nums tracking-tight", cls, className)}>
      {v < 0 ? "−" : ""}<span className={cn("mr-1 font-semibold opacity-60", cur)}>R$</span>{Math.abs(Math.round(v)).toLocaleString("pt-BR")}
    </span>
  );
}

function Eyebrow({ n, label, dark }: { n: string; label: string; dark?: boolean }) {
  return <p className={cn("text-xs font-semibold uppercase leading-4 tracking-[0.04em]", dark ? "text-[#C4B5FD]" : "text-[#6D3BFF]")}>{n} / {label}</p>;
}

function Chapter({ id, title, children, plain }: { id: Anchor; title?: ReactNode; children: ReactNode; plain?: boolean }) {
  const ch = CHAPTERS.find((c) => c.id === id)!;
  return (
    <section id={id} data-chapter={id} aria-labelledby={`${id}-titulo`} style={{ scrollMarginTop: ANCHOR_OFFSET }} className={cn(!plain && "border-t border-[#EAE4F7] pt-8")}>
      <Eyebrow n={ch.n} label={ch.label} />
      <h2 id={`${id}-titulo`} className={cn("mt-1 text-[22px] font-bold leading-7 text-[#21164F] dark:text-foreground", !title && "sr-only")}>{title ?? ch.label}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Bloco pontual (raio 16, padding 16, sem sombra pesada). Só quando agrupa informação. */
function Block({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return <div role={label ? "group" : undefined} aria-label={label} className={cn("rounded-2xl border border-[#EAE4F7] bg-card p-4 shadow-card print:break-inside-avoid", className)}>{children}</div>;
}

function Sub({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("text-base font-semibold leading-[22px] text-[#21164F] dark:text-foreground", className)}>{children}</h3>;
}

function Explore({ children, onClick, to, dark }: { children: ReactNode; onClick?: () => void; to?: string; dark?: boolean }) {
  const cls = cn("inline-flex min-h-[44px] items-center gap-0.5 text-sm font-semibold print:hidden", dark ? "text-white" : "text-[#6D3BFF]");
  return to ? <Link to={to} className={cls}>{children}<ChevronRight size={16} aria-hidden /></Link> : <button type="button" onClick={onClick} className={cls}>{children}<ChevronRight size={16} aria-hidden /></button>;
}

// ---------------------------------------------------------------------------
// Cabeçalho, seletor de mês e índice
// ---------------------------------------------------------------------------

export function MeuMesHeader({ onExport, exporting }: { onExport: () => void; exporting: boolean }) {
  return (
    <header className="flex items-start justify-between gap-3">
      <h1 className="font-display text-[26px] font-bold leading-8 tracking-tight text-[#21164F] dark:text-foreground">Meu mês</h1>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Ações do relatório" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#DDD8E9] bg-card print:hidden">
          {exporting ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <MoreHorizontal size={18} aria-hidden />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onExport} disabled={exporting}><Download size={16} className="mr-2" aria-hidden />Exportar CSV</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => window.print()}><Printer size={16} className="mr-2" aria-hidden />Imprimir</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

export function MonthPicker({ month, thisMonth, today, onPick }: { month: string; thisMonth: string; today: string; onPick: (m: string) => void }) {
  const options = Array.from({ length: 18 }, (_, i) => shiftMonth(thisMonth, -i));
  const current = month === thisMonth;
  const left = lastDayOf(month) - Number(today.slice(8, 10));
  return (
    <div className="mt-3 flex items-center gap-1 print:hidden" role="group" aria-label="Mês do relatório">
      <button type="button" aria-label="Mês anterior" onClick={() => onPick(shiftMonth(month, -1))} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#21164F] dark:text-foreground"><ChevronLeft size={20} aria-hidden /></button>
      <div className="relative flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center">
        <span className="flex items-center gap-1.5 text-base font-semibold leading-[22px]"><CalendarDays size={18} className="text-[#6D3BFF]" aria-hidden />{monthTitle(month)}<ChevronDown size={16} className="text-[#666274]" aria-hidden /></span>
        <span className="text-xs leading-4 text-[#666274]">{current ? `Até ${ddmm(today)} · ${left === 0 ? "último dia" : `faltam ${left} ${left === 1 ? "dia" : "dias"}`}` : "Mês encerrado"}</span>
        <select aria-label="Escolher o mês" value={month} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
          {options.map((m) => <option key={m} value={m}>{monthTitle(m)}</option>)}
        </select>
      </div>
      <button type="button" aria-label="Mês seguinte" disabled={month >= thisMonth} onClick={() => onPick(shiftMonth(month, 1))} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[#21164F] disabled:opacity-30 dark:text-foreground"><ChevronRight size={20} aria-hidden /></button>
    </div>
  );
}

export function scrollToChapter(id: Anchor) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  try { window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${id}`); } catch { /* sem histórico (teste) */ }
  (el.querySelector("h2") as HTMLElement | null)?.focus?.({ preventScroll: true });
}

/** Índice compacto e fixo. A âncora ativa acompanha a seção visível. Rolagem horizontal só aqui. */
export function AnchorNav({ watch }: { watch?: unknown }) {
  const [active, setActive] = useState<Anchor>("momento");
  const navRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Ativa = último capítulo cujo topo já passou da linha do índice fixo.
    const onScroll = () => {
      let cur: Anchor = "momento";
      for (const c of CHAPTERS) { const el = document.getElementById(c.id); if (el && el.getBoundingClientRect().top <= ANCHOR_OFFSET + 8) cur = c.id; }
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      setActive(atBottom ? "acao" : cur);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [watch]);
  useEffect(() => {
    // Só rolagem horizontal do índice (scrollIntoView aqui moveria a página inteira).
    const box = navRef.current;
    const btn = box?.querySelector(`[data-anchor="${active}"]`) as HTMLElement | null;
    if (box && btn) {
      const left = btn.offsetLeft - box.offsetLeft;
      if (left < box.scrollLeft || left + btn.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = Math.max(0, left - 16);
    }
  }, [active]);
  return (
    <nav aria-label="Capítulos do mês" className="sticky top-0 z-20 -mx-4 mt-2 bg-[#F8F7FC]/95 px-4 md:-mx-6 md:px-6 backdrop-blur supports-[backdrop-filter]:bg-[#F8F7FC]/80 dark:bg-background/95 print:hidden">
      <div ref={navRef} className="flex gap-1 overflow-x-auto border-b border-[#EAE4F7] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CHAPTERS.map((c) => (
          <a key={c.id} href={`#${c.id}`} data-anchor={c.id} aria-current={active === c.id ? "location" : undefined}
            onClick={(e) => { e.preventDefault(); setActive(c.id); scrollToChapter(c.id); }}
            className={cn("relative inline-flex min-h-[44px] shrink-0 items-center px-2.5 text-sm leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D3BFF]",
              active === c.id ? "font-semibold text-[#6D3BFF]" : "text-[#666274]")}>
            {c.nav}
            <span className={cn("absolute inset-x-2.5 bottom-0 h-0.5 rounded-full", active === c.id ? "bg-[#6D3BFF]" : "bg-transparent")} aria-hidden />
          </a>
        ))}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// 01 · Seu momento (hero escuro 1 de 2)
// ---------------------------------------------------------------------------

function MomentHero({ rep, ed }: { rep: ReportV2; ed: Editorial }) {
  const o = rep.overview;
  const sheet = useSheet();
  const cur = rep.isCurrentMonth;
  const cash = rep.projections.cash;
  const debtWarn = rep.quality.find((q) => q.code === "debt_unsplit");
  const d = ed.dominant;
  return (
    <section id="momento" data-chapter="momento" aria-labelledby="momento-titulo" style={{ scrollMarginTop: ANCHOR_OFFSET }} className="rounded-[24px] bg-gradient-hero p-5 text-white shadow-hero print:break-inside-avoid" data-hero>
      <Eyebrow n="01" label="Seu momento" dark />
      <h2 id="momento-titulo" tabIndex={-1} className="mt-1.5 text-[15px] font-semibold leading-[21px] outline-none">{d.title} <span className="font-normal text-white/75">{d.detail}</span></h2>
      {o ? (
        <>
          <p className="mt-3 text-xs leading-4 text-white/70">{cur ? "Disponível hoje" : "Você consumiu no mês"}</p>
          {cur ? (o.balance.available != null ? <Amount v={o.balance.available} size="hero" /> : <p className="text-[22px] font-bold leading-7 text-white/70">Saldo indisponível</p>) : <Amount v={o.consumption} size="hero" />}
          {debtWarn && !cur ? <p className="mt-1 flex items-start gap-1.5 text-xs leading-4 text-[#F6C97A]"><AlertTriangle size={14} className="mt-px shrink-0" aria-hidden />Dívidas sem juros informados: consumo e resultado podem estar subestimados.</p> : null}
          <dl className="mt-3 grid grid-cols-2 divide-x divide-white/15 border-t border-white/15 pt-2.5">
            {cur ? (
              <>
                <div className="pr-3"><dt className="text-xs leading-4 text-white/70">Consumo até {ddmm(rep.today)}</dt><dd className="text-base font-semibold leading-[22px] tabular-nums">{brl0(o.consumption)}</dd>
                  {debtWarn ? <dd className="mt-0.5 flex items-start gap-1 text-[11px] leading-[14px] text-[#F6C97A]"><AlertTriangle size={12} className="mt-px shrink-0" aria-hidden />pode estar subestimado</dd> : null}</div>
                <div className="pl-3"><dt className="text-xs leading-4 text-white/70">Saldo projetado em {String(lastDayOf(rep.month)).padStart(2, "0")}/{rep.month.slice(5, 7)}</dt><dd className="text-base font-semibold leading-[22px] tabular-nums">{cash ? brl0(cash.projectedEnd) : "Indisponível"}</dd></div>
              </>
            ) : (
              <>
                <div className="pr-3"><dt className="text-xs leading-4 text-white/70">Receitas</dt><dd className="text-base font-semibold leading-[22px] tabular-nums">{brl0(o.income.realized)}</dd></div>
                <div className="pl-3"><dt className="text-xs leading-4 text-white/70">Resultado</dt><dd className="text-base font-semibold leading-[22px] tabular-nums">{signed0(o.result.value)}</dd></div>
              </>
            )}
          </dl>
          {cur && o.income.expected ? <p className="mt-2 text-xs leading-4 text-white/70">Próxima entrada prevista: <b className="font-semibold text-white">{brl0(o.income.expected.amount)}</b> em {ddmm(o.income.expected.date)}</p> : null}
          <Explore dark onClick={() => sheet.show("moment")}>Receitas, resultado e caixa</Explore>
        </>
      ) : null}
      {o ? (
        <DisclosureSheet {...sheet.props("moment")} title="Receitas, resultado e caixa" description={cur ? `Até ${ddmm(rep.today)}.` : `${monthTitle(rep.month)}, mês encerrado.`}>
          <p className="font-semibold">Receitas</p>
          <LedgerLines lines={[{ label: "Recebidas no mês", value: brl2(o.income.realized) }, ...(o.income.expected ? [{ label: `Prevista para ${ddmm(o.income.expected.date)} (não recebida)`, value: brl2(o.income.expected.amount), muted: true }] : [])]} />
          <p className="mt-4 font-semibold">Resultado {o.result.partial ? "parcial" : "do mês"}</p>
          <LedgerLines lines={[{ label: "Receitas realizadas", value: brl2(o.income.realized) }, { label: "Consumo", value: brl2(o.consumption), sign: "−" }]} total={{ label: "Resultado", value: brl2(o.result.value) }} />
          {o.result.partial ? <p className="mt-1 text-xs leading-4 text-muted-foreground">Parcial: a renda do mês ainda não entrou por inteiro.</p> : null}
          {o.debt.paid > 0 ? <p className="mt-1 text-xs leading-4 text-muted-foreground">Fora do consumo: {brl2(o.debt.paid)} de principal de dívida pago.</p> : null}
          {o.cashBridge ? (
            <>
              <p className="mt-4 font-semibold">Caixa no mês</p>
              <LedgerLines lines={[
                { label: "Saldo no início do mês (derivado)", value: brl2(o.cashBridge.opening) },
                ...o.cashBridge.inflows.map((i) => ({ label: i.label, value: brl2(i.amount), sign: "+" as const })),
                ...o.cashBridge.outflows.map((x) => ({ label: x.label, value: brl2(x.amount), sign: "−" as const })),
              ]} total={{ label: "Saldo hoje", value: brl2(o.cashBridge.closing) }} />
            </>
          ) : null}
          {debtWarn ? <p className="mt-4 flex items-start gap-2 rounded-xl bg-[#E9A23B]/10 p-3 text-xs leading-4"><AlertTriangle size={14} className="mt-px shrink-0 text-[#B7791F]" aria-hidden />{debtWarn.text}{debtWarn.fix ? ` ${debtWarn.fix}` : ""}</p> : null}
        </DisclosureSheet>
      ) : null}
    </section>
  );
}

function Complementary({ ed }: { ed: Editorial }) {
  if (ed.complementary.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1" aria-label="Outros destaques">
      {ed.complementary.map((c) => (
        <li key={c.id}>
          <button type="button" onClick={() => scrollToChapter(c.anchor)} className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl bg-primary/[0.07] px-3.5 py-2 text-left">
            <span className="min-w-0 truncate text-[13px] leading-5"><b className="font-semibold">{c.title.replace(/,$/, ".")}</b></span>
            <ChevronRight size={16} className="shrink-0 text-[#6D3BFF]" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 02 · O que aconteceu
// ---------------------------------------------------------------------------

function SpendTrend({ o, rep }: { o: OverviewV2; rep: ReportV2 }) {
  const pts = o.curve;
  const gid = useId().replace(/:/g, "");
  const [sel, setSel] = useState<number | null>(null);
  const { ref, w: W } = useWidth();
  if (!pts || pts.length < 2) return <p className="text-sm text-[#666274]">A curva aparece a partir do segundo dia com gasto.</p>;
  const proj = rep.isCurrentMonth ? o.curveProjection : null;
  const H = 220; const L = 36; const R = 56; const T = 14; const B = 22;
  const lastDay = proj ? proj[proj.length - 1].day : lastDayOf(rep.month);
  const last = pts[pts.length - 1];
  const maxRaw = Math.max(...pts.map((p) => Math.max(p.current, p.habitual)), ...(proj ? proj.map((p) => p.high) : [0]), 1);
  const step = maxRaw > 12000 ? 4000 : maxRaw > 6000 ? 2000 : maxRaw > 3000 ? 1000 : maxRaw > 1200 ? 500 : 250;
  const max = Math.ceil(maxRaw / step) * step;
  const x = (d: number) => L + ((d - 1) / Math.max(1, lastDay - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  // Passa por todos os pontos diários reais: nada é reamostrado nem deslocado.
  const real = pts.map((p) => [x(p.day), y(p.current)] as [number, number]);
  const hab = pts.map((p) => [x(p.day), y(p.habitual)] as [number, number]);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const end = proj ? proj[proj.length - 1] : null;
  const projPts = proj ? [[x(last.day), y(last.current)] as [number, number], ...proj.filter((p) => p.day > last.day).map((p) => [x(p.day), y(p.value)] as [number, number])] : null;
  const band = proj && end && Math.round(end.high) > Math.round(end.low) ? `${smoothPath(proj.map((p) => [x(p.day), y(p.high)]))} ${smoothPath(proj.map((p) => [x(p.day), y(p.low)] as [number, number]).reverse(), false)} Z` : null;
  const s = sel != null ? pts[sel] : null;
  const pick = (clientX: number, rect: DOMRect) => { const px = ((clientX - rect.left) / rect.width) * W; const d = Math.round(((px - L) / (W - L - R)) * (lastDay - 1)) + 1; setSel(Math.max(0, Math.min(pts.length - 1, d - 1))); };
  return (
    <figure ref={ref} className="print:break-inside-avoid">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs leading-4 text-[#666274]">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[#6D3BFF]" aria-hidden />Realizado</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[#8B5CF6]/60" aria-hidden />Habitual (mediana de {o.habitual?.months.length ?? 0} meses)</span>
        {proj ? <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[#6D3BFF]" aria-hidden />Projeção</span> : null}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block touch-none select-none" role="img"
        aria-label={`Consumo acumulado em reais por dia do mês: ${brl0(last.current)} até o dia ${last.day}, contra ${brl0(last.habitual)} no habitual${end ? `; projeção de ${brl0(end.value)} no dia ${end.day}` : ""}.`}
        onPointerDown={(e) => pick(e.clientX, (e.currentTarget as SVGSVGElement).getBoundingClientRect())}
        onPointerMove={(e) => { if (e.buttons) pick(e.clientX, (e.currentTarget as SVGSVGElement).getBoundingClientRect()); }}>
        <defs><linearGradient id={`a${gid}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={C.primary} stopOpacity={0.14} /><stop offset="100%" stopColor={C.primary} stopOpacity={0} /></linearGradient></defs>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.line : C.neutral} strokeWidth={t === 0 ? 1 : 0.8} /><text x={L - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={C.muted}>{t >= 1000 ? `${t / 1000}k` : t}</text></g>)}
        {band ? <path d={band} fill={C.primary} fillOpacity={0.07} /> : null}
        <path d={smoothPath(hab)} fill="none" stroke={C.violet} strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" />
        <path d={`${smoothPath(real)} L${real[real.length - 1][0].toFixed(1)} ${y(0).toFixed(1)} L${real[0][0].toFixed(1)} ${y(0).toFixed(1)} Z`} fill={`url(#a${gid})`} />
        {projPts ? <path d={smoothPath(projPts)} fill="none" stroke={C.primary} strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" /> : null}
        <path d={smoothPath(real)} fill="none" stroke={C.primary} strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round" />
        {/* Valores de fim anotados */}
        <text x={x(last.day)} y={y(last.current) - 10} fontSize={10.5} fontWeight={700} fill={C.primary} textAnchor="middle">{kfmt(last.current).replace("+", "")}</text>
        <text x={x(last.day) + 7} y={y(last.habitual) + 4} fontSize={10.5} fill={C.violet}>{kfmt(last.habitual).replace("+", "")}</text>
        {end && Math.abs(end.value - last.current) > max * 0.06 ? <text x={x(end.day) + 4} y={y(end.value) + 4} fontSize={10.5} fill={C.primary}>{kfmt(end.value).replace("+", "")}</text> : null}
        <circle cx={x(last.day)} cy={y(last.current)} r={4} fill="white" stroke={C.primary} strokeWidth={2.2} />
        {s ? <><line x1={x(s.day)} x2={x(s.day)} y1={T} y2={H - B} stroke={C.deep} strokeOpacity={0.25} /><circle cx={x(s.day)} cy={y(s.habitual)} r={3} fill={C.violet} /><circle cx={x(s.day)} cy={y(s.current)} r={4} fill={C.primary} stroke="white" strokeWidth={1.5} /></> : null}
        {[1, 8, 15, 22, lastDay].filter((d, i, a) => a.indexOf(d) === i).map((d) => <text key={d} x={x(d)} y={H - 5} textAnchor="middle" fontSize={10} fill={C.muted}>{d}</text>)}
      </svg>
      <ChartReadout>
        {s ? <span className="flex flex-wrap items-center justify-between gap-x-3">
          <span>Dia {s.day}: <b>{brl0(s.current)}</b> acumulado · habitual {brl0(s.habitual)} · diferença <b>{signed0(s.current - s.habitual)}</b></span>
          <Link to={`/app/lancamentos?start=${rep.month}-01&end=${rep.month}-${String(s.day).padStart(2, "0")}`} className="inline-flex min-h-[32px] items-center font-semibold text-[#6D3BFF]">Lançamentos de 1 a {s.day} (pela data da compra) ›</Link>
        </span> : <>Toque no gráfico para ver um dia: acumulado, habitual e diferença.</>}
      </ChartReadout>
    </figure>
  );
}

const SEG = [C.primary, C.violet, C.lilac, C.line];

function CategoryMix({ rep }: { rep: ReportV2 }) {
  const b = rep.behavior;
  const o = rep.overview;
  if (!b || !o || b.categories.length === 0) return null;
  const top = [...b.categories].sort((x, y) => y.total - x.total).slice(0, 3);
  const rest = Math.round((o.consumption - top.reduce((s, c) => s + c.total, 0)) * 100) / 100;
  const rows = [...top.map((c) => ({ key: c.name, label: c.name, value: c.total })), { key: "rest", label: "Demais gastos", value: rest }];
  // Barra segmentada só quando todas as parcelas são não negativas e fecham o consumo.
  const segmented = o.consumption > 0 && rows.every((r) => r.value >= 0);
  const compared = b.previousRange != null;
  const uncat = rep.quality.find((q) => q.code === "uncategorized");
  return (
    <div>
      <Sub>Para onde foi seu dinheiro</Sub>
      <p className="text-xs leading-4 text-[#666274]">Toque numa categoria para ver os lançamentos · compra no cartão conta no mês da fatura{compared && b.previousRange ? ` · variação vs. ${ddmm(b.previousRange.start)}–${ddmm(b.previousRange.end)} (mês anterior, mesmos dias)` : ""}</p>
      {segmented ? (
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-[#EAE4F7]" role="img" aria-label={rows.map((r) => `${r.label} ${Math.round((r.value / o.consumption) * 100)}%`).join(", ")}>
          {rows.map((r, i) => <span key={r.key} style={{ width: `${(r.value / o.consumption) * 100}%`, background: SEG[i] }} className={i > 0 ? "border-l-2 border-card" : ""} />)}
        </div>
      ) : null}
      <ul className="mt-2 divide-y divide-[#EAE4F7]">
        {rows.map((r, i) => {
          const cat = top.find((c) => c.name === r.key);
          return (
            <li key={r.key} className="flex min-h-[44px] items-center gap-2.5 py-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: segmented ? SEG[i] : C.line }} aria-hidden />
              {cat?.ids?.length ? <Link to={`/app/lancamentos?ids=${cat.ids.join(",")}`} className="min-w-0 flex-1 truncate text-sm leading-5 underline decoration-[#DDD8E9] underline-offset-4">{r.label}</Link> : <span className="min-w-0 flex-1 truncate text-sm leading-5">{r.label}</span>}
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-[#666274]">{o.consumption > 0 ? `${Math.round((r.value / o.consumption) * 100)}%` : "—"}</span>
              <span className="w-[76px] shrink-0 text-right text-sm font-semibold tabular-nums">{r.value < 0 ? "−" : ""}{brl0(Math.abs(r.value))}</span>
              {compared ? <span className="w-[58px] shrink-0 text-right">{cat?.deltaPct != null ? <Chip ratio={cat.deltaPct} base="o mês anterior" /> : <span className="text-xs text-[#666274]">{cat ? "novo" : ""}</span>}</span> : null}
            </li>
          );
        })}
      </ul>
      {uncat ? <p className="mt-1 flex items-start gap-1.5 text-xs leading-4 text-[#B7791F]"><AlertTriangle size={13} className="mt-px shrink-0" aria-hidden />{uncat.text}</p> : null}
    </div>
  );
}

function ChangeDrivers({ rep }: { rep: ReportV2 }) {
  const d = rep.behavior?.drivers;
  if (!d || d.rows.length === 0) return null;
  const top = [...d.rows].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact) || (a.name < b.name ? -1 : 1)).slice(0, 3);
  const residual = Math.round((d.totalDelta - top.reduce((s, r) => s + r.impact, 0)) * 100) / 100;
  const max = Math.max(...top.map((r) => Math.abs(r.impact)), Math.abs(residual), 1);
  const Row = ({ label, v, note, muted }: { label: string; v: number; note?: string; muted?: boolean }) => (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-2 text-sm leading-5"><span className={cn("truncate", muted ? "text-[#666274]" : "font-medium")}>{label}</span><span className={cn("shrink-0 font-semibold tabular-nums", v > 0 && !muted && "text-[#DC4C64]")}>{signed0(v)}</span></div>
      <div className="relative mt-1.5 h-1.5 rounded-full bg-[#EAE4F7]" aria-hidden>
        <span className="absolute inset-y-[-3px] left-1/2 w-px bg-[#21164F]/30" />
        <span className={cn("absolute inset-y-0 rounded-full", muted ? "bg-[#DDD8E9]" : v > 0 ? "bg-[#DC4C64]" : "bg-[#8B5CF6]")} style={v >= 0 ? { left: "50%", width: `${(Math.abs(v) / max) * 50}%` } : { right: "50%", width: `${(Math.abs(v) / max) * 50}%` }} />
      </div>
      {note ? <p className="mt-1 text-xs leading-4 text-[#666274]">{note}</p> : null}
    </li>
  );
  return (
    <div>
      <Sub>O que mais mudou</Sub>
      <p className="text-xs leading-4 text-[#666274]">Contra o habitual · mesmos dias · mediana de {rep.behavior?.habitualBase?.months ?? 0} meses · total {signed0(d.totalDelta)}</p>
      <ul className="mt-1 divide-y divide-[#EAE4F7]">
        {top.map((r) => <Row key={r.name} label={r.name} v={r.impact} note={r.impact < 0 && r.klass === "estrutural" && rep.isCurrentMonth ? "Gasto fixo: pode ser só uma conta que ainda não venceu." : undefined} />)}
        <Row label="Demais categorias e efeito das medianas" v={residual} muted />
      </ul>
    </div>
  );
}

function GastosChapter({ rep, compare, onCompare, month }: { rep: ReportV2; compare: CompareKind; onCompare: (c: CompareKind) => void; month: string }) {
  const o = rep.overview;
  const sheet = useSheet();
  if (!o) return <Chapter id="gastos" title="Seu dinheiro neste mês"><p className="text-sm text-[#666274]">Ainda não há gastos neste mês.</p></Chapter>;
  const h = o.habitual;
  const calendar = rep.isCurrentMonth && h?.deltaPct != null && h.deltaPct <= -0.3;
  const debtWarn = rep.quality.find((q) => q.code === "debt_unsplit");
  return (
    <Chapter id="gastos" title="Seu dinheiro neste mês">
      <div className="lg:grid lg:grid-cols-12 lg:gap-4">
      <Block label="Consumo do mês" className="lg:col-span-7">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Amount v={o.consumption} size="ch" className="text-[#21164F] dark:text-foreground" />
        {h?.deltaPct != null ? <Chip ratio={h.deltaPct} base="habitual" /> : null}
      </div>
      <p className="mt-1 text-xs leading-4 text-[#666274]">Consumo {rep.isCurrentMonth ? `até ${ddmm(rep.today)}` : "do mês"}, líquido de estornos{h ? ` · habitual ${brl0(h.value)} (mediana de ${h.months.length} meses, mesmos dias)` : ""}</p>
      {debtWarn ? <p className="mt-2 flex items-start gap-1.5 text-xs leading-4 text-[#B7791F]"><AlertTriangle size={13} className="mt-px shrink-0" aria-hidden />{brl0(o.debt.unsplit)} em pagamentos de dívida sem juros informados: o consumo pode estar subestimado.</p> : null}
      <div className="mt-4">
        <SpendTrend o={o} rep={rep} />
        {calendar ? <p className="mt-2 text-sm leading-[21px] text-[#666274]">Parte da queda pode ser calendário: contas do mês ainda vão vencer.</p> : null}
      </div>
      </Block>
      <div className="mt-3 space-y-3 lg:col-span-5 lg:mt-0">
        <Block label="Para onde foi seu dinheiro"><CategoryMix rep={rep} /></Block>
        <Block label="O que mais mudou"><ChangeDrivers rep={rep} /></Block>
      </div>
      </div>
      <Explore onClick={() => sheet.show("cats")}>Ver categorias, estabelecimentos e lançamentos</Explore>
      {rep.behavior ? (
        <DisclosureSheet {...sheet.props("cats")} title="Categorias e estabelecimentos" description="Toque numa linha para ver exatamente os lançamentos que formam o valor. Compra no cartão conta no mês da fatura.">
          <CategoriesPanel b={rep.behavior} compare={compare} onCompare={onCompare} month={month} />
        </DisclosureSheet>
      ) : null}
    </Chapter>
  );
}

// ---------------------------------------------------------------------------
// 03 · Conheça seus hábitos
// ---------------------------------------------------------------------------

const CLASS_LABEL = { estrutural: "Fixos", ajustavel: "Ajustáveis", extraordinario: "Extraordinários", nao_classificado: "Sem categoria" } as const;

function HabitosChapter({ rep, month }: { rep: ReportV2; month: string }) {
  const b = rep.behavior;
  if (!b) return <Chapter id="habitos" title="Seus hábitos aparecem com mais lançamentos"><p className="text-sm text-[#666274]">Ainda não há gastos suficientes neste mês.</p></Chapter>;
  const ss = b.smallSpend;
  const w = b.weekday;
  const weekendStrong = w?.weekend && w.weekend.pct >= 0.3;
  const persistOk = w?.persistence ? w.persistence.withPattern / Math.max(1, w.persistence.months) >= 0.5 : false;
  // Descoberta de maior impacto com evidência suficiente.
  const title = ss && ss.count >= 10 && ss.share >= 0.15
    ? `Pequenos gastos somam ${Math.round(ss.share * 100)}% do seu consumo`
    : weekendStrong && w?.weekend
      ? `Seu gasto por dia no fim de semana é ${Math.round(w.weekend.pct * 100)}% maior`
      : b.signals[0]?.title ?? "Como você gasta ao longo do mês";
  const end = `${month}-${String(lastDayOf(month)).padStart(2, "0")}`;
  return (
    <Chapter id="habitos" title={title}>
      <div className="space-y-3 lg:grid lg:grid-cols-12 lg:gap-4 lg:space-y-0">
        {ss ? (
          <Block label="Pequenos gastos" className="lg:col-span-5">
            <Sub>Pequenos gastos</Sub>
            <Amount v={ss.total} size="sec" className="mt-1 text-[#21164F] dark:text-foreground" />
            <p className="text-sm leading-[21px] text-[#666274]">{ss.count} compras de até R$ {ss.ceiling}, fora os fixos · {Math.round(ss.share * 100)}% do consumo</p>
            {ss.topMerchants.length ? <p className="mt-1 text-xs leading-4 text-[#666274]">Mais frequentes: {ss.topMerchants.map((m) => `${m.label} (${m.count})`).join(", ")}</p> : null}
            <Explore to={ss.ids?.length ? `/app/lancamentos?ids=${ss.ids.join(",")}` : `/app/lancamentos?start=${month}-01&end=${end}`}>Ver lançamentos</Explore>
          </Block>
        ) : null}
        {w ? (
          <Block label="Quando você gasta mais" className="lg:col-span-7">
            <WeekdayChart rep={rep} />
            {w.weekend ? (
              <p className="mt-2 text-sm leading-[21px] text-[#666274]">
                Fim de semana {brl0(w.weekend.weekendAvg)}/dia contra {brl0(w.weekend.weekdayAvg)} nos dias úteis.{" "}
                {w.persistence ? (persistOk ? `O padrão se repetiu em ${w.persistence.withPattern} de ${w.persistence.months} meses.` : `Concentração observada neste mês; padrão histórico ainda não confirmado (${w.persistence.withPattern} de ${w.persistence.months} meses).`) : "Sem histórico para confirmar o padrão."}
              </p>
            ) : null}
          </Block>
        ) : null}
      </div>
      {b.patterns.length > 0 ? (
        <ul className="mt-3 space-y-1.5 rounded-2xl border border-[#EAE4F7] bg-card p-4 shadow-card" aria-label="Padrões observados">
          {b.patterns.slice(0, 3).map((p) => (
            <li key={p.label} className="flex items-start justify-between gap-3 text-sm leading-5">
              <span>{p.label}</span>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs", p.status === "validated" ? "bg-[#6D3BFF]/10 text-[#6D3BFF]" : "bg-[#EAE4F7] text-[#666274]")}>{p.status === "validated" ? "confirmado" : "em observação"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <details className="group mt-3 rounded-2xl border border-[#EAE4F7] bg-card px-4 shadow-card print:break-inside-avoid">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between text-sm font-semibold text-[#21164F] dark:text-foreground">Fixos, ajustáveis e hipóteses<ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden /></summary>
        <div className="pb-4">
          <LedgerLines
            lines={(Object.keys(CLASS_LABEL) as Array<keyof typeof CLASS_LABEL>).filter((k) => b.split.classes[k] !== 0).map((k) => {
              const v = b.split.classes[k];
              const pct = b.split.total > 0 ? Math.round((v / b.split.total) * 100) : 0;
              return { label: `${k === "nao_classificado" && v < 0 ? "Estornos sem categoria" : CLASS_LABEL[k]} · ${pct < 0 ? "−" : ""}${Math.abs(pct)}%`, value: brl0(Math.abs(v)), sign: v < 0 ? "−" as const : "+" as const };
            })}
            total={{ label: "Consumo", value: brl0(b.split.total) }}
          />
          <p className="mt-2 text-xs leading-4 text-[#666274]">Fixo não é o mesmo que essencial; ajustável não é supérfluo. Estorno aparece como ajuste negativo.</p>
          {b.signals.length > 0 ? (
            <ul className="mt-3 space-y-2 border-t border-[#EAE4F7] pt-3">
              {b.signals.map((sg) => <li key={sg.key} className="text-sm leading-5"><b className="font-semibold">{sg.title}</b><br /><span className="text-[#666274]">{sg.evidence} · amostra {sg.sample} · confiança {sg.confidence}</span></li>)}
            </ul>
          ) : null}
          <p className="mt-3 text-xs leading-4 text-[#666274]">Hipóteses descrevem o que os dados mostram; não inferem motivo nem emoção.</p>
        </div>
      </details>
    </Chapter>
  );
}

function WeekdayChart({ rep }: { rep: ReportV2 }) {
  const w = rep.behavior?.weekday;
  const [sel, setSel] = useState<number | null>(null);
  if (!w) return null;
  const max = Math.max(...w.rows.map((r) => Math.max(r.avg, r.habitualAvg ?? 0)), 1);
  const s = sel != null ? w.rows[sel] : null;
  const hasHist = w.rows.some((r) => r.habitualAvg != null);
  return (
    <figure className="print:break-inside-avoid">
      <Sub>Quando você gasta mais</Sub>
      <p className="text-xs leading-4 text-[#666274]">Gasto ajustável médio por dia (R$/dia), contando dias sem gasto · {w.sample.days} dias</p>
      <div className="mb-2 mt-2 flex flex-wrap gap-x-4 text-xs leading-4 text-[#666274]">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#6D3BFF]" aria-hidden />Este mês</span>
        {hasHist ? <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-[#21164F]/60" aria-hidden />Histórico ({w.sample.refMonths} meses)</span> : null}
      </div>
      <div className="relative flex h-[150px] items-end gap-2 border-b border-[#DDD8E9]" role="img" aria-label={w.rows.map((r) => `${r.label}: ${brl0(r.avg)} por dia`).join("; ")}>
        {w.rows.map((r, i) => (
          <button key={r.dow} type="button" onClick={() => setSel(i)} aria-label={`${r.label}: ${brl0(r.avg)} por dia em ${r.days} dias${r.habitualAvg != null ? `; histórico ${brl0(r.habitualAvg)}` : ""}`}
            className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end">
            <span className="mb-1 text-[11px] font-semibold tabular-nums text-[#21164F] dark:text-foreground">{Math.round(Math.max(0, r.avg))}</span>
            <span className="relative flex w-full flex-1 items-end justify-center">
              <span className={cn("w-[62%] rounded-t-md", r.dow === w.peakDow || sel === i ? "bg-[#6D3BFF]" : "bg-[#C4B5FD]")} style={{ height: `${Math.max(1.5, (Math.max(0, r.avg) / max) * 100)}%` }} />
              {r.habitualAvg != null ? <span className="absolute inset-x-[12%] h-0.5 rounded bg-[#21164F]/60" style={{ bottom: `${(r.habitualAvg / max) * 100}%` }} /> : null}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-2">{w.rows.map((r) => <span key={r.dow} className="flex-1 text-center text-xs text-[#666274]">{r.label}</span>)}</div>
      <ChartReadout>{s ? <>{s.label}: <b>{brl0(s.avg)}/dia</b> em {s.days} dias{s.habitualAvg != null ? ` · histórico ${brl0(s.habitualAvg)}/dia` : ""}{s.avg < 0 ? " · estornos superaram os gastos" : ""}</> : <>Toque numa barra para ver o dia.</>}</ChartReadout>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// 04 · Olhando para frente (hero escuro 2 de 2)
// ---------------------------------------------------------------------------

function useScenario(cash: NonNullable<ReportV2["projections"]["cash"]>) {
  const get = (k: string) => cash.steps.find((s) => s.key === k)?.value ?? 0;
  const base = useMemo(() => ({ income: get("income") + get("income_uncertain"), includeIncome: true, commitments: get("commitments"), card: get("card"), variable: get("variable") }), [cash]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sc, setSc] = useState(base);
  const start = get("start");
  const end = Math.round((start + (sc.includeIncome ? sc.income : 0) - sc.commitments - sc.card - sc.variable) * 100) / 100;
  const changed = JSON.stringify(sc) !== JSON.stringify(base);
  return { sc, setSc, start, end, changed, reset: () => setSc(base) };
}

function Simulator({ cash }: { cash: NonNullable<ReportV2["projections"]["cash"]> }) {
  const { sc, setSc, start, end, changed, reset } = useScenario(cash);
  const field = (k: "income" | "commitments" | "card" | "variable", label: string) => (
    <label className="flex items-center justify-between gap-3 text-sm leading-5">
      <span className="min-w-0">{label}</span>
      <span className="flex items-center gap-1 rounded-xl border border-[#DDD8E9] bg-background px-2"><span className="text-xs text-[#666274]">R$</span>
        <input type="number" inputMode="decimal" min={0} step="0.01" value={sc[k]} onChange={(e) => setSc({ ...sc, [k]: Math.max(0, Number(e.target.value) || 0) })} className="h-11 w-24 bg-transparent text-right tabular-nums outline-none" aria-label={label} /></span>
    </label>
  );
  return (
    <div className="mt-5 rounded-2xl border border-[#EAE4F7] p-4">
      <p className="font-semibold">Simular cenário</p>
      <p className="text-xs leading-4 text-[#666274]">Muda só as premissas desta conta, nesta tela. Nenhum lançamento é alterado.</p>
      <div className="mt-3 space-y-2">
        <p className="flex justify-between text-sm"><span>Saldo hoje (fixo)</span><span className="tabular-nums">{brl2(start)}</span></p>
        <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" checked={sc.includeIncome} onChange={(e) => setSc({ ...sc, includeIncome: e.target.checked })} className="h-5 w-5 accent-[#6D3BFF]" />Contar a renda prevista</label>
        {sc.includeIncome ? field("income", "Renda prevista") : null}
        {field("commitments", "Obrigações até o fim do mês")}
        {field("card", "Fatura do cartão do mês")}
        {field("variable", "Consumo variável previsto")}
      </div>
      <p className="mt-3 flex items-baseline justify-between border-t border-[#EAE4F7] pt-3 font-bold"><span>Saldo no cenário</span><span className={cn("tabular-nums", end < 0 && "text-[#DC4C64]")}>{brl2(end)}</span></p>
      <button type="button" onClick={reset} disabled={!changed} className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-[#6D3BFF] disabled:opacity-40"><RotateCcw size={15} aria-hidden />Restaurar cenário</button>
    </div>
  );
}

const SERIES = { cards: { label: "Cartões", color: C.primary }, debts: { label: "Dívidas", color: C.violet }, recurring: { label: "Recorrências", color: C.lilac } } as const;

function CommitmentTimeline({ rep }: { rep: ReportV2 }) {
  const p = rep.projections;
  const c = p.commitments;
  const sheet = useSheet();
  const [sel, setSel] = useState<string | null>(null);
  if (!c) return null;
  const months = c.months.filter((m) => m.cards + m.debts + m.recurring > 0);
  const max = Math.max(...months.map((m) => m.cards + m.debts + m.recurring), 1);
  const selected = months.find((m) => m.month === sel) ?? null;
  return (
    <div>
      <Sub>Compromissos: {brl0(c.next30)}</Sub>
      <p className="text-sm leading-[21px] text-[#666274]">Próximos 30 dias{c.horizonEnd ? `, até ${ddmm(c.horizonEnd)}` : ""}{p.committedIncome ? ` · equivalente a ${Math.round(p.committedIncome.pct * 100)}% da ${p.committedIncome.basis}` : ""}</p>
      <ul className="mt-2 space-y-1 text-sm leading-5">
        {c.groups.map((g) => <li key={g.key} className="flex justify-between gap-3"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[g.key].color }} aria-hidden />{SERIES[g.key].label}{g.estimated ? <span className="text-xs text-[#666274]">(estimada)</span> : <span className="text-xs text-[#666274]">(confirmado)</span>}</span><span className="font-semibold tabular-nums">{brl0(g.amount)}</span></li>)}
      </ul>
      {c.items && c.items.length > 0 ? <Explore onClick={() => sheet.show("due")}>Ver vencimentos</Explore> : null}
      {months.length > 0 ? (
        <figure className="mt-4 print:break-inside-avoid">
          <p className="text-sm font-semibold leading-5">Próximos 6 meses</p>
          <div className="mb-2 mt-1 flex flex-wrap gap-x-4 text-xs leading-4 text-[#666274]">{(Object.keys(SERIES) as Array<keyof typeof SERIES>).map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[k].color }} aria-hidden />{SERIES[k].label}</span>)}</div>
          <div className="flex h-[150px] items-end gap-2 border-b border-[#DDD8E9]" role="img" aria-label={months.map((m) => `${monthFull(m.month)}: ${brl0(m.cards + m.debts + m.recurring)}`).join("; ")}>
            {months.map((m) => {
              const total = m.cards + m.debts + m.recurring;
              return (
                <button key={m.month} type="button" onClick={() => { setSel(m.month); sheet.show("month"); }} aria-label={`${monthFull(m.month)}: ${brl0(total)} (cartões ${brl0(m.cards)}, dívidas ${brl0(m.debts)}, recorrências ${brl0(m.recurring)})`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                  <span className="mb-1 text-[11px] font-semibold tabular-nums">{kfmt(total).replace("+", "")}</span>
                  <span className="flex w-[64%] flex-col-reverse gap-px overflow-hidden rounded-t-md" style={{ height: `${Math.max(2, (total / max) * 82)}%` }}>
                    {(["cards", "debts", "recurring"] as const).filter((k) => m[k] > 0).map((k) => <span key={k} style={{ height: `${(m[k] / total) * 100}%`, background: SERIES[k].color }} />)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex gap-2">{months.map((m) => <span key={m.month} className="flex-1 text-center text-xs text-[#666274]">{mon(m.month)}</span>)}</div>
          <figcaption className="mt-2 text-xs leading-4 text-[#666274]">Só o que já está registrado como parcela, fatura ou recorrência. Mês sem registro não significa mês sem despesas. Toque num mês para ver a composição.</figcaption>
        </figure>
      ) : null}
      <DisclosureSheet {...sheet.props("due")} title="Vencimentos dos próximos 30 dias" description="Data, origem e valor de cada obrigação.">
        <ul className="divide-y divide-[#EAE4F7]">
          {(c.items ?? []).map((i, k) => <li key={`${i.date}${i.label}${k}`} className="flex items-center justify-between gap-3 py-2"><span className="min-w-0"><span className="block truncate">{i.label}</span><span className="text-xs text-[#666274]">{i.date ? ddmm(i.date) : "sem data"} · {SERIES[i.group].label}{i.estimated ? " · estimada" : ""}</span></span><span className="shrink-0 font-semibold tabular-nums">{brl2(i.amount)}</span></li>)}
        </ul>
      </DisclosureSheet>
      <DisclosureSheet {...sheet.props("month")} title={selected ? `Compromissos de ${monthFull(selected.month)}` : "Compromissos"}>
        {selected ? <LedgerLines lines={(["cards", "debts", "recurring"] as const).map((k) => ({ label: SERIES[k].label, value: brl2(selected[k]) }))} total={{ label: "Total", value: brl2(selected.cards + selected.debts + selected.recurring) }} /> : null}
        {selected && c.items?.some((i) => i.date.startsWith(selected.month)) ? (
          <ul className="mt-3 divide-y divide-[#EAE4F7] border-t border-[#EAE4F7]">{c.items.filter((i) => i.date.startsWith(selected.month)).map((i, k) => <li key={k} className="flex justify-between gap-3 py-2 text-sm"><span>{ddmm(i.date)} · {i.label}</span><span className="tabular-nums">{brl2(i.amount)}</span></li>)}</ul>
        ) : null}
      </DisclosureSheet>
    </div>
  );
}

function FuturoChapter({ rep }: { rep: ReportV2 }) {
  const p = rep.projections;
  const c = p.cash;
  const sheet = useSheet();
  const endIso = `${rep.month}-${String(lastDayOf(rep.month)).padStart(2, "0")}`;
  const closedForecast = rep.evolution.forecast.find((f) => f.month === rep.month);
  return (
    <Chapter id="futuro">
      {!rep.isCurrentMonth ? (
        <Block label="Mês encerrado">
          <Sub>Mês encerrado</Sub>
          <p className="text-sm leading-[21px] text-[#666274]">A previsão de fechamento dá lugar ao realizado.</p>
          {closedForecast ? <p className="mt-2 text-sm leading-[21px]">Previsto em {ddmm(closedForecast.asOf)}: {closedForecast.predictedConsumption != null ? brl0(closedForecast.predictedConsumption) : "—"} · realizado {brl0(closedForecast.actualConsumption)}{closedForecast.consumptionErrorPct != null ? ` (erro ${closedForecast.consumptionErrorPct > 0 ? "+" : "−"}${Math.abs(Math.round(closedForecast.consumptionErrorPct * 100))}%)` : ""}</p>
            : <p className="mt-2 text-xs leading-4 text-[#666274]">Não há previsão gravada para este mês; nada é reconstruído depois.</p>}
        </Block>
      ) : c ? (
        <div className="rounded-[24px] bg-gradient-hero p-5 text-white shadow-hero print:break-inside-avoid" data-hero>
          <p className="text-xs leading-4 text-white/75">Saldo esperado em {ddmm(endIso)}</p>
          <Amount v={c.projectedEnd} size="hero" />
          {c.expectedIncome ? <p className="mt-0.5 text-xs leading-4 text-white/75">Contando a renda prevista de {brl0(c.expectedIncome.amount)} em {ddmm(c.expectedIncome.date)}.</p> : null}
          <dl className="mt-3 space-y-2 border-t border-white/15 pt-2.5 text-sm leading-5">
            {c.expectedIncome ? <div className="flex items-baseline justify-between gap-3"><dt className="text-white/80">Se essa renda não entrar, você fecha o mês com</dt><dd className={cn("shrink-0 font-semibold tabular-nums", c.withoutIncomeEnd < 0 && "text-[#FFB4C0]")}>{brl0(c.withoutIncomeEnd)}</dd></div> : null}
            {p.consumption ? <div className="flex items-baseline justify-between gap-3"><dt className="text-white/80">Gasto total previsto até {ddmm(endIso)}<span className="block text-xs text-white/60">{brl0(p.consumption.realized)} já gastos + {brl0(p.consumption.total - p.consumption.realized)} até o fim do mês</span></dt><dd className="shrink-0 font-semibold tabular-nums">{brl0(p.consumption.total)}</dd></div> : null}
          </dl>
          <Explore dark onClick={() => sheet.show("bridge")}>Ver ponte e simular</Explore>
        </div>
      ) : (
        <Block><p className="text-sm leading-[21px]">Saldo esperado indisponível: o retrato de hoje ainda não foi atualizado. Nada é estimado no lugar.</p></Block>
      )}

      {rep.isCurrentMonth ? (
        <div className="mt-3 lg:grid lg:grid-cols-12 lg:gap-4">
          <Block label="Compromissos" className="lg:col-span-7"><CommitmentTimeline rep={rep} /></Block>
          <div className="mt-3 grid grid-cols-1 gap-3 min-[390px]:grid-cols-2 lg:col-span-5 lg:mt-0 lg:grid-cols-1 lg:content-start">
            {p.receivables && p.receivables.toDue + p.receivables.overdue > 0 ? (
              <Block label="A receber">
                <p className="text-xs leading-4 text-[#666274]">A receber de outras pessoas</p>
                <Amount v={p.receivables.toDue + p.receivables.overdue} size="sec" />
                <p className="mt-1 text-xs leading-4"><span className={p.receivables.overdue > 0 ? "text-[#C0364F]" : ""}>{brl0(p.receivables.overdue)} vencidos</span> · {brl0(p.receivables.toDue)} a vencer</p>
                <p className="text-xs leading-4 text-[#666274]">Não entra no saldo até ser recebido.</p>
                <Explore to="/app/divisao-do-role">Ver cobranças</Explore>
              </Block>
            ) : null}
            {p.savings ? (
              <Block label="Poupança sustentável">
                <p className="text-xs leading-4 text-[#666274]">Poupança sustentável</p>
                {p.savings.status === "ok" ? <Amount v={p.savings.monthly ?? 0} size="sec" /> : p.savings.status === "zero_real" ? <p className="text-[22px] font-bold leading-7">R$ 0<span className="text-sm font-semibold">/mês</span></p> : <p className="text-base font-semibold leading-[22px]">Indisponível</p>}
                <p className="mt-1 text-xs leading-4 text-[#666274]">
                  {p.savings.status === "ok" ? `por mês · mediana de ${p.savings.closedMonths} meses fechados` : p.savings.status === "zero_real" ? `Nos ${p.savings.closedMonths} meses fechados, não sobrou de forma recorrente.` : p.savings.status === "stale" ? "Motivo: o cálculo está desatualizado." : "Motivo: histórico curto (menos de 3 meses fechados)."}
                </p>
                <p className="mt-1 text-xs leading-4 text-[#666274]">É o excedente recorrente, diferente do saldo projetado deste mês (que inclui a renda prevista).</p>
              </Block>
            ) : null}
          </div>
        </div>
      ) : null}

      {c ? (
        <DisclosureSheet {...sheet.props("bridge")} title="Como chegamos ao saldo esperado" description="Em centavos. Cartão afeta o caixa quando a fatura é paga.">
          <LedgerLines lines={c.steps.filter((s) => s.sign !== "result").map((s) => ({ label: `${s.label}${s.key.startsWith("income") && c.expectedIncome ? ` (${ddmm(c.expectedIncome.date)})` : ""}${s.uncertain ? " · estimada" : ""}`, value: brl2(s.value), sign: s.sign === "plus" ? "+" as const : s.sign === "minus" ? "−" as const : "" as const }))} total={{ label: "Saldo esperado", value: brl2(c.projectedEnd) }} />
          <p className="mt-2 text-xs leading-4 text-[#666274]">Sem a renda prevista: {brl2(c.withoutIncomeEnd)}.{c.freeCash != null ? ` Antes do consumo variável: ${brl2(c.freeCash)}.` : ""}{c.uncertainReceivables > 0 ? ` Valores a receber incertos (${brl2(c.uncertainReceivables)}) não entram.` : ""}</p>
          {rep.projections.commitments?.items?.length ? (
            <>
              <p className="mt-4 font-semibold">Obrigações com data e origem</p>
              <ul className="mt-1 divide-y divide-[#EAE4F7] text-sm">{rep.projections.commitments.items.filter((i) => !i.date || i.date <= endIso).map((i, k) => <li key={k} className="flex justify-between gap-3 py-1.5"><span>{i.date ? ddmm(i.date) : "sem data"} · {i.label}</span><span className="tabular-nums">{brl2(i.amount)}</span></li>)}</ul>
            </>
          ) : null}
          <Simulator cash={c} />
        </DisclosureSheet>
      ) : null}
    </Chapter>
  );
}

// ---------------------------------------------------------------------------
// 05 · Sua trajetória
// ---------------------------------------------------------------------------

function MonthlyResultChart({ rep }: { rep: ReportV2 }) {
  const ms = rep.evolution.months;
  const [sel, setSel] = useState<number | null>(null);
  if (ms.length < 2) return null;
  const max = Math.max(...ms.map((m) => Math.abs(m.result)), 1);
  const s = sel != null ? ms[sel] : null;
  return (
    <figure className="print:break-inside-avoid">
      <Sub>Resultado mensal</Sub>
      <p className="text-xs leading-4 text-[#666274]">Receitas − consumo, em R$ · últimos {ms.length} meses · tracejado = mês parcial</p>
      <div className="relative mt-3 flex h-[170px] gap-2" role="img" aria-label={ms.map((m) => `${monthFull(m.month)}: ${signed0(m.result)}${m.partial ? " (parcial)" : ""}`).join("; ")}>
        <span className="absolute inset-x-0 top-1/2 border-t border-[#21164F]/40" aria-hidden />
        <span className="absolute -top-0.5 left-0 text-[10px] text-[#666274]" aria-hidden>{kfmt(max).replace("+", "")}</span>
        <span className="absolute left-0 top-1/2 -translate-y-full bg-[#F8F7FC] pr-1 text-[10px] text-[#666274] dark:bg-background" aria-hidden>R$ 0</span>
        {ms.map((m, i) => {
          const hgt = (Math.abs(m.result) / max) * 42;
          const pos = m.result >= 0;
          return (
            <button key={m.month} type="button" onClick={() => setSel(i)} aria-label={`${monthFull(m.month)}: resultado ${signed0(m.result)}${m.partial ? ", parcial" : ""}`} className={cn("relative h-full min-w-0 flex-1 rounded-lg", sel === i && "bg-[#6D3BFF]/[0.06]")}>
              <span className={cn("absolute left-1/2 w-[52%] -translate-x-1/2", pos ? "bottom-1/2 rounded-t-md" : "top-1/2 rounded-b-md", m.partial ? cn("border-2 border-dashed", pos ? "border-[#16A37A]" : "border-[#DC4C64]") : pos ? "bg-[#16A37A]" : "bg-[#DC4C64]")} style={{ height: `${Math.max(1, hgt)}%` }} />
              <span className="absolute left-1/2 -translate-x-1/2 text-[10.5px] font-semibold tabular-nums" style={pos ? { bottom: `calc(50% + ${Math.max(1, hgt)}% + 2px)` } : { top: `calc(50% + ${Math.max(1, hgt)}% + 2px)` }}>{kfmt(m.result)}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex gap-2">{ms.map((m) => <span key={m.month} className="flex-1 text-center text-xs text-[#666274]">{mon(m.month)}{m.partial ? "*" : ""}</span>)}</div>
      <ChartReadout>{s ? <>{monthFull(s.month)}{s.partial ? " (parcial)" : ""}: receitas <b>{brl0(s.income)}</b> − consumo <b>{brl0(s.consumption)}</b> = <b>{signed0(s.result)}</b>{s.debtPaid > 0 ? ` · principal de dívida pago (fora do resultado) ${brl0(s.debtPaid)}` : ""}. Juros conhecidos estão dentro do consumo.</> : <>* mês parcial, fora da leitura de tendência. Toque num mês para ver a conta.</>}</ChartReadout>
    </figure>
  );
}

function NetWorthTrend({ rep }: { rep: ReportV2 }) {
  const nw = rep.evolution.netWorth;
  const sheet = useSheet();
  const [sel, setSel] = useState<number | null>(null);
  const { ref, w: W } = useWidth();
  if (!nw || nw.current == null) return null;
  const s = nw.series;
  const first = s[0];
  const delta = first && s.length >= 2 ? nw.current - first.value : null;
  const H = 160; const L = 40; const R = 10; const T = 10; const B = 20;
  const vals = s.map((p) => p.value);
  const lo = Math.min(...vals); const hi = Math.max(...vals);
  const pad = Math.max(1, (hi - lo) * 0.15);
  const y0 = lo - pad; const y1 = hi + pad;
  const idx = (m: string) => { const a = Number(first.month.slice(0, 4)) * 12 + Number(first.month.slice(5, 7)); return Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - a; };
  const span = s.length ? Math.max(1, idx(s[s.length - 1].month)) : 1;
  const x = (m: string) => L + (idx(m) / span) * (W - L - R);
  const y = (v: number) => T + (1 - (v - y0) / Math.max(1, y1 - y0)) * (H - T - B);
  // Não conecta lacunas: um trecho por sequência de meses consecutivos com registro.
  const runs: Array<Array<[number, number]>> = [];
  s.forEach((p, i) => { if (i === 0 || idx(p.month) - idx(s[i - 1].month) > 1) runs.push([]); runs[runs.length - 1].push([x(p.month), y(p.value)]); });
  const sp = sel != null ? s[sel] : null;
  return (
    <div ref={ref}>
      <Sub>Patrimônio registrado</Sub>
      <Amount v={nw.current} size="sec" className={nw.current < 0 ? "text-[#C0364F]" : "text-[#21164F] dark:text-foreground"} />
      <p className="text-xs leading-4 text-[#666274]">{delta != null ? `${signed0(delta)} desde ${monthFull(first.month)}` : "Sem histórico para comparar"} · ativos − passivos informados{nw.composition ? ` · atualizado em ${ddmm(nw.composition.asOf)}` : ""}</p>
      {s.length >= 2 ? (
        <figure className="mt-2 print:break-inside-avoid">
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" aria-label={`Patrimônio registrado por mês, em reais: ${s.map((p) => `${monthFull(p.month)} ${brl0(p.value)}`).join("; ")}`}>
            {[y1, (y0 + y1) / 2, y0].map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={C.neutral} /><text x={L - 5} y={y(t) + 3} textAnchor="end" fontSize={10} fill={C.muted}>{kfmt(t).replace("+", "")}</text></g>)}
            {runs.map((r, i) => <path key={i} d={smoothPath(r)} fill="none" stroke={C.primary} strokeWidth={2.4} strokeLinecap="round" />)}
            {s.map((p, i) => <g key={p.month} onClick={() => setSel(i)} className="cursor-pointer"><circle cx={x(p.month)} cy={y(p.value)} r={14} fill="transparent" /><circle cx={x(p.month)} cy={y(p.value)} r={sel === i ? 5 : 3.5} fill={sel === i || i === s.length - 1 ? "white" : C.primary} stroke={C.primary} strokeWidth={2} /><text x={x(p.month)} y={H - 4} textAnchor="middle" fontSize={10} fill={C.muted}>{mon(p.month)}</text></g>)}
          </svg>
          <ChartReadout>{sp ? <>{monthFull(sp.month)}: <b>{brl0(sp.value)}</b></> : <>Um ponto por mês com registro; meses sem registro não são ligados. Toque num ponto.</>}</ChartReadout>
        </figure>
      ) : <p className="mt-2 text-xs leading-4 text-[#666274]">A linha aparece quando houver mais de um mês registrado.</p>}
      {nw.composition ? <Explore onClick={() => sheet.show("nw")}>Ativos e passivos</Explore> : null}
      {nw.composition ? (
        <DisclosureSheet {...sheet.props("nw")} title="Ativos e passivos" description={`Posição de ${ddmm(nw.composition.asOf)}, só com o que foi registrado no Nino.`}>
          <LedgerLines lines={[{ label: "Dinheiro em contas", value: brl2(nw.composition.cash) }, { label: "Investimentos", value: brl2(nw.composition.invested) }, { label: "Dívidas e empréstimos", value: brl2(nw.composition.otherDebts), sign: "−" }, { label: "Cartões (fatura em aberto)", value: brl2(nw.composition.cardsOwed), sign: "−" }]} total={{ label: "Patrimônio líquido", value: brl2(nw.composition.net) }} />
          <p className="mt-2 text-xs leading-4 text-[#666274]">A ponte da variação (novas dívidas, amortizações, variação de ativos e ajustes de cadastro) ainda não é registrada por mês; por isso não é mostrada. Sem registro novo, o valor não muda, o que não significa estabilidade.</p>
        </DisclosureSheet>
      ) : null}
    </div>
  );
}

const VERDICT = { no_ritmo: "no ritmo", atencao: "atenção", vai_estourar: "deve estourar", estourou: "estourou" } as const;

function GoalTrack({ g }: { g: ReportV2["evolution"]["goals"]["spending"][number] }) {
  const scale = Math.max(1, g.projectedPct ?? 0, g.pct) * 1.04;
  const ok = g.verdict === "no_ritmo";
  const warn = g.verdict === "atencao";
  // Paleta do Nino: degradê roxo no ritmo; âmbar em atenção; vermelho só quando deve estourar ou estourou.
  const fill = ok ? "bg-gradient-to-r from-[#6D4AFF] to-[#8B5CF6]" : warn ? "bg-gradient-to-r from-[#E9A23B] to-[#F2C46B]" : "bg-gradient-to-r from-[#DC4C64] to-[#F08A9B]";
  return (
    <li className="py-2.5">
      <p className="flex items-baseline justify-between gap-2 text-sm leading-5"><span className="font-medium">{g.category}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", ok ? "bg-primary/10 text-primary" : warn ? "bg-[#E9A23B]/15 text-[#8A5A0C]" : "bg-[#DC4C64]/10 text-[#B23A50]")}>{VERDICT[g.verdict]}</span></p>
      <span className="relative mt-2 block h-2 rounded-full bg-[#EAE4F7]" aria-hidden>
        {g.projectedPct != null ? <span className="absolute inset-y-0 left-0 rounded-full bg-[#C4B5FD]/70" style={{ width: `${(g.projectedPct / scale) * 100}%` }} /> : null}
        <span className={cn("absolute inset-y-0 left-0 rounded-full", fill)} style={{ width: `${Math.max(2, (g.pct / scale) * 100)}%` }} />
        <span className="absolute inset-y-[-3px] w-0.5 rounded bg-[#21164F]/70" style={{ left: `${(1 / scale) * 100}%` }} />
      </span>
      <p className="mt-1 text-xs leading-4 tabular-nums text-[#666274]">{brl0(g.spent)} de {brl0(g.limit)} ({Math.round(g.pct * 100)}%){g.projectedPct != null ? ` · projeção ${Math.round(g.projectedPct * 100)}%` : ""}{g.pct > 1 ? ` · excedente ${brl0(g.spent - g.limit)}` : ""}{g.daysRemaining != null ? ` · ${g.daysRemaining} dias restantes` : ""}</p>
    </li>
  );
}

function GoalProgress({ rep }: { rep: ReportV2 }) {
  const g = rep.evolution.goals;
  const sheet = useSheet();
  if (g.spending.length === 0 && g.savings.length === 0) return null;
  const onTrack = g.spending.filter((s) => s.verdict === "no_ritmo").length;
  const needs = g.spending.filter((s) => s.verdict !== "no_ritmo");
  // Até duas: primeiro as que pedem atenção; se nenhuma pede, as duas mais perto do limite (com o status real).
  const shown = (needs.length ? needs : g.spending).slice().sort((a, b) => (b.projectedPct ?? b.pct) - (a.projectedPct ?? a.pct)).slice(0, 2);
  return (
    <div>
      <Sub>{g.spending.length ? `${onTrack} de ${g.spending.length} metas de gasto no ritmo` : "Metas em andamento"}</Sub>
      <p className="text-xs leading-4 text-[#666274]">{needs.length ? "As que pedem atenção agora." : "Nenhuma pede atenção; abaixo, as mais perto do limite."} Barra = gasto até hoje · lilás = projeção · traço = limite. Status da aba Metas.</p>
      {shown.length ? <ul className="mt-1 divide-y divide-[#EAE4F7]">{shown.map((s) => <GoalTrack key={s.id} g={s} />)}</ul> : null}
      <Explore onClick={() => sheet.show("goals")}>Ver todas as metas e o impacto</Explore>
      <DisclosureSheet {...sheet.props("goals")} title="Metas e impacto">
        {g.spending.length ? <><p className="font-semibold">Gasto</p><ul className="divide-y divide-[#EAE4F7]">{g.spending.map((s) => <GoalTrack key={s.id} g={s} />)}</ul></> : null}
        {g.savings.length ? (
          <div className="mt-4"><p className="font-semibold">Acumulação · progresso = acumulado ÷ objetivo</p>
            <ul className="mt-1 space-y-3">{g.savings.map((s) => <li key={s.id}><p className="flex justify-between text-sm"><span>{s.name}</span><span className="tabular-nums">{Math.round(s.pct * 100)}%</span></p><span className="mt-1 block h-2 rounded-full bg-[#EAE4F7]" aria-hidden><span className="block h-full rounded-full bg-gradient-to-r from-[#6D4AFF] to-[#8B5CF6]" style={{ width: `${Math.max(2, Math.min(100, s.pct * 100))}%` }} /></span><p className="mt-1 text-xs text-[#666274]">{brl0(s.contributed)} de {brl0(s.target)} · faltam {brl0(s.remaining)}</p></li>)}</ul>
          </div>
        ) : null}
        {rep.evolution.tracked.length ? (
          <div className="mt-4"><p className="font-semibold">Ações acompanhadas</p>
            <ul className="mt-1 divide-y divide-[#EAE4F7]">{rep.evolution.tracked.map((t) => <li key={t.key} className="flex justify-between gap-3 py-2 text-sm"><span>{t.title}<br /><span className="text-xs text-[#666274]">partida {brl0(t.baseline)} → agora {brl0(t.current)}</span></span><span className="shrink-0 tabular-nums">{signed0(t.delta)}</span></li>)}</ul>
            <p className="mt-1 text-xs leading-4 text-[#666274]">Comparação com o ponto de partida; não prova causa.</p>
          </div>
        ) : null}
        <Explore to="/app/metas">Abrir Metas</Explore>
      </DisclosureSheet>
    </div>
  );
}

function EvolucaoChapter({ rep }: { rep: ReportV2 }) {
  const closed = rep.evolution.months.filter((m) => !m.partial);
  const pos = closed.filter((m) => m.result > 0).length;
  const title = closed.length >= 2 ? `${pos} de ${closed.length} meses fechados com sobra` : "Sua trajetória";
  return (
    <Chapter id="evolucao" title={title}>
      <div className="space-y-3 lg:grid lg:grid-cols-12 lg:gap-4 lg:space-y-0">
        <Block label="Resultado mensal" className="lg:col-span-6"><MonthlyResultChart rep={rep} /></Block>
        <Block label="Patrimônio registrado" className="lg:col-span-6"><NetWorthTrend rep={rep} /></Block>
      </div>
      <Block label="Metas" className="mt-3"><GoalProgress rep={rep} /></Block>
    </Chapter>
  );
}

// ---------------------------------------------------------------------------
// 06 · Seu próximo passo
// ---------------------------------------------------------------------------

function impactText(r: Recommendation) {
  if (r.nature === "cash") return r.cashImpact ? `${brl0(r.cashImpact)} a reservar no caixa · não é economia` : "Organização do caixa · sem economia mensal";
  if (r.adjustable) return `Até ${brl0(r.adjustable.base * r.adjustable.pct)}/mês estimados (hipótese de ${Math.round(r.adjustable.pct * 100)}%)`;
  return r.monthlyImpact > 0 ? `Até ${brl0(r.monthlyImpact)}/mês estimados` : null;
}

function AcaoChapter({ rep, month }: { rep: ReportV2; month: string }) {
  const act = useRecommendationAction(month);
  const sheet = useSheet();
  const [hidden, setHidden] = useState<string[]>([]);
  const items = rep.recommendations.items.filter((r) => !hidden.includes(r.key));
  const next = items[0];
  const rec = rep.projections.recoverable;
  return (
    <Chapter id="acao" title={next ? next.title : "Nada urgente para fazer agora"}>
      {next ? (
        <div className="rounded-2xl border border-primary/15 bg-gradient-brand-soft p-4 shadow-card print:break-inside-avoid">
          <p className="text-xs font-semibold uppercase leading-4 tracking-[0.04em] text-primary">{next.nature === "cash" ? "Para o seu caixa" : "Oportunidade"}</p>
          <p className="mt-1 text-sm leading-[21px]">{next.body}</p>
          {impactText(next) ? <p className="mt-2 text-base font-semibold leading-[22px] text-[#21164F] dark:text-foreground">{impactText(next)}</p> : null}
          <div className="mt-3 flex items-center justify-between gap-2">
            {next.route && next.routeLabel ? <Link to={next.route} onClick={() => { if (next.nature === "saving") void act(next, "accepted"); }} className="inline-flex min-h-[44px] items-center gap-1 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">{next.routeLabel}<ChevronRight size={16} aria-hidden /></Link> : <span />}
            <DropdownMenu>
              <DropdownMenuTrigger aria-label={`Mais opções: ${next.title}`} className="grid h-11 w-11 place-items-center rounded-full text-[#666274] print:hidden"><MoreHorizontal size={18} aria-hidden /></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => sheet.show(`m:${next.key}`)}>Como calculamos</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { setHidden((h) => [...h, next.key]); void act(next, "dismissed"); }}>Dispensar</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : <p className="text-sm leading-[21px] text-[#666274]">Quando houver uma ação com evidência suficiente, ela aparece aqui.</p>}

      {items.length > 1 || rec ? (
        <details className="group mt-3 rounded-2xl border border-[#EAE4F7] bg-card px-4 shadow-card">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between text-sm font-semibold text-[#21164F] dark:text-foreground">Outras oportunidades{items.length > 1 ? ` (${items.length - 1})` : ""}<ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden /></summary>
          <div className="space-y-3 pb-4">
            {items.slice(1).map((r) => <ActionCard key={r.key} icon={ChevronRight} title={r.title} body={r.body} impact={impactText(r)} cta={r.route && r.routeLabel ? { label: r.routeLabel, href: r.route } : null} onCta={r.nature === "saving" ? () => { void act(r, "accepted"); } : undefined} menu={[{ label: "Como calculamos", onSelect: () => sheet.show(`m:${r.key}`) }, { label: "Dispensar", onSelect: () => { setHidden((h) => [...h, r.key]); void act(r, "dismissed"); } }]} />)}
            {rec ? (
              <div className="border-t border-[#EAE4F7] pt-3">
                <p className="text-sm font-semibold">Gasto recuperável estimado: {brl0(rec.monthly)}/mês</p>
                <LedgerLines lines={rec.sources.map((s) => ({ label: s.label, value: brl0(s.monthly) }))} total={{ label: "Total", value: brl0(rec.monthly) }} />
                <p className="mt-1 text-xs leading-4 text-[#666274]">Reduções viáveis independentes, contra o seu próprio histórico. Não somar com pequenos gastos nem com as ações acima: há sobreposição.</p>
              </div>
            ) : null}
            <p className="text-xs leading-4 text-[#666274]">Estimativas independentes: não somar.</p>
          </div>
        </details>
      ) : null}

      <DataQualityFooter rep={rep} />

      {rep.recommendations.items.map((r) => (
        <DisclosureSheet key={r.key} {...sheet.props(`m:${r.key}`)} title="Como calculamos"><p>{r.basis}</p><p className="mt-2 text-xs leading-4 text-[#666274]">Confiança {Math.round(r.confidence * 100)}%.</p></DisclosureSheet>
      ))}
    </Chapter>
  );
}

function DataQualityFooter({ rep }: { rep: ReportV2 }) {
  const m = rep.meta;
  return (
    <footer className="mt-8 border-t border-[#EAE4F7] pt-4 text-xs leading-4 text-[#666274]">
      <p>Método {m.formulaVersion} · dados até {ddmm(m.asOf)} · {Math.round(m.coverage.categorizedShare * 100)}% do gasto com categoria · {m.coverage.historyMonths} meses de histórico.</p>
      <p className="mt-1">Fontes: lançamentos, saldos das contas, faturas, dívidas, recorrências, metas e divisões registradas no Nino. Projeções são condicionais; nada aqui é promessa de dinheiro.</p>
      <details className="group mt-2">
        <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1 font-semibold text-[#6D3BFF]">Metodologia, limitações e como corrigir<ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden /></summary>
        <div className="mt-1 text-sm leading-5 text-foreground"><QualityList notes={rep.quality} meta={m} /></div>
      </details>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export function MeuMesBody({ rep, compare, onCompare, month }: { rep: ReportV2; compare: CompareKind; onCompare: (c: CompareKind) => void; month: string }) {
  const ed = useMemo(() => buildEditorial(rep), [rep]);
  return (
    <div className="mt-4 space-y-8">
      <div>
        <MomentHero rep={rep} ed={ed} />
        <Complementary ed={ed} />
      </div>
      <GastosChapter rep={rep} compare={compare} onCompare={onCompare} month={month} />
      <HabitosChapter rep={rep} month={month} />
      <FuturoChapter rep={rep} />
      <EvolucaoChapter rep={rep} />
      <AcaoChapter rep={rep} month={month} />
    </div>
  );
}

export function MeuMesSkeleton() {
  return (
    <div className="mt-4 space-y-8" role="status" aria-live="polite">
      <span className="sr-only">Montando o seu mês</span>
      <Skeleton className="h-[248px] rounded-[24px]" />
      <div className="space-y-3"><Skeleton className="h-4 w-40" /><Skeleton className="h-9 w-48" /><Skeleton className="h-[220px] rounded-2xl" /></div>
      <div className="space-y-3"><Skeleton className="h-4 w-40" /><Skeleton className="h-[150px] rounded-2xl" /></div>
    </div>
  );
}

export function MeuMesError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-[#DDD8E9] bg-card p-6 text-center">
      <p className="text-base font-semibold">Não consegui montar o seu mês agora</p>
      <p className="mt-1 text-sm text-[#666274]">Seus dados estão seguros. Tente de novo em instantes.</p>
      <button type="button" onClick={onRetry} className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#DDD8E9] px-4 text-sm font-semibold"><RefreshCw size={15} aria-hidden />Tentar de novo</button>
    </div>
  );
}
