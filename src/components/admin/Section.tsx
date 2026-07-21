import type { ElementType, ReactNode } from "react";

export function Section({
  title,
  description,
  icon: Icon,
  action,
  children,
}: {
  title?: string;
  description?: string;
  icon?: ElementType;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      {(title || action) && (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {Icon && <Icon size={14} className="text-primary" />}
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
