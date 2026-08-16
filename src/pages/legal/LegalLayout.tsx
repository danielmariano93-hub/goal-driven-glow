import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

type Props = {
  title: string;
  updatedAt: string;
  children: React.ReactNode;
};

export function LegalLayout({ title, updatedAt, children }: Props) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <Link to="/" className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <ArrowLeft size={14} /> Voltar
        </Link>
        <h1 className="mt-6 font-display text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">Última atualização: {updatedAt}</p>
        <article className="legal-prose mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">{children}</article>
        <nav className="mt-12 flex flex-wrap gap-4 border-t border-border pt-6 text-xs text-muted-foreground">
          <Link to="/privacidade">Política de Privacidade</Link>
          <Link to="/termos">Termos de Uso</Link>
          <a href="mailto:contato@meunino.com.br">contato@meunino.com.br</a>
        </nav>
      </div>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-base font-semibold">{heading}</h2>
      {children}
    </section>
  );
}
