import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { NinoItemCard } from "@/components/nino/NinoItemCard";
import {
  markNinoSeen,
  useNinoContext,
  useNinoRefresh,
  type NinoItem,
} from "@/lib/nino/intelligence";

const SECTIONS = [
  { id: "agora", label: "Agora", key: "now" as const },
  { id: "mudancas", label: "O que mudou", key: "changes" as const },
  { id: "aprendizados", label: "Aprendizados", key: "learnings" as const },
  { id: "prepare-se", label: "Prepare-se", key: "prepare" as const },
  { id: "historico", label: "Histórico", key: "history" as const },
];

const EMPTY: Record<string, string> = {
  now: "Nada urgente pede sua atenção neste momento.",
  changes: "Nenhuma mudança relevante no período comparado.",
  learnings: "O Nino ainda está aprendendo seus padrões. Registre mais alguns dias.",
  prepare: "Nenhuma preparação necessária para os próximos dias.",
  history: "Seu histórico aparece aqui conforme o Nino acompanha suas semanas.",
};

export default function Nino() {
  const [params, setParams] = useSearchParams();
  const active = params.get("section") ?? "agora";
  const { data, isLoading } = useNinoContext();
  const refresh = useNinoRefresh();

  useEffect(() => {
    void markNinoSeen("nino", "all");
  }, []);

  const section = useMemo(() => SECTIONS.find((s) => s.id === active) ?? SECTIONS[0], [active]);
  const items: NinoItem[] = (data?.[section.key] as NinoItem[] | undefined) ?? [];
  const quality = data?.data_quality;

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
          </div>
          <button
            type="button"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground disabled:opacity-60"
          >
            {refresh.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Atualizar
          </button>
        </div>

        {(data?.new_since_last_visit ?? 0) > 0 && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
            <Sparkles className="h-3 w-3" />
            {data?.new_since_last_visit} novidade{(data?.new_since_last_visit ?? 0) > 1 ? "s" : ""} desde sua última visita
          </p>
        )}
      </header>

      {quality && quality.status !== "ok" && (
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
              onClick={() => setParams({ section: s.id }, { replace: true })}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
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
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div
          className="rounded-[18px] p-5 text-center text-[12px]"
          style={{ border: "1px solid var(--home-hairline)", color: "var(--home-text-2)" }}
        >
          {EMPTY[section.key]}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => (
            <NinoItemCard key={item.id ?? `${section.key}-${i}`} item={item} surface={`nino:${section.id}`} rank={i + 1} />
          ))}
        </div>
      )}

      {section.id === "agora" && (data?.achievements?.length ?? 0) > 0 && (
        <section className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Conquistas</p>
          {data!.achievements.map((item, i) => (
            <NinoItemCard key={item.id ?? `ach-${i}`} item={item} surface="nino:conquistas" rank={i + 1} compact />
          ))}
        </section>
      )}
    </div>
  );
}
