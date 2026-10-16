import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Compass } from "lucide-react";
import { useMapaEnabled, useMapaReading } from "@/lib/mapa/client";
import type { MapaIndicator, MapaReading, MapaStatus } from "@/lib/engine/mapaContracts";
import {
  CONFIDENCE_LABEL, NEEDS_ACTION, PILLAR_LABEL, PILLAR_QUESTION, STATUS_LABEL, indicatorText, reasonsText,
} from "@/lib/mapa/indicatorText";
import { MapaCaptureCards } from "@/components/mapa/MapaCaptureCards";

const PILLARS = ["equilibrio", "seguranca", "dividas", "futuro"] as const;
const CAPTURE_CODES = new Set(["essencial_categoria", "debt_rate", "debt_kind", "liquidez_investimento"]);

const STATUS_STYLE: Record<MapaStatus, string> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  atencao: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  critico: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  sem_dados: "bg-muted text-muted-foreground",
};

function IndicatorRow({ ind }: { ind: MapaIndicator }) {
  const [open, setOpen] = useState(false);
  const t = indicatorText(ind);
  const reasons = reasonsText(ind);
  return (
    <li className="border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-11 w-full items-start justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="block text-[13px] text-muted-foreground">{t.title}</span>
          <span className="mt-0.5 block font-display text-lg font-bold tabular-nums">{t.value}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[ind.status]}`}>{STATUS_LABEL[ind.status]}</span>
          <ChevronDown size={16} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open ? (
        <div className="mt-1 space-y-1.5 text-[13px] leading-snug">
          {t.explain ? <p>{t.explain}</p> : null}
          {ind.status !== "sem_dados" ? <p className="text-muted-foreground">{CONFIDENCE_LABEL[ind.confidence]}.</p> : null}
          {reasons.map((r) => <p key={r} className="text-muted-foreground">{r}</p>)}
          {ind.needs?.code === "meta_de_poupanca"
            ? <Link to="/app/metas" className="inline-flex min-h-11 items-center font-semibold text-primary">{NEEDS_ACTION[ind.needs.code]}</Link> : null}
        </div>
      ) : null}
    </li>
  );
}

function Pillar({ id, indicators }: { id: (typeof PILLARS)[number]; indicators: MapaIndicator[] }) {
  if (!indicators.length) return null;
  return (
    <section aria-label={PILLAR_LABEL[id]} className="rounded-[22px] border border-border bg-card p-4 shadow-card">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{PILLAR_LABEL[id]}</p>
      <p className="mt-1 text-sm font-semibold leading-snug">{PILLAR_QUESTION[id]}</p>
      <ul className="mt-3">{indicators.map((i) => <IndicatorRow key={i.id} ind={i} />)}</ul>
    </section>
  );
}

function needsOf(reading: MapaReading): Set<string> {
  const out = new Set<string>();
  for (const i of reading.indicators) if (i.needs?.kind === "capture" && CAPTURE_CODES.has(i.needs.code)) out.add(i.needs.code);
  return out;
}

/** Camada "Saúde financeira" do Mapa. Aparece só para contas com `mapa_enabled()`. */
export function MapaSaude() {
  const flag = useMapaEnabled();
  const enabled = flag.data === true;
  const { data, isLoading, isError } = useMapaReading(enabled);
  if (!enabled) return null;
  return (
    <div className="space-y-3" data-testid="mapa-saude">
      <div className="px-1">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground"><Compass size={13} aria-hidden /> Saúde financeira</p>
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground">Em números de verdade, não em notas. Toque em cada um para ver de onde vem.</p>
      </div>
      {isLoading ? <p className="px-1 text-[13px] text-muted-foreground" role="status">Montando a sua leitura…</p> : null}
      {isError ? <p className="px-1 text-[13px] text-muted-foreground" role="status">Não consegui montar a leitura agora. Tente de novo em instantes.</p> : null}
      {data ? (
        <>
          {PILLARS.map((p) => <Pillar key={p} id={p} indicators={data.indicators.filter((i) => i.pillar === p)} />)}
          <MapaCaptureCards needs={needsOf(data)} />
        </>
      ) : null}
    </div>
  );
}
