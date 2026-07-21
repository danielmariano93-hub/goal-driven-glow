import type { ElementType, ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
}: {
  icon?: ElementType;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`surface-card text-center ${compact ? "p-5" : "p-8"}`}>
      {Icon && (
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-secondary text-muted-foreground">
          <Icon size={18} aria-hidden />
        </div>
      )}
      <p className={`${Icon ? "mt-3" : ""} text-sm font-semibold text-foreground`}>{title}</p>
      {description && <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
