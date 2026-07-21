import type { ReactNode } from "react";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  hideOnMobile?: boolean;
  align?: "left" | "right";
};

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  ariaLabel,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  ariaLabel?: string;
}) {
  return (
    <div className="surface-card overflow-hidden">
      {/* Desktop: table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm" aria-label={ariaLabel}>
          <thead className="bg-secondary/50 text-xs text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-4 py-3 ${c.align === "right" ? "text-right" : "text-left"} ${c.className ?? ""}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-secondary/30">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-3 align-top ${c.align === "right" ? "text-right" : ""} ${c.className ?? ""}`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <ul className="md:hidden divide-y divide-border">
        {rows.map((row) => (
          <li key={rowKey(row)} className="p-4 space-y-2">
            {columns
              .filter((c) => !c.hideOnMobile)
              .map((c) => (
                <div key={c.key} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground shrink-0">
                    {c.header}
                  </span>
                  <span className="text-right min-w-0 break-words">{c.cell(row)}</span>
                </div>
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
