import { Link } from "react-router-dom";
import { PlusCircle, Target, Calculator, LayoutGrid } from "lucide-react";

/**
 * Ações rápidas — exatamente 4 colunas.
 * Anotar gasto | Guardar para meta | Antes de comprar | Mais ações
 */
export function QuickActions() {
  return (
    <div className="grid grid-cols-4 gap-2">
      <Action to="/app/lancamentos" label="Anotar gasto" icon={<PlusCircle />} />
      <Action to="/app/metas" label="Guardar p/ meta" icon={<Target />} />
      <Action to="/app/planejamento" label="Antes de comprar" icon={<Calculator />} />
      <Action to="/app/mais" label="Mais ações" icon={<LayoutGrid />} />
    </div>
  );
}

function Action({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="flex min-h-[88px] flex-col items-center justify-center gap-1.5 rounded-[14px] border border-border bg-card p-2 text-center text-[10.5px] font-medium leading-tight text-foreground shadow-card transition-colors hover:border-primary/40"
    >
      <span className="grid h-9 w-9 place-items-center rounded-[12px] bg-muted text-primary [&>svg]:h-4 [&>svg]:w-4">
        {icon}
      </span>
      <span className="line-clamp-2">{label}</span>
    </Link>
  );
}
