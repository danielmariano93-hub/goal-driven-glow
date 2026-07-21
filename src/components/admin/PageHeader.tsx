import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

type Crumb = { label: string; to?: string };

export function PageHeader({
  title,
  description,
  actions,
  status,
  crumbs,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  status?: ReactNode;
  crumbs?: Crumb[];
}) {
  return (
    <header className="space-y-3">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Trilha" className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {crumbs.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} className="opacity-60" />}
              {c.to ? (
                <Link to={c.to} className="hover:text-foreground focus-visible:text-foreground">
                  {c.label}
                </Link>
              ) : (
                <span>{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight break-words">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">{description}</p>
          )}
          {status && <div className="mt-3 flex flex-wrap items-center gap-2">{status}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
