import { useState, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Como medir, para cada tipo de medida: desenho animado (corpo em roxo claro e a fita) e o passo a passo. */

export type MeasureGuideKind = "weight" | "waist" | "arm" | "thigh" | "custom";

interface Guide {
  /** Frase-chave, a que fica sempre visível. */
  key: string;
  steps: string[];
  note: string;
}

const TAPE_NOTE = "A fita métrica erra cerca de 1 cm: olhe a linha, não uma medida isolada.";

export const MEASURE_GUIDES: Record<MeasureGuideKind, Guide> = {
  weight: {
    key: "De manhã, depois do banheiro, sempre na mesma balança.",
    steps: ["Pese-se logo ao acordar, depois de ir ao banheiro.", "Sem sapatos e com pouca roupa, sempre na mesma balança."],
    note: "O gráfico mostra a média da semana, então um dia isolado pesa pouco.",
  },
  waist: {
    key: "Meio do caminho entre a última costela e o osso do quadril.",
    steps: ["Em pé, relaxado, e solte o ar normalmente.", "Passe a fita no meio do caminho entre a última costela e o osso do quadril.", "Fita reta, encostada na pele, sem apertar."],
    note: TAPE_NOTE,
  },
  arm: {
    key: "Braço solto, no meio do caminho entre o ombro e o cotovelo.",
    steps: ["Braço relaxado, solto ao lado do corpo.", "Fita no meio do caminho entre a ponta do ombro e o cotovelo.", "Sem apertar a pele; meça sempre o mesmo braço."],
    note: TAPE_NOTE,
  },
  thigh: {
    key: "Em pé, no meio do caminho entre a virilha e o joelho.",
    steps: ["Em pé, com o peso dividido nas duas pernas.", "Fita no meio do caminho entre a dobra da virilha e o topo do joelho.", "Fita reta, sem apertar; meça sempre a mesma perna."],
    note: TAPE_NOTE,
  },
  custom: {
    key: "Meça sempre no mesmo ponto e no mesmo horário.",
    steps: ["Escolha um ponto fácil de achar de novo.", "Fita reta, encostada na pele, sem apertar."],
    note: TAPE_NOTE,
  },
};

export const guideKind = (kind: string | null | undefined): MeasureGuideKind => (kind === "weight" || kind === "waist" || kind === "arm" || kind === "thigh" ? kind : "custom");

const LABEL: Record<MeasureGuideKind, string> = { weight: "o peso", waist: "a cintura", arm: "o braço", thigh: "a coxa", custom: "a medida" };

// Um ciclo de ~4 s: a fita dá a volta, o ponto de medida pulsa e as marcas aparecem. Com "reduzir movimento", fica o quadro final.
const CSS = `
.mg-tape{stroke-dasharray:100;stroke-dashoffset:100;animation:mg-wrap 4.2s ease-in-out infinite}
.mg-ticks{opacity:0;animation:mg-ticks 4.2s ease-in-out infinite}
.mg-marks{opacity:0;animation:mg-marks 4.2s ease-in-out infinite}
.mg-dot{transform-box:fill-box;transform-origin:center;animation:mg-pulse 4.2s ease-in-out infinite}
@keyframes mg-wrap{0%,14%{stroke-dashoffset:100;opacity:1}56%,88%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
@keyframes mg-ticks{0%,52%{opacity:0}62%,88%{opacity:1}100%{opacity:0}}
@keyframes mg-marks{0%{opacity:0}12%,90%{opacity:1}100%{opacity:0}}
@keyframes mg-pulse{0%,10%{transform:scale(.6);opacity:.5}24%,44%{transform:scale(1.25);opacity:1}60%,100%{transform:scale(1);opacity:1}}
@media (prefers-reduced-motion:reduce){.mg-tape{animation:none;stroke-dashoffset:0}.mg-ticks,.mg-marks,.mg-dot{animation:none;opacity:1;transform:none}}
`;

const RM_QUERY = "(prefers-reduced-motion: reduce)";
/** "Reduzir movimento" ligado? Os trechos animados por SMIL (o CSS não os alcança) ficam parados. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia?.(RM_QUERY); m?.addEventListener?.("change", cb); return () => m?.removeEventListener?.("change", cb); },
    () => window.matchMedia?.(RM_QUERY).matches ?? false,
    () => false,
  );
}

const BODY = "hsl(var(--primary) / 0.2)";
const LIMB = "hsl(var(--primary) / 0.32)";
const INK = "hsl(var(--primary))";
const MUTED = "hsl(var(--muted-foreground))";

/** Fita dando a volta numa região: elipse que se desenha, com as marcas de centímetro aparecendo por cima. */
function Tape({ cx, cy, rx, ry }: { cx: number; cy: number; rx: number; ry: number }) {
  return (
    <g>
      <ellipse className="mg-tape" cx={cx} cy={cy} rx={rx} ry={ry} pathLength={100} fill="none" stroke={INK} strokeWidth={4.5} strokeLinecap="round" />
      <ellipse className="mg-ticks" cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="hsl(var(--card))" strokeWidth={1.3} strokeDasharray="1.2 2.6" />
    </g>
  );
}

/** Marca de referência: dois pontos de apoio, o meio do caminho e o rótulo de cada ponto. */
function Marks({ x, top, bottom, topLabel, bottomLabel, side }: { x: number; top: number; bottom: number; topLabel: string; bottomLabel: string; side: "left" | "right" }) {
  const mid = (top + bottom) / 2;
  const anchor = side === "left" ? "end" : "start";
  const tx = side === "left" ? x - 6 : x + 6;
  return (
    <g className="mg-marks" fontSize={8.5} fill={MUTED}>
      <line x1={x} y1={top} x2={x} y2={bottom} stroke={INK} strokeWidth={1.2} strokeDasharray="2 2.5" opacity={0.7} />
      <line x1={x - 4} y1={top} x2={x + 4} y2={top} stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
      <line x1={x - 4} y1={bottom} x2={x + 4} y2={bottom} stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
      <text x={tx} y={top + 3} textAnchor={anchor}>{topLabel}</text>
      <text x={tx} y={bottom + 3} textAnchor={anchor}>{bottomLabel}</text>
      <circle className="mg-dot" cx={x} cy={mid} r={3.6} fill={INK} />
    </g>
  );
}

function Figure({ kind, still }: { kind: MeasureGuideKind; still: boolean }) {
  switch (kind) {
    case "waist":
      return (
        <>
          <g fill={BODY} stroke="none">
            <circle cx={120} cy={20} r={12} />
            <path d="M84 44 Q120 36 156 44 L151 74 Q147 90 150 104 Q155 122 157 142 L83 142 Q85 122 90 104 Q93 90 89 74 Z" />
          </g>
          <path d="M78 50 L69 112 M162 50 L171 112" stroke={BODY} strokeWidth={11} strokeLinecap="round" fill="none" />
          <Marks x={46} top={70} bottom={114} topLabel="costela" bottomLabel="quadril" side="left" />
          <Tape cx={120} cy={92} rx={34} ry={7} />
        </>
      );
    case "arm":
      return (
        <>
          <path d="M70 42 Q112 30 152 42 L148 150 L72 150 Z" fill={BODY} />
          <circle cx={112} cy={18} r={12} fill={BODY} />
          <path d="M158 46 L168 96 L170 140" stroke={LIMB} strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Marks x={196} top={40} bottom={100} topLabel="ombro" bottomLabel="cotovelo" side="right" />
          <Tape cx={163} cy={70} rx={14} ry={4.8} />
        </>
      );
    case "thigh":
      return (
        <>
          <rect x={82} y={8} width={76} height={30} rx={14} fill={BODY} />
          <path d="M100 26 L97 134 M140 26 L143 134" stroke={LIMB} strokeWidth={34} strokeLinecap="round" fill="none" />
          <circle cx={97} cy={112} r={6} fill={BODY} />
          <Marks x={66} top={40} bottom={112} topLabel="virilha" bottomLabel="joelho" side="left" />
          <Tape cx={99} cy={76} rx={19} ry={5.5} />
        </>
      );
    case "weight":
      return (
        <>
          <defs>
            <linearGradient id="mg-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="hsl(var(--primary))" stopOpacity="0" />
              <stop offset="0.55" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          <g>
            {still ? null : <animate attributeName="opacity" values=".35;1;1;.35" keyTimes="0;.22;.9;1" dur="4.2s" repeatCount="indefinite" />}
            <rect x={96} y={14} width={24} height={98} rx={11} fill="url(#mg-fade)" />
            <rect x={124} y={14} width={24} height={98} rx={11} fill="url(#mg-fade)" />
          </g>
          <rect x={64} y={112} width={112} height={26} rx={12} fill="hsl(var(--primary) / 0.14)" stroke={INK} strokeWidth={1.4} />
          <rect x={104} y={118} width={32} height={14} rx={4} fill="hsl(var(--card))" />
          <g fill={INK}>
            {[113, 120, 127].map((cx, i) => (
              <circle key={cx} cx={cx} cy={125} r={2}>
                {still ? null : <animate attributeName="opacity" values=".25;.25;1;1;.25" keyTimes="0;.3;.45;.92;1" calcMode="discrete" dur="4.2s" begin={`${i * 0.15}s`} repeatCount="indefinite" />}
              </circle>
            ))}
          </g>
        </>
      );
    default:
      return (
        <>
          <rect x={90} y={14} width={60} height={124} rx={26} fill={BODY} />
          <Tape cx={120} cy={76} rx={32} ry={7} />
        </>
      );
  }
}

/** Desenho animado + frase-chave + passo a passo (recolhido). Cabe no alto da folha de registro sem empurrar os campos. */
export function MeasureGuide({ kind: rawKind }: { kind: string | null | undefined }) {
  const kind = guideKind(rawKind);
  const g = MEASURE_GUIDES[kind];
  const [open, setOpen] = useState(false);
  const still = useReducedMotion();
  return (
    <section aria-label={`Como medir ${LABEL[kind]}`} className="rounded-2xl bg-primary/5 px-3 pb-2 pt-2.5">
      <svg viewBox="0 0 240 150" role="img" aria-label={`Animação: como medir ${LABEL[kind]}. ${g.key}`} className="mx-auto block h-auto max-h-[148px] w-full">
        <style>{CSS}</style>
        <Figure kind={kind} still={still} />
      </svg>
      <p className="mt-1 text-center text-[13px] font-medium leading-[19px]">{g.key}</p>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="mx-auto mt-0.5 flex h-8 items-center gap-1 text-[13px] font-medium text-primary">
        Passo a passo <ChevronDown className={cn("h-4 w-4 transition-transform duration-300", open && "rotate-180")} aria-hidden="true" />
      </button>
      <div className={cn("grid transition-[grid-template-rows] duration-300", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">
          <div className={cn("pb-1 pt-1.5 transition-[visibility] duration-300", !open && "invisible")}>
            <ol className="flex flex-col gap-1.5">
              {g.steps.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] leading-5">
                  <span className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary" aria-hidden="true">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[12px] leading-[18px] text-muted-foreground">{g.note}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
