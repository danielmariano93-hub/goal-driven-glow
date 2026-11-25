import { Link } from "react-router-dom";
import { ArrowRight, CalendarClock, Target, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import type { ReportDashboard } from "@/lib/engine/reportDashboard";
import type { FutureView, ReportStory } from "@/lib/engine/reportStory";
import { cn } from "@/lib/utils";

// Blocos da história do relatório (`report_story.v1`). Tudo aqui só desenha números que
// o servidor já calculou; cada bloco devolve `null` quando falta base, nunca um zero inventado.
// Estado nunca é só cor: seta/sinal + texto em toda variação.

/** Reais inteiros: análise, não extrato. Centavos continuam nos blocos de lançamentos. */
export const brl0 = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
const pctText = (ratio: number) => `${ratio >= 0 ? "+" : "−"}${Math.round(Math.abs(ratio) * 100)}%`;

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;

/** Chip de variação contra o habitual. Subir gasto é "ruim" (vermelho + seta para cima). */
function VariationChip({ ratio, className }: { ratio: number; className?: string }) {
  const flat = Math.abs(ratio) < 0.005;
  const up = ratio > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
      flat ? "bg-secondary text-muted-foreground" : up ? "bg-red-500/10 text-red-700" : "bg-emerald-500/10 text-emerald-700", className)}>
      {flat ? null : <Icon size={11} aria-hidden />}
      {flat ? "no habitual" : pctText(ratio)}
      <span className="sr-only">{flat ? "" : up ? " acima do habitual" : " abaixo do habitual"}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Ato 1 — Como foi
// ---------------------------------------------------------------------------

/** "Você consumiu R$ X" contra o habitual (a mesma janela de dias dos últimos meses fechados). */
export function ConsumptionHero({ d, story }: { d: ReportDashboard; story: ReportStory }) {
  const h = story.habitual;
  if (!h) return null;
  const spent = d.totals.expense;
  const above = h.deltaAbs > 0;
  const flat = Math.abs(h.deltaPct ?? 0) < 0.03;
  const sentence = flat
    ? "Seu gasto está dentro do seu habitual para este período."
    : above ? "Seu gasto está acima do habitual para este período." : "Seu gasto está abaixo do habitual para este período.";
  return (
    <section aria-label="Consumo do período" className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-muted-foreground">Você consumiu</p>
          <p className="mt-0.5 font-display text-[28px] font-bold leading-none tabular-nums">{brl0(spent)}</p>
        </div>
        {h.deltaPct != null ? (
          <div className="shrink-0 text-right">
            <VariationChip ratio={h.deltaPct} className="text-[13px]" />
            <p className="mt-1 text-[11px] leading-tight text-muted-foreground">vs. seu habitual<br />({brl0(h.expense)})</p>
          </div>
        ) : null}
      </div>
      <p className="mt-3 text-[12.5px] text-muted-foreground">{sentence}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Habitual = o valor típico dos mesmos {story.windowDays} dias em {h.months.map((m) => monthName(m)).join(", ")}.
      </p>
    </section>
  );
}

