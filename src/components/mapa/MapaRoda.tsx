import { useState } from "react";
import type { MapaIndicator } from "@/lib/engine/mapaContracts";
import { WHEEL_SEGMENTS, WHEEL_STATE_LABEL, wedgePath, wheelStates, type WheelState } from "@/lib/mapa/wheel";

const FILL: Record<WheelState, string> = {
  ok: "fill-emerald-500/80",
  atencao: "fill-amber-400/90",
  critico: "fill-rose-500/85",
  sem_dados: "fill-muted",
  informativo: "fill-sky-400/45",
};
const DOT: Record<WheelState, string> = {
  ok: "bg-emerald-500", atencao: "bg-amber-400", critico: "bg-rose-500", sem_dados: "bg-muted-foreground/30", informativo: "bg-sky-400/60",
};

const CX = 160, CY = 160, R_IN = 58, R_OUT = 122, GAP = 2;

/**
 * A roda da vida financeira: 8 áreas, cada uma com um estado (cor + texto). Não há nota geral nem média:
 * uma média esconderia justamente a área frágil. Tocar numa área leva até ela.
 */
export function MapaRoda({ indicators, wellbeingText }: { indicators: MapaIndicator[]; wellbeingText?: string | null }) {
  const states = wheelStates(indicators);
  const [open, setOpen] = useState(false);
  const step = 360 / WHEEL_SEGMENTS.length;
  const goTo = (id: string) => document.getElementById(`pilar-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const summary = WHEEL_SEGMENTS.map((s) => `${s.label}: ${WHEEL_STATE_LABEL[states[s.id]]}`).join("; ");

  return (
    <section aria-label="Roda da vida financeira" className="rounded-[22px] border border-border bg-card p-4 shadow-card" data-testid="mapa-roda">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">A sua roda financeira</p>
      <p className="mt-1 text-[13px] leading-snug text-muted-foreground">Oito áreas da sua vida com dinheiro, cada uma com a sua cor. Sem nota geral.</p>

      <svg viewBox="-30 -4 380 328" role="img" aria-label={`Roda financeira. ${summary}`} className="mx-auto mt-2 block w-full max-w-[340px]">
        {WHEEL_SEGMENTS.map((seg, i) => {
          const a0 = i * step + GAP / 2, a1 = (i + 1) * step - GAP / 2;
          const mid = ((i + 0.5) * step - 90) * (Math.PI / 180);
          const lx = CX + (R_OUT + 20) * Math.cos(mid), ly = CY + (R_OUT + 20) * Math.sin(mid);
          const anchor = Math.abs(Math.cos(mid)) < 0.25 ? "middle" : Math.cos(mid) > 0 ? "start" : "end";
          const st = states[seg.id];
          return (
            <g key={seg.id} onClick={() => goTo(seg.id)} className="cursor-pointer" data-segment={seg.id} data-state={st}>
              <path d={wedgePath(CX, CY, R_IN, R_OUT, a0, a1)} className={FILL[st]} stroke="currentColor" strokeOpacity={st === "sem_dados" ? 0.35 : 0} strokeDasharray={st === "sem_dados" ? "3 3" : undefined} />
              <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" className="fill-foreground text-[11px] font-semibold">{seg.short}</text>
            </g>
          );
        })}
        <text x={CX} y={CY - 4} textAnchor="middle" className="fill-foreground text-[15px] font-bold">Mapa</text>
        <text x={CX} y={CY + 14} textAnchor="middle" className="fill-muted-foreground text-[10px]">sem nota geral</text>
      </svg>

      <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
        {WHEEL_SEGMENTS.map((seg) => (
          <li key={seg.id}>
            <button type="button" onClick={() => goTo(seg.id)} className="flex min-h-11 w-full items-center gap-2 text-left">
              <span className={`h-3 w-3 shrink-0 rounded-full ${DOT[states[seg.id]]}`} aria-hidden />
              <span className="font-semibold">{seg.label}</span>
              <span className="text-muted-foreground">· {seg.id === "bem_estar" && wellbeingText ? wellbeingText : WHEEL_STATE_LABEL[states[seg.id]]}</span>
            </button>
          </li>
        ))}
      </ul>

      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="mt-1 min-h-11 text-sm font-semibold text-primary">
        {open ? "Fechar a explicação" : "Entenda a roda: o que é, por que importa e para que serve"}
      </button>
      {open ? <RodaExplicacao /> : null}
    </section>
  );
}

/** Explicação da roda: o que é, por que importa, objetivo e como ler. */
export function RodaExplicacao() {
  return (
    <div className="mt-2 space-y-3 text-[13px] leading-relaxed" data-testid="roda-explicacao">
      <div>
        <p className="font-semibold">O que é</p>
        <p>Um mapa de oito áreas da sua vida com dinheiro: se o que entra sustenta o que sai, se você aguenta um imprevisto, como estão as dívidas, se você constrói futuro, se cumpre o que combina, se o plano cabe na renda, se tem noção do que gasta e como você se sente. Cada fatia mostra como aquela área está agora.</p>
      </div>
      <div>
        <p className="font-semibold">Por que importa</p>
        <p>Dinheiro não é só saldo. Dá para ter renda e ficar frágil diante de um imprevisto, ou ter reserva e uma dívida cara. Ver as áreas juntas mostra onde olhar primeiro e impede que uma área boa esconda uma área frágil.</p>
      </div>
      <div>
        <p className="font-semibold">Para que serve</p>
        <p>Para você decidir o próximo passo, não para tirar nota. Por isso não existe nota geral nem média: uma média esconderia justamente a área que mais precisa de você. A recomendação "Para agora" parte desta roda e sempre aponta para uma única ação.</p>
      </div>
      <div>
        <p className="font-semibold">Como ler</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Verde</strong>: tudo certo. <strong>Amarelo</strong>: atenção. <strong>Vermelho</strong>: precisa de cuidado.</li>
          <li><strong>Cinza tracejado</strong>: ainda não tenho dado para dizer. Ao tocar na área, mostro o que falta.</li>
          <li><strong>Azul</strong>: só informativo. É o caso de Bem-estar (é a sua percepção, não um julgamento) e de medidas ainda em teste.</li>
          <li>A cor de cada fatia é a do indicador mais preocupante daquela área; os detalhes e de onde vem cada número estão logo abaixo.</li>
          <li>A roda muda quando os seus dados mudam. Para ver a diferença de uma semana para outra, olhe "O que mudou".</li>
        </ul>
      </div>
    </div>
  );
}
