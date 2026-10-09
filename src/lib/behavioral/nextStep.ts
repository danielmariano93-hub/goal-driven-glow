import type { OpenWeekendCommitment } from "@/lib/behavioral/weekendCommitment";

/** Reais inteiros, com espaço comum (igual ao da mensagem do WhatsApp). */
const reais = (value: number) => `R$ ${Math.round(Math.abs(value)).toLocaleString("pt-BR")}`;

/** Uma escolha pequena e concreta, ligada ao que a pessoa já combinou com o Nino. */
export type NextStepFallback = { label: string; to: string; reason: string } | null;

export function nextStepCopy(commitment: OpenWeekendCommitment | null, fallback: NextStepFallback): {
  title: string; body: string; action: { label: string; to: string } | null;
} | null {
  if (commitment) {
    const target = reais(commitment.target_amount);
    const effect = commitment.projected_if_met != null ? ` Nesse limite, o mês fecha em ${reais(commitment.projected_if_met)}.` : "";
    if (commitment.status === "accepted") {
      return {
        title: "Seu combinado deste fim de semana",
        body: `${commitment.category}: ficar em até ${target}.${effect} Na segunda o Nino conta como foi.`,
        action: null,
      };
    }
    return {
      title: "Uma escolha para este fim de semana",
      body: `O Nino propôs um limite de ${target} em ${commitment.category}.${effect} Para combinar, responda “topo” na mensagem do WhatsApp.`,
      action: null,
    };
  }
  if (!fallback) return null;
  return { title: "Uma coisa para fazer diferente", body: fallback.reason, action: { label: fallback.label, to: fallback.to } };
}

