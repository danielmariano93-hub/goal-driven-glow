// Skeleton compacto: mesma densidade do bloco real (Spotlight ~160px, rows ~56px).
export function NinoEditorialSkeleton() {
  return (
    <div className="space-y-3.5" aria-busy="true" aria-live="polite">
      <section aria-label="Orientação do Nino" className="rounded-[18px] border border-border bg-card px-4 py-4">
        <div className="h-2.5 w-20 animate-pulse rounded bg-secondary" />
        <div className="mt-1.5 h-4 w-4/5 animate-pulse rounded bg-secondary" />
        <div className="mt-1 h-3 w-3/5 animate-pulse rounded bg-secondary" />
        <div className="mt-2 h-5 w-28 animate-pulse rounded bg-secondary" />
        <div className="mt-3 h-9 w-40 animate-pulse rounded-full bg-secondary" />
      </section>
      <div className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
        {[0, 1].map((row) => (
          <div key={row} className="min-h-[54px] px-3.5 py-2.5">
            <div className="h-3.5 w-3/5 animate-pulse rounded bg-secondary" />
            <div className="mt-1.5 h-2.5 w-2/5 animate-pulse rounded bg-secondary" />
          </div>
        ))}
      </div>
      <span className="sr-only">Carregando a orientação do Nino</span>
    </div>
  );
}
