// Skeleton compacto: mesma densidade do bloco real (Spotlight ~190px, rows ~68px).
export function NinoEditorialSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <section aria-label="Orientação do Nino" className="rounded-[22px] border border-border bg-card px-5 py-[18px]">
        <div className="h-3 w-24 animate-pulse rounded bg-secondary" />
        <div className="mt-2 h-5 w-4/5 animate-pulse rounded bg-secondary" />
        <div className="mt-1.5 h-4 w-3/5 animate-pulse rounded bg-secondary" />
        <div className="mt-3 h-7 w-32 animate-pulse rounded bg-secondary" />
        <div className="mt-3.5 h-11 w-44 animate-pulse rounded-full bg-secondary" />
      </section>
      <div className="divide-y divide-border overflow-hidden rounded-[16px] border border-border bg-card">
        {[0, 1].map((row) => (
          <div key={row} className="min-h-[68px] px-4 py-3">
            <div className="h-4 w-3/5 animate-pulse rounded bg-secondary" />
            <div className="mt-2 h-3 w-2/5 animate-pulse rounded bg-secondary" />
          </div>
        ))}
      </div>
      <span className="sr-only">Carregando a orientação do Nino</span>
    </div>
  );
}
