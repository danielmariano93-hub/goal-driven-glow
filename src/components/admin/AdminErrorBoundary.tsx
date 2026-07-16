import { Component, ReactNode } from "react";
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

  render() {
    if (this.state.code) {
      return (
        <div className="grid min-h-[60vh] place-items-center px-6">
          <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center">
            <p className="text-sm font-semibold">Não foi possível carregar esta área agora.</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Atualize a página em instantes. Se persistir, informe ao suporte o código de referência.
            </p>
            <p className="mt-3 text-[11px] font-mono text-muted-foreground">Código: {this.state.code}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
