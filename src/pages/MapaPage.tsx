import { useEffect } from "react";
import { MapaEntender } from "@/components/mapa/MapaEntender";
import { FinancialWellBeingCard } from "@/components/habits/FinancialWellBeingCard";
import { EmotionalCheckinCard } from "@/components/home/EmotionalCheckinCard";

/**
 * Mapa Financeiro (contas com `mapa_enabled()`): "Para agora", Saúde financeira, Hábitos, Bem-estar percebido e "O que mudou".
 * Substitui a roda de notas 0–10 para essas contas; as demais seguem na experiência anterior (rollback = desligar a flag).
 * O check-in de tranquilidade continua aqui (âncora `#checkin`), mas não entra em nota de pilar nenhum.
 */
export default function MapaPage() {
  // Âncora "#checkin" e "?action=checkin": rola até o check-in.
  useEffect(() => {
    const wantsCheckin = window.location.hash === "#checkin" || new URLSearchParams(window.location.search).get("action") === "checkin";
    if (wantsCheckin) window.setTimeout(() => document.getElementById("checkin")?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  }, []);

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-5 pb-24 pt-1" data-mapa-page>
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Mapa Financeiro</p>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Sua situação, seus hábitos e seu bem-estar</h1>
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground">Sem nota geral: cada medida aparece na sua unidade (R$, %, meses) e diz de onde vem.</p>
      </header>

      <MapaEntender bemEstar={<FinancialWellBeingCard />} />

      <section id="checkin" aria-label="Como você está hoje" className="scroll-mt-24">
        <EmotionalCheckinCard />
      </section>
    </div>
  );
}
