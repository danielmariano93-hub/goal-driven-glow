import { Link } from "react-router-dom";
import { PlusCircle, UsersThree, Calculator, SquaresFour } from "@phosphor-icons/react";

/**
 * Ações rápidas — quatro colunas nativas, sem minicards.
 */
export function QuickActions() {
  return (
    <section aria-labelledby="quick-actions-title">
      <h2 id="quick-actions-title" className="mb-2 text-[13px] font-bold text-foreground">Atalhos</h2>
      <nav aria-label="Ações rápidas" className="grid grid-cols-4 gap-2">
        <Action to="/app/lancamentos" label="Anotar" icon={<PlusCircle weight="duotone" />} tone="violet" />
        <Action to="/app/divisao-do-role" label={"Dividir\nrolê"} icon={<UsersThree weight="duotone" />} tone="coral" />
        <Action to="/app/planejamento" label={"Antes de\ncomprar"} icon={<Calculator weight="duotone" />} tone="mint" />
        <Action to="/app/mais" label="Mais" icon={<SquaresFour weight="duotone" />} tone="ink" />
      </nav>
    </section>
  );
}

function Action({ to, label, icon, tone }: { to: string; label: string; icon: React.ReactNode; tone: "violet" | "coral" | "mint" | "ink" }) {
  const toneClass = tone === "violet" ? "bg-primary/10 text-primary" : tone === "coral" ? "bg-brand-coral/10 text-brand-coral" : tone === "mint" ? "bg-success/10 text-success" : "bg-foreground/5 text-foreground";
  return (
    <Link
      to={to}
      className="group flex min-h-[86px] flex-col items-center justify-start gap-2 rounded-lg pt-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className={`grid h-11 w-11 place-items-center rounded-xl transition-transform group-hover:-translate-y-0.5 [&>svg]:h-5 [&>svg]:w-5 ${toneClass}`}>
        {icon}
      </span>
      <span
        className="whitespace-pre-line text-[11px] font-medium leading-tight text-foreground"
      >
        {label}
      </span>
    </Link>
  );
}
