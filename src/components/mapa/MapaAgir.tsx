import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import type { MapaEvidencePack } from "@/lib/engine/mapaEvidencePack";
import { useMapaNarrative, useRecommendationEvent } from "@/lib/mapa/client";

/**
 * "Para agora": no máximo UMA recomendação, com a evidência e a ação. O texto determinístico aparece na hora;
 * quando a redação da IA chega (e passa pela guarda no servidor), ela o substitui.
 */
export function MapaAgir({ evidence }: { evidence: MapaEvidencePack }) {
  const narrative = useMapaNarrative(true, evidence.hash);
  const event = useRecommendationEvent();
  const [rated, setRated] = useState(false);
  const rec = evidence.recommendation;
  const text = narrative.data ?? { ...evidence.deterministic, source: "template" as const };

  return (
    <section aria-label="Para agora" className="rounded-[22px] border border-primary/30 bg-primary/5 p-4 shadow-card">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground"><Sparkles size={13} aria-hidden /> Para agora</p>
      <p className="mt-2 text-base font-semibold leading-snug">{text.title}</p>
      <p className="mt-1 text-sm leading-relaxed">{text.body}</p>
      {text.question ? <p className="mt-1 text-sm font-semibold leading-snug">{text.question}</p> : null}

      {evidence.facts.length ? (
        <details className="mt-2 text-[13px]">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-muted-foreground">Por que estou dizendo isso</summary>
          <ul className="space-y-1 pb-1">
            {evidence.facts.map((f) => <li key={f.key}><span className="text-muted-foreground">{f.label}: </span><span className="font-semibold tabular-nums">{f.text}</span></li>)}
          </ul>
        </details>
      ) : null}

      {rec ? (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Link to={rec.deeplink} onClick={() => event.mutate({ rec_id: rec.id, event: "accepted" })}
            className="inline-flex min-h-11 items-center gap-1 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
            {rec.action_label} <ArrowRight size={14} aria-hidden />
          </Link>
          <button type="button" disabled={event.isPending} onClick={() => event.mutate({ rec_id: rec.id, event: "dismissed" })} className="min-h-11 px-3 text-[13px] font-semibold text-muted-foreground">Agora não</button>
        </div>
      ) : null}

      {rec && !rated ? (
        <p className="mt-1 flex flex-wrap items-center gap-1 text-[12px] text-muted-foreground">
          Isso ajudou?
          <button type="button" className="min-h-11 px-2 font-semibold" onClick={() => { setRated(true); event.mutate({ rec_id: rec.id, event: "useful" }); }}>Sim</button>
          <button type="button" className="min-h-11 px-2 font-semibold" onClick={() => { setRated(true); event.mutate({ rec_id: rec.id, event: "not_useful" }); }}>Não</button>
        </p>
      ) : null}
      {text.source === "llm" ? <p className="mt-1 text-[11px] text-muted-foreground">Texto escrito pelo Nino com IA, a partir dos números acima.</p> : null}
    </section>
  );
}
