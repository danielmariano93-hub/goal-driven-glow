import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Compass } from "lucide-react";
import { useLatestWellbeing, useMapaEnabled, useMapaReading } from "@/lib/mapa/client";
import type { MapaIndicator, MapaPillarId, MapaReading, MapaStatus } from "@/lib/engine/mapaContracts";
import { CONFIDENCE_LABEL, NEEDS_ACTION, PILLAR_LABEL, PILLAR_QUESTION, STATUS_LABEL, changeText, indicatorText, reasonsText } from "@/lib/mapa/indicatorText";
import { MapaAgir } from "@/components/mapa/MapaAgir";
import { MapaRoda } from "@/components/mapa/MapaRoda";
import { MapaCaptureCards, type CaptureKind } from "@/components/mapa/MapaCaptureCards";
import { MapaEstimateCard } from "@/components/mapa/MapaEstimateCard";
import { useResolveQuestion } from "@/lib/mapa/questions";

const SAUDE: readonly MapaPillarId[] = ["equilibrio", "seguranca", "dividas", "futuro"];
const HABITOS: readonly MapaPillarId[] = ["execucao", "planejamento", "acompanhamento"];
/** Código de `needs` → cartão de captura que o resolve. */
const NEED_TO_CAPTURE: Record<string, CaptureKind> = {
  essencial_categoria: "essencial_categoria", debt_rate: "taxa_divida", debt_kind: "taxa_divida", liquidez_investimento: "liquidez_investimento",
};
const QUESTION_TO_CAPTURE: Partial<Record<string, CaptureKind>> = {
  essencial_categoria: "essencial_categoria", taxa_divida: "taxa_divida", liquidez_investimento: "liquidez_investimento",
};

const STATUS_STYLE: Record<MapaStatus, string> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  atencao: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  critico: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  sem_dados: "bg-muted text-muted-foreground",
};

