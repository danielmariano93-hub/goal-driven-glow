import { useState, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { sideWord } from "@/lib/habits/engine/goals";

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

const INK = "hsl(var(--primary))";
const MUTED = "hsl(var(--muted-foreground))";

/** Fita dando a volta numa região: elipse que se desenha, com as marcas de centímetro aparecendo por cima. */
function Tape({ cx, cy, rx, ry, w = 4 }: { cx: number; cy: number; rx: number; ry: number; w?: number }) {
  return (
    <g>
      <ellipse className="mg-tape" cx={cx} cy={cy} rx={rx} ry={ry} pathLength={100} fill="none" stroke={INK} strokeWidth={w} strokeLinecap="round" />
      <ellipse className="mg-ticks" cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="hsl(var(--card))" strokeWidth={w * 0.28} strokeDasharray="1 2.2" />
    </g>
  );
}

/** Marca de referência: dois pontos de apoio, o meio do caminho e o rótulo de cada ponto. */
function Marks({ x, top, bottom, topLabel, bottomLabel, fs = 9, flip = false }: { x: number; top: number; bottom: number; topLabel: string; bottomLabel: string; fs?: number; flip?: boolean }) {
  const mid = (top + bottom) / 2;
  const t = fs * 0.45;
  const tx = flip ? x + 7 : x - 7;
  return (
    <g className="mg-marks" fontSize={fs} fill={MUTED}>
      <line x1={x} y1={top} x2={x} y2={bottom} stroke={INK} strokeWidth={1.1} strokeDasharray="2 2.5" opacity={0.7} />
      <line x1={x - 4} y1={top} x2={x + 4} y2={top} stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
      <line x1={x - 4} y1={bottom} x2={x + 4} y2={bottom} stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
      <text x={tx} y={top + t} textAnchor={flip ? "start" : "end"}>{topLabel}</text>
      <text x={tx} y={bottom + t} textAnchor={flip ? "start" : "end"}>{bottomLabel}</text>
      <circle className="mg-dot" cx={x} cy={mid} r={3.4} fill={INK} />
    </g>
  );
}

// Silhueta humana de frente, neutra, de 8 cabeças de altura (0 a 300). Metade esquerda desenhada à mão; a direita é o espelho.
const TORSO_LEG =
  "M100.7 42 L94 42 L93.5 54 C86 57 75 59 66 63 C62 70 66 82 71 92 C75 102 80 110 80 120 C80 130 70 140 69 152 " +
  "C68 162 70 168 71 178 C72 192 74 206 76 220 C77 236 79 258 82 276 L82 281 C78 284 72 289 74 294 C76 298 90 298 96 294 " +
  "C97 290 96 286 95 281 L95 276 C94 258 93 236 93 222 C94 206 97 190 99 172 L100.7 168 Z";
const ARM =
  "M66 63 C58 64 54 72 54 82 C53 96 51 108 49 118 C47 130 45 142 44 154 C43 160 40 166 41 172 C42 179 47 181 50 176 " +
  "C52 170 52 160 53 152 C55 140 58 128 60 118 C62 106 64 96 68 88 C70 80 70 70 66 63 Z";
const MIRROR = "translate(200 0) scale(-1 1)";

/** Corpo humano em roxo claro. A opacidade fica no grupo para as partes que se tocam não escurecerem onde se sobrepõem. */
function Body({ arms = true }: { arms?: boolean }) {
  return (
    <g fill={INK} opacity={0.2} stroke="none">
      <ellipse cx={100} cy={26} rx={15} ry={19} />
      <path d={TORSO_LEG} />
      <path d={TORSO_LEG} transform={MIRROR} />
      {arms ? <path d={ARM} /> : null}
      {arms ? <path d={ARM} transform={MIRROR} /> : null}
    </g>
  );
}

/** Região ampliada do corpo para cada medida (viewBox) e o que se desenha por cima. */
const VIEW: Record<MeasureGuideKind, string> = {
  waist: "-24 0 230 182",
  arm: "-36 46 156 124",
  thigh: "-14 140 180 152",
  weight: "-6 146 212 178",
  custom: "-6 0 212 182",
};
// Corpo de frente: o lado ESQUERDO da pessoa fica à DIREITA da figura. Para braço e coxa, o recorte e as marcas espelham em x = 200 − x.
const VIEW_LEFT: Partial<Record<MeasureGuideKind, string>> = { arm: "80 46 156 124", thigh: "34 140 180 152" };
const mx = (x: number, flip: boolean) => (flip ? 200 - x : x);

function Figure({ kind, still, flip }: { kind: MeasureGuideKind; still: boolean; flip: boolean }) {
  switch (kind) {
    case "waist":
      // Última costela (y 102) e topo do osso do quadril (y 140): a fita vai no meio, em y 121.
      return (
        <>
          <Body />
          <Marks x={22} top={102} bottom={140} topLabel="costela" bottomLabel="quadril" />
          <Tape cx={100} cy={121} rx={24} ry={5.5} />
        </>
      );
    case "arm":
      // Ponta do ombro (y 64) e cotovelo (y 118): a fita vai no meio do braço, em y 91.
      return (
        <>
          <Body />
          <Marks x={mx(14, flip)} top={64} bottom={118} topLabel="ombro" bottomLabel="cotovelo" fs={8} flip={flip} />
          <Tape cx={mx(59.5, flip)} cy={91} rx={9} ry={2.6} w={3.2} />
        </>
      );
    case "thigh":
      // Dobra da virilha (y 168) e topo da patela (y 214): a fita vai no meio da coxa, em y 191.
      return (
        <>
          <Body arms={false} />
          <Marks x={mx(44, flip)} top={168} bottom={214} topLabel="virilha" bottomLabel="joelho" fs={8} flip={flip} />
          <Tape cx={mx(84.5, flip)} cy={191} rx={13.5} ry={3.4} w={3.4} />
        </>
      );
    case "weight":
      // Pés na balança: a plataforma fica logo abaixo dos pés (y 298).
      return (
        <>
          <Body arms={false} />
          <rect x={52} y={297} width={96} height={22} rx={11} fill="hsl(var(--primary) / 0.14)" stroke={INK} strokeWidth={1.4} />
          <rect x={86} y={302} width={28} height={12} rx={3.5} fill="hsl(var(--card))" />
          <g fill={INK}>
            {[94, 100, 106].map((cx, i) => (
              <circle key={cx} cx={cx} cy={308} r={1.8}>
                {still ? null : <animate attributeName="opacity" values=".25;.25;1;1;.25" keyTimes="0;.3;.45;.92;1" calcMode="discrete" dur="4.2s" begin={`${i * 0.15}s`} repeatCount="indefinite" />}
              </circle>
            ))}
          </g>
        </>
      );
    default:
      // Medida livre: o mesmo corpo, com a fita no meio do tronco.
      return (
        <>
          <Body />
          <Tape cx={100} cy={100} rx={28} ry={6} />
        </>
      );
  }
}

/** Desenho animado + frase-chave + passo a passo (recolhido). Cabe no alto da folha de registro sem empurrar os campos. */
export function MeasureGuide({ kind: rawKind, side }: { kind: string | null | undefined; side?: "left" | "right" | null }) {
  const kind = guideKind(rawKind);
  const sided = kind === "arm" || kind === "thigh";
  const flip = side === "left" && sided;
  const what = `${LABEL[kind]}${side && sided ? ` ${sideWord(kind, side)}` : ""}`;
  const g = MEASURE_GUIDES[kind];
  const [open, setOpen] = useState(false);
  const still = useReducedMotion();
  return (
    <section aria-label={`Como medir ${what}`} className="rounded-2xl bg-primary/5 px-3 pb-2 pt-2.5">
      <svg viewBox={flip ? (VIEW_LEFT[kind] ?? VIEW[kind]) : VIEW[kind]} data-side={flip ? "left" : undefined} role="img" aria-label={`Animação: como medir ${what}. ${g.key}`} className="mx-auto block h-auto max-h-[200px] w-full">
        <style>{CSS}</style>
        <Figure kind={kind} still={still} flip={flip} />
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
