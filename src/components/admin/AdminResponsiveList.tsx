import type { ReactNode } from "react";

export type AdminColumn<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
};

export function AdminResponsiveList<T>({
  rows,
  columns,
  rowKey,
}: {
  rows: T[];
  columns: AdminColumn<T>[];
  rowKey: (row: T, index: number) => string;
}) {
  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-3 py-3 font-semibold ${column.align === "right" ? "text-right" : ""}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={rowKey(row, index)} className="border-b border-border/60 last:border-0">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-3 align-top ${column.align === "right" ? "text-right" : ""}`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {rows.map((row, index) => (
          <article key={rowKey(row, index)} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <dl className="grid gap-3">
              {columns.map((column) => (
                <div key={column.key} className="flex items-start justify-between gap-4">
                  <dt className="text-xs font-semibold text-muted-foreground">{column.label}</dt>
                  <dd className="min-w-0 text-right text-sm">{column.render(row)}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}
