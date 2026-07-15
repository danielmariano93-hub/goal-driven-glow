/**
 * Relatórios detalhados serão implementados numa próxima fase.
 * Nesta versão o dashboard principal já resume os dados factuais.
 */
import { Link } from "react-router-dom";
import { BarChart3 } from "lucide-react";

export default function Relatorios() {
  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">Análises detalhadas em construção.</p>
      </header>
      <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
        <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">Relatórios avançados estão em preparação</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Por enquanto, use o dashboard para ver saldos, receitas, despesas e categorias do mês.
        </p>
        <Link to="/app" className="mt-4 inline-flex rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground">
          Ir ao dashboard
        </Link>
      </div>
    </div>
  );
}
