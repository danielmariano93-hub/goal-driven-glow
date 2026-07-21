import { Component, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertOctagon, RefreshCw, LayoutDashboard } from "lucide-react";
import { mapAdminError } from "@/lib/admin/errorMapper";

type State = { code: string | null };

export class AdminErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { code: null };

  static getDerivedStateFromError(err: unknown): State {
    return { code: mapAdminError(err).code };
  }

  componentDidCatch() {
    // Server-side logging happens via edge functions; nothing sensitive rendered here.
  }

  private retry = () => {
    this.setState({ code: null });
    // A soft retry: reload the current route without losing the SPA session.
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (this.state.code) {
      return (
        <div className="grid min-h-[60vh] place-items-center px-6">
          <div className="max-w-md w-full rounded-2xl border border-border bg-card p-8 text-center space-y-4">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-warning/15 text-warning-foreground">
              <AlertOctagon size={20} aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold">Não foi possível carregar esta área agora.</p>
              <p className="text-xs text-muted-foreground">
                Atualize a página em instantes. Se persistir, informe ao suporte o código de referência.
              </p>
              <p className="pt-2 text-[11px] font-mono text-muted-foreground">Código: {this.state.code}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={this.retry}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <RefreshCw size={12} /> Tentar novamente
              </button>
              <Link
                to="/admin"
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-medium hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <LayoutDashboard size={12} /> Voltar para Visão Geral
              </Link>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