/** Receitas, resultado e saldo disponível. O saldo é o da Home; sem snapshot de hoje, o terceiro cartão some. */
export function SummaryTrio({ d, story, future }: { d: ReportDashboard; story: ReportStory | null | undefined; future: FutureView | null | undefined }) {
  // Salário que ainda não caiu: "Resultado" seria só o gasto com sinal negativo, o que engana. Mostra o que falta.
  const waiting = story?.income?.incomplete === true;
  const cells: Array<{ label: string; value: number | null; tone?: "good" | "bad"; note?: string }> = [
    { label: "Receitas", value: d.totals.income, note: waiting ? `costuma ser ${brl0(story?.income?.typical ?? 0)}` : undefined },
    waiting
      ? { label: "Resultado", value: null, note: "aguardando a renda do mês" }
      : { label: "Resultado", value: d.totals.net, tone: d.totals.net >= 0 ? "good" : "bad" },
  ];
  if (future?.balance != null) cells.push({ label: "Saldo disponível", value: future.balance });
  return (
    <section aria-label="Receitas, resultado e saldo" className={cn("grid gap-2", cells.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {cells.map((c) => (
        <div key={c.label} className="rounded-2xl border border-border bg-card p-3">
          <p className="text-[11px] text-muted-foreground">{c.label}</p>
          <p className={cn("mt-1 font-display text-[16px] font-bold tabular-nums leading-tight",
            c.tone === "good" && "text-emerald-700", c.tone === "bad" && "text-red-700")}>
            {c.value == null ? "—" : `${c.value < 0 ? "−" : ""}${brl0(Math.abs(c.value))}`}
          </p>
          {c.note ? <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{c.note}</p> : null}
        </div>
      ))}
    </section>
  );
}

/** Evolução do consumo: acumulado do mês contra o acumulado médio do habitual. */
export function CumulativeChart({ story }: { story: ReportStory }) {
  const points = story.cumulative;
  if (!points || points.length < 2) return null;
  const W = 320; const H = 150; const L = 34; const R = 10; const T = 14; const B = 22;
  const last = points[points.length - 1];
  const maxRaw = Math.max(last.current, last.habitual, 1);
  const step = maxRaw > 6000 ? 2000 : maxRaw > 3000 ? 1000 : maxRaw > 1200 ? 500 : 250;
  const max = Math.ceil(maxRaw / step) * step;
  const x = (day: number) => L + ((day - 1) / Math.max(1, points.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const line = (pick: (p: (typeof points)[number]) => number) => points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)} ${y(pick(p)).toFixed(1)}`).join(" ");
  const area = `${line((p) => p.current)} L${x(last.day).toFixed(1)} ${y(0)} L${x(1).toFixed(1)} ${y(0)} Z`;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const xTicks = [1, 7, 14, 21, last.day].filter((d, i, a) => d <= last.day && a.indexOf(d) === i);
  const diff = story.habitual?.deltaPct;
  const bubbleX = Math.min(Math.max(x(last.day), L + 30), W - R - 30);
  return (
    <section aria-label="Evolução do consumo" className="rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <p className="text-sm font-semibold">Evolução do consumo</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-primary" aria-hidden />Este mês (acumulado)</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-muted-foreground" aria-hidden />Seu habitual</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img"
        aria-label={`Consumo acumulado de ${brl0(last.current)} até o dia ${last.day}, contra ${brl0(last.habitual)} no seu habitual${diff != null ? ` (${pctText(diff)})` : ""}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={0.5} />
            <text x={L - 4} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={8}>{t.toLocaleString("pt-BR")}</text>
          </g>
        ))}
        <path d={area} className="fill-primary/10" />
        <path d={line((p) => p.habitual)} fill="none" className="stroke-muted-foreground" strokeWidth={1.6} strokeDasharray="4 3" />
        <path d={line((p) => p.current)} fill="none" className="stroke-primary" strokeWidth={2.2} strokeLinejoin="round" />
        <circle cx={x(last.day)} cy={y(last.current)} r={3.5} className="fill-background stroke-primary" strokeWidth={2} />
        <g transform={`translate(${bubbleX}, ${Math.max(2, y(last.current) - 26)})`}>
          <rect x={-30} width={60} height={20} rx={6} className="fill-card stroke-border" strokeWidth={0.8} />
          <text y={9} textAnchor="middle" className="fill-foreground" fontSize={8.5} fontWeight={700}>{brl0(last.current)}</text>
          {diff != null ? <text y={17} textAnchor="middle" className="fill-muted-foreground" fontSize={7}>{pctText(diff)}</text> : null}
        </g>
        {xTicks.map((day) => (
          <text key={day} x={x(day)} y={H - 6} textAnchor="middle" className="fill-muted-foreground" fontSize={8}>{day}</text>
        ))}
      </svg>
      <p className="mt-1 text-[11px] text-muted-foreground">Dias do mês, em reais acumulados.</p>
    </section>
  );
}

/** Principais categorias do período, cada uma com a variação contra o habitual. */
export function TopCategories({ story, windowEnd }: { story: ReportStory; windowEnd: string }) {
  const rows = story.categories;
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.total), 1);
  const [, mm, dd] = windowEnd.split("-");
  return (
    <section aria-label="Principais categorias" className="rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <p className="text-sm font-semibold">Principais categorias <span className="font-normal text-muted-foreground">(até {dd}/{mm})</span></p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.id ?? r.name} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
            <span className="truncate text-[13px] font-medium">{r.name}</span>
            <span className="flex items-center justify-end gap-2">
              <span className="text-[13px] font-semibold tabular-nums">{brl0(r.total)}</span>
              {r.deltaPct != null ? <VariationChip ratio={r.deltaPct} /> : null}
            </span>
            <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
              <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(3, (r.total / max) * 100)}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ato 2 — O que mudou no seu mês
