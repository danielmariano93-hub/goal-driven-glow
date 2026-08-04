import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { NinoItemCard } from "@/components/nino/NinoItemCard";
import { NinoRefreshButton } from "@/components/nino/NinoRefreshButton";
import { NinoEmptyBlock, NinoErrorBlock, NinoLoadingBlock, NinoStaleBadge } from "@/components/nino/NinoStateBlocks";
import { markNinoSeen, useNinoContext, type NinoItem } from "@/lib/nino/intelligence";

const SECTIONS = [
  { id: "agora", label: "Agora", key: "now" as const, limit: 3 },
  { id: "mudancas", label: "O que mudou", key: "changes" as const, limit: 5 },
  { id: "aprendizados", label: "Aprendizados", key: "learnings" as const, limit: 5 },
  { id: "prepare-se", label: "Prepare-se", key: "prepare" as const, limit: 5 },
  { id: "historico", label: "Histórico", key: "history" as const, limit: 8 },
];

const EMPTY: Record<string, string> = {
  now: "Nada urgente pede sua atenção neste momento.",
  changes: "Nenhuma mudança relevante no período comparado.",
  learnings: "O Nino ainda está aprendendo seus padrões. Registre mais alguns dias.",
  prepare: "Nenhum evento futuro exige preparação agora.",
  history: "Seu histórico aparece aqui conforme o Nino acompanha suas semanas.",
};

const EMPTY_INSUFFICIENT: Record<string, string> = {
  now: "Ainda não há dados suficientes para uma leitura confiável do momento.",
  changes: "Poucos dias registrados para comparar períodos com segurança.",
  learnings: "Ainda sem confiança suficiente para confirmar padrões.",
  prepare: "Ainda não há histórico suficiente para antecipar eventos com confiança.",
  history: "Nenhum período encerrado até agora.",
};

export default function Nino() {
  const [params, setParams] = useSearchParams();
  const active = params.get("section") ?? "agora";
  const { data, isLoading, isError, error, isFetching, refetch } = useNinoContext();
  const [expanded, setExpanded] = useState(false);

  const section = useMemo(() => SECTIONS.find((s) => s.id === active) ?? SECTIONS[0], [active]);

  useEffect(() => {
    // last_seen_at só depois de conteúdo realmente entregue na tela.
    if (data?.ok && !isLoading) void markNinoSeen("nino", "all");
  }, [data?.ok, isLoading]);

  useEffect(() => setExpanded(false), [section.id]);

  const items: NinoItem[] = (data?.[section.key] as NinoItem[] | undefined) ?? [];
  const quality = data?.data_quality;
  const insufficient = quality?.status === "insufficient";
  const visible = expanded ? items : items.slice(0, section.limit);
  const overflow = items.length - visible.length;

  return (
    <div className="mx-auto w-full max-w-md space-y-4 pb-8 md:max-w-2xl">
      <header className="pt-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">Nino</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data?.continuity_topic
                ? `Continuando: ${data.continuity_topic}`
                : "Sua inteligência financeira em um só lugar"}
            </p>
            {isError && data && <NinoStaleBadge asOf={data.as_of} />}
          </div>
          <NinoRefreshButton asOf={data?.as_of} />
        </div>

        {(data?.new_since_last_visit ?? 0) > 0 && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
            <Sparkles className="h-3 w-3" />
            {data?.new_since_last_visit} novidade{(data?.new_since_last_visit ?? 0) > 1 ? "s" : ""} desde sua última visita
          </p>
        )}
      </header>

      {isError && (
        <NinoErrorBlock error={error} onRetry={() => void refetch()} retrying={isFetching} hasStaleData={!!data} />
      )}

      {data && quality && quality.status !== "ok" && (
        <div
          className="rounded-[18px] p-3 text-[12px]"
          style={{ border: "1px solid var(--home-hairline)", background: "var(--home-surface-neutral)" }}
        >
          {quality.status === "insufficient"
            ? "Ainda não há lançamentos suficientes para leituras confiáveis. Registre alguns gastos para começar."
            : `Existem ${quality.uncategorized_count} lançamentos sem categoria no mês. Classificar melhora todas as leituras.`}
        </div>
      )}

      <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Seções do Nino">
        {SECTIONS.map((s) => {
          const count = ((data?.[s.key] as NinoItem[] | undefined) ?? []).length;
          const isActive = s.id === section.id;
          return (
            <button
              key={s.id}
              type="button"
              aria-current={isActive}
              onClick={() => setParams({ section: s.id }, { replace: true })}
              className={`min-h-[40px] whitespace-nowrap rounded-full px-3 text-[12px] font-semibold transition active:scale-[0.97] ${
                isActive ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
              }`}
            >
              {s.label}
              {count > 0 && <span className="ml-1 tabular-nums opacity-80">{count}</span>}
            </button>
          );
        })}
      </nav>

      {isLoading ? (
        <NinoLoadingBlock />
      ) : !data ? null : items.length === 0 ? (
        <NinoEmptyBlock>{insufficient ? EMPTY_INSUFFICIENT[section.key] : EMPTY[section.key]}</NinoEmptyBlock>
      ) : (
        <div className={`space-y-3 transition-opacity ${isFetching ? "opacity-60" : ""}`} aria-busy={isFetching}>
          {visible.map((item, i) => (
            <NinoItemCard key={item.id ?? `${section.key}-${i}`} item={item} surface={`nino:${section.id}`} rank={i + 1} />
          ))}
          {overflow > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="min-h-[44px] w-full rounded-full border border-border text-[12px] font-semibold text-muted-foreground transition active:scale-[0.99]"
            >
              Ver mais {overflow} leitura{overflow > 1 ? "s" : ""}
            </button>
          )}
        </div>
      )}

      {section.id === "agora" && (data?.achievements?.length ?? 0) > 0 && (
        <section className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Conquistas</p>
          {data!.achievements.slice(0, 2).map((item, i) => (
            <NinoItemCard key={item.id ?? `ach-${i}`} item={item} surface="nino:conquistas" rank={i + 1} compact />
          ))}
        </section>
      )}
    </div>
  );
}
