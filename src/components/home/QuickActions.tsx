import { Link } from "react-router-dom";
import { PlusCircle, Users, Calculator, LayoutGrid } from "lucide-react";

/**
 * Ações rápidas — quatro colunas nativas, sem minicards.
 */
export function QuickActions() {
  return (
    <section aria-labelledby="quick-actions-title">
      <h2 id="quick-actions-title" className="mb-2 text-[13px] font-bold text-foreground">Atalhos</h2>
      <nav aria-label="Ações rápidas" className="grid grid-cols-4 gap-2">
        <Action to="/app/lancamentos" label="Anotar" icon={<PlusCircle />} />
        <Action to="/app/divisao-do-role" label={"Dividir\nrolê"} icon={<Users />} />
        <Action to="/app/planejamento" label={"Antes de\ncomprar"} icon={<Calculator />} />
        <Action to="/app/mais" label="Mais" icon={<LayoutGrid />} />
      </nav>
    </section>
  );
}

function Action({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="flex min-h-[86px] flex-col items-center justify-start gap-2 rounded-lg pt-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <span
        className="grid h-11 w-11 place-items-center rounded-full [&>svg]:h-5 [&>svg]:w-5"
        className="grid h-11 w-11 place-items-center rounded-full bg-secondary text-primary [&>svg]:h-5 [&>svg]:w-5"
      >
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
