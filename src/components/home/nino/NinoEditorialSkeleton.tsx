// Skeleton compacto: altura próxima da real, sem bloco gigante na Home.
export function NinoEditorialSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <section aria-label="Orientação do Nino" className="rounded-[20px] border border-border bg-card p-5">
        <div className="h-3 w-28 animate-pulse rounded bg-secondary" />
        <div className="mt-3 h-5 w-4/5 animate-pulse rounded bg-secondary" />
        <div className="mt-2 h-4 w-full animate-pulse rounded bg-secondary" />
        <div className="mt-4 h-7 w-32 animate-pulse rounded bg-secondary" />
        <div className="mt-4 h-11 w-48 animate-pulse rounded-full bg-secondary" />
      </section>
      {[0, 1].map((row) => (
        <div key={row} className="min-h-[72px] rounded-[16px] border border-border bg-card px-4 py-3">
          <div className="h-4 w-3/5 animate-pulse rounded bg-secondary" />
          <div className="mt-2 h-3 w-2/5 animate-pulse rounded bg-secondary" />
        </div>
      ))}
      <span className="sr-only">Carregando a orientação do Nino</span>
    </div>
  );
}
