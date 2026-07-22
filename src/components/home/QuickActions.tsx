import { Link } from "react-router-dom";
import { PlusCircle, Target, Calculator, LayoutGrid } from "lucide-react";

/**
 * Ações rápidas — quatro colunas nativas, sem minicards.
 */
export function QuickActions() {
  return (
    <nav aria-label="Ações rápidas" className="grid grid-cols-4 gap-2">
      <Action to="/app/lancamentos" label="Anotar" icon={<PlusCircle />} />
      <Action to="/app/metas" label="Guardar" icon={<Target />} />
      <Action to="/app/planejamento" label={"Antes de\ncomprar"} icon={<Calculator />} />
      <Action to="/app/mais" label="Mais" icon={<LayoutGrid />} />
    </nav>
  );
}

function Action({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="flex min-h-[88px] flex-col items-center justify-start gap-2 pt-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded-lg"
    >
      <span
        className="grid h-11 w-11 place-items-center rounded-full [&>svg]:h-5 [&>svg]:w-5"
        style={{ background: "var(--home-quick-bg)", color: "var(--home-brand-violet)" }}
      >
        {icon}
      </span>
      <span
        className="whitespace-pre-line text-[11px] font-medium leading-tight"
        style={{ color: "var(--home-text-1)" }}
      >
        {label}
      </span>
    </Link>
  );
}
