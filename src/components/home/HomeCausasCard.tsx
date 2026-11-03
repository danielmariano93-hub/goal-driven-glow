import { Link } from "react-router-dom";
import { Lightbulb } from "@phosphor-icons/react";
import { describeCauseLedger } from "@/lib/engine/causePresentation";
import type { CauseLedger } from "@/lib/engine/causeLedger";

/**
 * "Por que está assim?" — o livro de causas do último mês fechado, em fatos contra o normal do próprio usuário.
 * Só aparece para quem foi liberado (o `home-snapshot` só envia `causes` nesse caso) e quando há o que dizer com
 * segurança: confiança baixa, variação pequena ou causa só em lançamentos sem classificação não geram card.
 */
export function HomeCausasCard({ causes }: { causes: CauseLedger | null | undefined }) {
  const card = describeCauseLedger(causes);
  if (!card) return null;
  const tone = card.tone === "worse" ? "text-destructive" : "text-success";
  return (
    <section className="surface-card flex flex-col gap-2 p-4" aria-label="Por que está assim?">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Lightbulb size={14} weight="duotone" /> Por que está assim?
      </div>
      <h2 className={`text-base font-bold ${tone}`}>{card.title}</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {card.lines.map((l) => <li key={l.key}>• {l.text}</li>)}
      </ul>
      {card.unclassified > 0 && (
        <p className="text-xs text-muted-foreground">
          Mais R$ {card.unclassified.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} em lançamentos sem categoria que eu não consegui classificar.
        </p>
      )}
      {card.confidence === "media" && <p className="text-xs text-muted-foreground">Comparação com poucos meses de histórico: leia como indício, não como certeza.</p>}
      {card.question && <Link to="/app/nino" className="text-sm font-semibold text-primary">{card.question}</Link>}
    </section>
  );
}