function IndicatorRow({ ind, onNeed }: { ind: MapaIndicator; onNeed: (kind: CaptureKind) => void }) {
  const [open, setOpen] = useState(false);
  const t = indicatorText(ind);
  const reasons = reasonsText(ind);
  const informative = ind.direction === "neutral" && ind.status === "ok";
  const exploratory = ind.reasons.includes("exploratorio");
  const capture = ind.needs?.kind === "capture" ? NEED_TO_CAPTURE[ind.needs.code] : undefined;
  const change = changeText(ind);
  return (
    <li className="border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-11 w-full items-start justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="block text-[13px] text-muted-foreground">{t.title}</span>
          <span className="mt-0.5 block font-display text-lg font-bold tabular-nums">{t.value}</span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 pt-0.5">
          {change && change.tone !== "none" ? <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">{change.tone === "up" ? "↑ " : change.tone === "down" ? "↓ " : "= "}{change.label}</span> : null}
          {exploratory ? <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">Em teste</span> : null}
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${informative ? STATUS_STYLE.sem_dados : STATUS_STYLE[ind.status]}`}>{informative ? "Informativo" : STATUS_LABEL[ind.status]}</span>
          <ChevronDown size={16} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open ? (
        <div className="mt-1 space-y-1.5 text-[13px] leading-snug">
          {t.explain ? <p>{t.explain}</p> : null}
          {ind.status !== "sem_dados" ? <p className="text-muted-foreground">{CONFIDENCE_LABEL[ind.confidence]}.</p> : null}
          {change ? <p className={change.tone === "up" ? "text-emerald-700 dark:text-emerald-300" : change.tone === "down" ? "text-rose-700 dark:text-rose-300" : "text-muted-foreground"}>{change.detail}</p> : null}
          {reasons.map((r) => <p key={r} className="text-muted-foreground">{r}</p>)}
          {capture && ind.needs ? <button type="button" onClick={() => onNeed(capture)} className="inline-flex min-h-11 items-center font-semibold text-primary">{NEEDS_ACTION[ind.needs.code]}</button> : null}
          {ind.needs?.code === "meta_de_poupanca" || ind.needs?.code === "metas_fechadas"
            ? <Link to="/app/metas" className="inline-flex min-h-11 items-center font-semibold text-primary">{NEEDS_ACTION[ind.needs.code]}</Link> : null}
        </div>
      ) : null}
    </li>
  );
}

function Pillar({ id, indicators, onNeed }: { id: MapaPillarId; indicators: MapaIndicator[]; onNeed: (kind: CaptureKind) => void }) {
  if (!indicators.length) return null;
  const label = PILLAR_LABEL[id as keyof typeof PILLAR_LABEL];
  return (
    <section id={`pilar-${id}`} aria-label={label} className="scroll-mt-20 rounded-[22px] border border-border bg-card p-4 shadow-card">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-snug">{PILLAR_QUESTION[id as keyof typeof PILLAR_QUESTION]}</p>
      <ul className="mt-3">{indicators.map((i) => <IndicatorRow key={i.id} ind={i} onNeed={onNeed} />)}</ul>
    </section>
  );
}

function Heading({ children, hint }: { children: string; hint: string }) {
  return (
    <div className="px-1">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground"><Compass size={13} aria-hidden /> {children}</p>
      <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}

/** "O que mudou": só mudanças comparáveis e relevantes (melhorou ou piorou), no máximo 5. */
function Evoluir({ indicators }: { indicators: MapaIndicator[] }) {
  const moved = indicators.filter((i) => i.change?.comparable && (i.change.direction === "melhorou" || i.change.direction === "piorou")).slice(0, 5);
  if (!moved.length) return null;
  return (
    <section aria-label="O que mudou" className="rounded-[22px] border border-border bg-card p-4 shadow-card">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">O que mudou desde a última leitura</p>
      <ul className="mt-2 space-y-1.5 text-[13px]">
        {moved.map((i) => {
          const t = indicatorText(i); const c = changeText(i)!;
          return <li key={i.id}><span className={c.tone === "up" ? "font-semibold text-emerald-700 dark:text-emerald-300" : "font-semibold text-rose-700 dark:text-rose-300"}>{c.tone === "up" ? "↑" : "↓"} {c.label}:</span> {t.title}, {t.value}</li>;
        })}
      </ul>
    </section>
  );
}

/** A pergunta do dia (uma só, no máximo) ou a captura que a pessoa abriu por conta própria. */
function QuestionSlot({ reading, opened, onClose }: { reading: MapaReading; opened: CaptureKind | null; onClose: () => void }) {
  const resolve = useResolveQuestion();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const due = reading.questions_due.find((q) => q.kind !== "cfpb" && !dismissed.has(q.kind)) ?? null;
  const resolveCapture = (kind: CaptureKind, how: "answered" | "skipped" | "later") => resolve.mutate({ kind, how });

  if (opened) {
    // aberta pela pessoa: sem pressão de orçamento, só "Não sei" fecha sem gravar.
    return <MapaCaptureCards kinds={new Set([opened])} onDismiss={onClose} />;
  }
  if (!due) return null;
  if (due.kind === "estimativa_mensal") return <MapaEstimateCard asOf={reading.as_of} />;
  const capture = QUESTION_TO_CAPTURE[due.kind];
  if (!capture) return null;
  return <MapaCaptureCards kinds={new Set([capture])} onResolve={resolveCapture} onDismiss={(k) => setDismissed((d) => new Set(d).add(k))} />;
}

/** Camadas "Saúde financeira" e "Hábitos" do Mapa. Aparece só para contas com `mapa_enabled()`. */
export function MapaEntender({ bemEstar }: { bemEstar?: ReactNode } = {}) {
  const flag = useMapaEnabled();
  const enabled = flag.data === true;
  const { data: payload, isLoading, isError } = useMapaReading(enabled);
  const wellbeing = useLatestWellbeing(enabled);
  const data = payload?.mapa;
  const [opened, setOpened] = useState<CaptureKind | null>(null);
  // O cartão de captura fica abaixo dos pilares: leva a pessoa até ele, senão o toque parece não fazer nada.
  useEffect(() => {
    if (!opened) return;
    const t = window.setTimeout(() => document.getElementById("mapa-captura")?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 50);
    return () => window.clearTimeout(t);
  }, [opened]);
  if (!enabled) return null;
  const by = (pillar: MapaPillarId) => (data?.indicators ?? []).filter((i) => i.pillar === pillar);
  return (
    <div className="space-y-3" data-testid="mapa-entender">
      {data ? <MapaRoda indicators={data.indicators} wellbeingText={wellbeing.data != null ? `${wellbeing.data} de 100 (percepção)` : null} /> : null}
      {payload?.evidence ? <MapaAgir evidence={payload.evidence} /> : null}
      <Heading hint="Em números de verdade, não em notas. Toque em cada um para ver de onde vem.">Saúde financeira</Heading>
      {isLoading ? <p className="px-1 text-[13px] text-muted-foreground" role="status">Montando a sua leitura…</p> : null}
      {isError ? <p className="px-1 text-[13px] text-muted-foreground" role="status">Não consegui montar a leitura agora. Tente de novo em instantes.</p> : null}
      {data ? (
        <>
          {SAUDE.map((p) => <Pillar key={p} id={p} indicators={by(p)} onNeed={setOpened} />)}
          <div id="mapa-captura" className="scroll-mt-20"><QuestionSlot reading={data} opened={opened} onClose={() => setOpened(null)} /></div>
          <Heading hint="O que você faz com o dinheiro no dia a dia. Medidas em teste vêm avisadas.">Hábitos</Heading>
          {HABITOS.map((p) => <Pillar key={p} id={p} indicators={by(p)} onNeed={setOpened} />)}
          {bemEstar ? <div id="pilar-bem_estar" className="scroll-mt-20 space-y-3"><Heading hint="Como você se sente com o seu dinheiro. É a sua percepção, medida a cada 15 dias.">Bem-estar percebido</Heading>{bemEstar}</div> : null}
          <Evoluir indicators={data.indicators} />
        </>
      ) : null}
    </div>
  );
}