// ---------------------------------------------------------------------------

export function CostSplitCards({ story }: { story: ReportStory }) {
  const s = story.split;
  if (!s) return null;
  const cells = [
    { label: "Gastos essenciais", value: s.essential, share: s.essentialShare, hint: "categorias que você marcou como essenciais" },
    { label: "Gastos ajustáveis", value: s.adjustable, share: 1 - s.essentialShare, hint: "o que dá para ajustar mês a mês" },
  ];
  return (
    <section aria-label="Essenciais e ajustáveis" className="grid grid-cols-2 gap-2">
      {cells.map((c) => (
        <div key={c.label} className="rounded-2xl border border-border bg-card p-3">
          <p className="text-[12px] font-semibold">{c.label}</p>
          <p className="mt-1 font-display text-[20px] font-bold leading-tight tabular-nums">{brl0(c.value)}</p>
          <p className="mt-0.5 text-[12px] font-semibold text-primary tabular-nums">{Math.round(c.share * 100)}% do total</p>
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">{c.hint}</p>
        </div>
      ))}
    </section>
  );
}

const initials = (label: string) => label.trim().slice(0, 2).toUpperCase();

/** O que mais subiu contra o habitual, por estabelecimento. */
export function VariationsCard({ story }: { story: ReportStory }) {
  const rows = story.variations.slice(0, 4);
  if (rows.length === 0) return null;
  return (
    <section aria-label="Principais variações" className="rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <p className="text-sm font-semibold">Principais variações</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">O que mais aumentou em relação ao seu habitual.</p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold text-muted-foreground" aria-hidden>{initials(r.label)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold capitalize">{r.label}</p>
              <p className="text-[11.5px] text-muted-foreground">{brl0(r.total)} no mês · habitual {brl0(r.habitual)}</p>
            </div>
            <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-1 text-[11.5px] font-semibold tabular-nums text-red-700">
              +{brl0(r.deltaAbs)} (+{Math.round(r.deltaPct * 100)}%)
              <span className="sr-only"> acima do habitual</span>
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
      <p className="text-sm font-semibold">Seu padrão de gastos por dia da semana</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        Média diária por dia da semana ({monthName(story.month)}){w.scope === "adjustable" ? ", sem os essenciais (aluguel, contas e dívidas, que caem num dia só)" : ""}.
      </p>
      <ul className="mt-4 grid grid-cols-7 items-end gap-1.5">
        {w.rows.map((r) => (
          <li key={r.dow} className="flex flex-col items-center gap-1">
            <span className="text-[9.5px] font-semibold tabular-nums">{brl0(r.avg)}</span>
            <span className="flex h-24 w-full items-end">
              <span className={cn("w-full rounded-t-md", r.dow === w.peakDow ? "bg-primary" : "bg-primary/30")}
                style={{ height: `${Math.max(4, (r.avg / max) * 100)}%` }} aria-hidden />
            </span>
            <span className={cn("text-[11px]", r.dow === w.peakDow ? "font-bold" : "text-muted-foreground")}>{r.label}</span>
          </li>
        ))}
      </ul>
      {w.weekend ? (
        <div className="mt-4 rounded-xl bg-primary/5 p-3">
          <p className="text-[13px] font-semibold">Seus gastos de fim de semana pesam mais</p>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            Você gasta, em média, {Math.round(w.weekend.pct * 100)}% a mais por dia no sábado e no domingo ({brl0(w.weekend.weekendAvg)} contra {brl0(w.weekend.weekdayAvg)} nos outros dias).
          </p>
          <Link to="/app/lancamentos" className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-primary">
            Ver detalhes e transações <ArrowRight size={12} aria-hidden />
          </Link>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ato 3 — Para onde você vai
// ---------------------------------------------------------------------------

export function CommitmentsCard({ future }: { future: FutureView | null | undefined }) {
  const c = future?.commitments;
  if (!c) return null;
  return (
    <section aria-label="Compromissos próximos" className="rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <p className="flex items-center gap-1.5 text-sm font-semibold"><CalendarClock size={15} className="text-primary" aria-hidden /> Compromissos próximos (30 dias)</p>
      <p className="mt-1 font-display text-[26px] font-bold leading-none tabular-nums">{brl0(c.total)}</p>
      <ul className="mt-3 divide-y divide-border">
        {c.groups.map((g) => (
          <li key={g.key} className="flex items-center justify-between gap-3 py-2 text-[13px]">
            <span>{g.label}</span>
            <span className="font-semibold tabular-nums">{brl0(g.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">{c.hasEstimates ? "Inclui valores estimados." : "Valores confirmados."}</p>
        <Link to="/app/compromissos" className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary">Ver agenda <ArrowRight size={12} aria-hidden /></Link>
      </div>
    </section>
  );
}

export function ReceivableCard({ future }: { future: FutureView | null | undefined }) {
  const r = future?.receivable;
  if (!r) return null;
  return (
    <Link to={r.fromPeople > 0 ? "/app/divisao-do-role" : "/app/compromissos"} aria-label={`A receber ${brl0(r.total)}`}
      className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <span className="flex items-center gap-2 text-sm font-semibold"><Wallet size={16} className="text-primary" aria-hidden /> A receber</span>
      <span className="flex items-center gap-1.5 font-display text-[17px] font-bold tabular-nums">{brl0(r.total)} <ArrowRight size={14} className="text-muted-foreground" aria-hidden /></span>
    </Link>
  );
}

/** Poupança sustentável (renda média − gasto médio) e gasto recuperável (excesso em itens ajustáveis). */
export function OpportunityTiles({ story }: { story: ReportStory }) {
  const savings = story.sustainableSavings;
  const rec = story.recoverable;
  if (!savings && !rec) return null;
  return (
    <section aria-label="Oportunidades" className="grid grid-cols-2 gap-2">
      {savings ? (
        <div className="rounded-2xl border border-border bg-card p-3">
          <p className="text-[12px] font-semibold">Poupança sustentável</p>
          <p className="mt-1 font-display text-[20px] font-bold leading-tight tabular-nums">{brl0(savings.monthly)}<span className="text-[12px] font-semibold text-muted-foreground">/mês</span></p>
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">Quanto sobra, de forma típica, nos últimos {savings.months} meses fechados.</p>
        </div>
      ) : null}
      {rec ? (
        <div className="rounded-2xl border border-border bg-card p-3">
          <p className="text-[12px] font-semibold">Gasto recuperável</p>
          <p className="mt-1 font-display text-[20px] font-bold leading-tight tabular-nums">{brl0(rec.amount)}<span className="text-[12px] font-semibold text-muted-foreground"> neste mês</span></p>
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">Acima do seu habitual em itens ajustáveis: {rec.items.map((i) => i.name).join(", ")}.</p>
        </div>
      ) : null}
    </section>
  );
}

export function ActionCard({ story }: { story: ReportStory }) {
  const a = story.action;
  if (!a) return null;
  return (
    <Link to="/app/lancamentos" aria-label={`Ação recomendada: reduzir ${a.merchant}`} className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 print:break-inside-avoid">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary" aria-hidden><Target size={18} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Ação recomendada</p>
        <p className="mt-0.5 text-[15px] font-bold leading-tight">Reduzir <span className="capitalize">{a.merchant}</span> em {brl0(a.excess)}</p>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
          Você gastou {brl0(a.total)} em {a.merchant} neste mês; seu habitual é {brl0(a.habitual)}. Voltar a ele é uma redução de {Math.round(a.reductionPct * 100)}% e libera {brl0(a.excess)}.
        </p>
      </div>
      <ArrowRight size={16} className="mt-1 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

export function GoalProgressCard({ future }: { future: FutureView | null | undefined }) {
  const g = future?.goal;
  if (!g) return null;
  return (
    <Link to="/app/metas" aria-label={`Meta ${g.name}`} className="block rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Target size={15} className="text-primary" aria-hidden /> Meta: {g.name}</p>
        <p className="text-sm font-bold tabular-nums">{brl0(g.target)}</p>
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
