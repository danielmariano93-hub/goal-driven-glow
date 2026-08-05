import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { NinoItemCard } from "@/components/nino/NinoItemCard";
import { NinoPrimaryInsightCard } from "@/components/nino/NinoPrimaryInsightCard";
import { NinoChangeRow } from "@/components/nino/NinoChangeRow";
import { NinoOperationalSummaryCard } from "@/components/nino/NinoOperationalSummaryCard";
import { NinoRefreshButton } from "@/components/nino/NinoRefreshButton";
import { NinoEmptyBlock, NinoErrorBlock, NinoLoadingBlock, NinoStaleBadge } from "@/components/nino/NinoStateBlocks";
import { markNinoSeen, useNinoContext, type NinoItem } from "@/lib/nino/intelligence";

const SECTIONS = [
  { id: "agora", label: "Agora" },
  { id: "mudancas", label: "O que mudou" },
  { id: "aprendizados", label: "Aprendizados" },
  { id: "prepare-se", label: "Prepare-se" },
  { id: "historico", label: "Histórico" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function Nino() {
  const [params, setParams] = useSearchParams();
  const active = (params.get("section") ?? "agora") as SectionId;
  const { data, isLoading, isError, error, isFetching, refetch } = useNinoContext();
  const [expanded, setExpanded] = useState(false);

  const section = useMemo(() => SECTIONS.find((s) => s.id === active) ?? SECTIONS[0], [active]);

  useEffect(() => {
    // last_seen_at só depois de conteúdo realmente entregue na tela.
    if (data?.ok && !isLoading) void markNinoSeen("nino", "all");
  }, [data?.ok, isLoading]);

  useEffect(() => setExpanded(false), [section.id]);

  const quality = data?.data_quality;
  const insufficient = quality?.status === "insufficient";
  const engine = data?.engine_state;

  const counts: Record<SectionId, number> = {
    agora: (data?.primary_item ? 1 : 0) + (data?.secondary_changes.length ?? 0) + (data?.operational_tasks.length ?? 0),
    mudancas: data?.changes.length ?? 0,
    aprendizados: data?.learnings.length ?? 0,
    "prepare-se": data?.prepare.length ?? 0,
    historico: data?.history.length ?? 0,
  };

  const listFor = (id: SectionId): NinoItem[] => {
    if (id === "mudancas") return data?.changes ?? [];
    if (id === "aprendizados") return data?.learnings ?? [];
    if (id === "prepare-se") return data?.prepare ?? [];
    if (id === "historico") return data?.history ?? [];
    return [];
  };

  const emptyText = (id: SectionId): string => {
    if (insufficient) {
      return "Ainda não há lançamentos suficientes para uma leitura confiável. Registre alguns gastos para o Nino começar.";
    }
    if (id === "agora") return "Nada urgente pede sua atenção neste momento.";
    if (id === "mudancas") return "Nenhuma mudança relevante no período comparado.";
    if (id === "aprendizados") {
      return engine?.patterns_tracked
        ? `O Nino acompanha ${engine.patterns_tracked} padrão${engine.patterns_tracked > 1 ? "ões" : ""}, mas nenhum com confiança suficiente para virar aprendizado agora.`
        : "O Nino ainda está aprendendo seus padrões. Registre mais alguns dias.";
    }
    if (id === "prepare-se") {
      return engine?.patterns_tracked
        ? `Nenhum evento futuro exige preparação: o Nino acompanha ${engine.patterns_tracked} padrão${engine.patterns_tracked > 1 ? "ões" : ""} e ${engine.anticipations_open ?? 0} antecipação${(engine.anticipations_open ?? 0) === 1 ? "" : "ões"} em aberto.`
        : "Ainda não há histórico suficiente para antecipar eventos com confiança.";
    }
    return "Seu histórico aparece aqui conforme o Nino acompanha suas semanas.";
  };

  const items = listFor(section.id);
  const limit = section.id === "historico" ? 8 : 5;
  const visible = expanded ? items : items.slice(0, limit);
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

      {data && quality && quality.status === "insufficient" && (
        <div
          className="rounded-[18px] p-3 text-[12px]"
          style={{ border: "1px solid var(--home-hairline)", background: "var(--home-surface-neutral)" }}
        >
          Ainda não há lançamentos suficientes para leituras confiáveis. Registre alguns gastos para começar.
        </div>
      )}

      <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Seções do Nino">
        {SECTIONS.map((s) => {
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
              {counts[s.id] > 0 && <span className="ml-1 tabular-nums opacity-80">{counts[s.id]}</span>}
            </button>
          );
        })}
      </nav>

      {isLoading ? (
        <NinoLoadingBlock />
      ) : !data ? null : section.id === "agora" ? (
        <div className={`space-y-4 transition-opacity ${isFetching ? "opacity-60" : ""}`} aria-busy={isFetching}>
          {data.primary_item ? (
            <NinoPrimaryInsightCard item={data.primary_item} surface="nino:agora" />
          ) : (
            <NinoEmptyBlock>{emptyText("agora")}</NinoEmptyBlock>
          )}

          {data.secondary_changes.length > 0 && (
            <section className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Também vale saber
              </p>
              {data.secondary_changes.slice(0, 3).map((item, i) => (
                <NinoChangeRow key={item.id ?? `sec-${i}`} item={item} surface="nino:agora" rank={i + 2} />
              ))}
            </section>
          )}

          {data.operational_tasks.length > 0 && (
            <section className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pendências para organizar
              </p>
              {data.operational_tasks.map((item, i) => (
                <NinoOperationalSummaryCard
                  key={item.id ?? `op-${i}`}
                  item={item}
                  surface="nino:operacional"
                  rank={i + 1}
                />
              ))}
            </section>
          )}

          {data.achievements.length > 0 && (
            <section className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Conquistas</p>
              {data.achievements.slice(0, 2).map((item, i) => (
                <NinoItemCard key={item.id ?? `ach-${i}`} item={item} surface="nino:conquistas" rank={i + 1} compact />
              ))}
            </section>
          )}
        </div>
      ) : items.length === 0 ? (
        <NinoEmptyBlock>{emptyText(section.id)}</NinoEmptyBlock>
      ) : (
        <div className={`space-y-3 transition-opacity ${isFetching ? "opacity-60" : ""}`} aria-busy={isFetching}>
          {visible.map((item, i) => (
            <NinoItemCard key={item.id ?? `${section.id}-${i}`} item={item} surface={`nino:${section.id}`} rank={i + 1} />
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
    </div>
  );
}
