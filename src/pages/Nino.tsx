import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NinoSituationCard } from "@/components/nino/NinoSituationCard";
import { NinoRefreshButton } from "@/components/nino/NinoRefreshButton";
import { NinoEmptyBlock, NinoErrorBlock, NinoLoadingBlock } from "@/components/nino/NinoStateBlocks";
import { useNinoDiagnosisContext, type FinancialSituation } from "@/lib/nino/diagnosis";

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
  const { data, isLoading, isError, error, isFetching, refetch } = useNinoDiagnosisContext();
  const [expanded, setExpanded] = useState(false);

  const section = useMemo(() => SECTIONS.find((s) => s.id === active) ?? SECTIONS[0], [active]);

  useEffect(() => setExpanded(false), [section.id]);

  const quality = data?.data_quality;
  const insufficient = data?.overall_state === "insufficient_data";
  const current = [data?.primary_situation, ...(data?.supporting_situations ?? [])].filter((item): item is FinancialSituation => Boolean(item));

  const counts: Record<SectionId, number> = {
    agora: current.length + (data?.operational_tasks.length ?? 0),
    mudancas: current.filter((item) => item.status === "improving" || item.status === "worsening").length,
    aprendizados: data?.patterns.length ?? 0,
    "prepare-se": data?.anticipations.length ?? 0,
    historico: (data?.timeline.length ?? 0) + (data?.closings.length ?? 0),
  };

  const listFor = (id: SectionId): FinancialSituation[] => {
    if (id === "mudancas") return current.filter((item) => item.status === "improving" || item.status === "worsening");
    if (id === "aprendizados") return data?.patterns ?? [];
    if (id === "prepare-se") return data?.anticipations ?? [];
    return [];
  };

  const emptyText = (id: SectionId): string => {
    if (insufficient) {
      return "Ainda não há lançamentos suficientes para uma leitura confiável. Registre alguns gastos para o Nino começar.";
    }
    if (id === "agora") return "Nada urgente pede sua atenção neste momento.";
    if (id === "mudancas") return "Nenhuma mudança relevante no período comparado.";
    if (id === "aprendizados") return "O Nino ainda está aprendendo seus padrões. Registre mais alguns dias.";
    if (id === "prepare-se") return "Nenhum compromisso futuro exige preparação agora.";
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
              Diagnóstico causal baseado na sua vida financeira
            </p>
          </div>
          <NinoRefreshButton asOf={data?.as_of} />
        </div>

      </header>

      {isError && (
        <NinoErrorBlock error={error} onRetry={() => void refetch()} retrying={isFetching} hasStaleData={!!data} />
      )}

      {data && insufficient && (
        <div
          className="rounded-[18px] p-3 text-[12px]"
          style={{ border: "1px solid var(--home-hairline)", background: "var(--home-surface-neutral)" }}
        >
          Ainda não há lançamentos suficientes para leituras confiáveis. Registre alguns gastos para começar. {quality?.uncategorized_count ? `${quality.uncategorized_count} lançamento(s) ainda precisam de categoria.` : ""}
        </div>
      )}

      <nav className="-mx-4 flex scroll-px-4 gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Seções do Nino">
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
          {data.primary_situation ? (
            <NinoSituationCard situation={data.primary_situation} action={data.primary_action} surface="nino:agora" />
          ) : (
            <NinoEmptyBlock>{emptyText("agora")}</NinoEmptyBlock>
          )}

          {data.supporting_situations.length > 0 && (
            <section className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Também vale saber
              </p>
              {data.supporting_situations.slice(0, 3).map((item) => (
                <NinoSituationCard key={item.id} situation={item} surface="nino:agora" compact />
              ))}
            </section>
          )}

          {data.operational_tasks.length > 0 && (
            <section className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pendências para organizar
              </p>
              {data.operational_tasks.map((item, i) => (
                <NinoSituationCard key={item.id} situation={item} surface="nino:operacional" compact />
              ))}
            </section>
          )}

        </div>
      ) : section.id === "historico" ? (
        counts.historico === 0 ? <NinoEmptyBlock>{emptyText("historico")}</NinoEmptyBlock> : <div className="space-y-4">
          {data.timeline.slice(0, expanded ? 20 : 6).map((entry) => <article key={entry.situation_id} className="relative border-l-2 border-border pl-5"><span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-primary" /><p className="text-[10px] text-muted-foreground">{new Date(entry.last_event_at).toLocaleDateString("pt-BR")}</p><h2 className="text-sm font-semibold">{entry.headline}</h2><p className="mt-1 text-xs text-muted-foreground">{entry.events[0]?.narrative}</p></article>)}
          {data.closings.map((closing) => <details key={closing.id} className="rounded-[18px] border border-border bg-card p-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold"><span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" />Fechamento até {new Date(`${closing.period_end}T12:00:00`).toLocaleDateString("pt-BR")}</span><ChevronDown className="h-4 w-4" /></summary><p className="mt-3 text-xs leading-relaxed text-muted-foreground">{closing.closing_text || "Resumo consolidado do período."}</p></details>)}
          {data.timeline.length > 6 && !expanded ? <Button variant="outline" className="w-full rounded-full" onClick={() => setExpanded(true)}>Ver histórico completo</Button> : null}
        </div>
      ) : items.length === 0 ? (
        <NinoEmptyBlock>{emptyText(section.id)}</NinoEmptyBlock>
      ) : (
        <div className={`space-y-3 transition-opacity ${isFetching ? "opacity-60" : ""}`} aria-busy={isFetching}>
          {visible.map((item) => (
            <NinoSituationCard key={item.id} situation={item} surface={`nino:${section.id}`} />
          ))}
          {overflow > 0 && (
            <Button
              variant="outline"
              onClick={() => setExpanded(true)}
              className="w-full rounded-full"
            >
              Ver mais {overflow} leitura{overflow > 1 ? "s" : ""}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
