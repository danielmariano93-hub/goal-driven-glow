import { useMemo, useState } from "react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from "recharts";
import { CalendarClock, Eye, Sparkles, UserRound } from "lucide-react";
import { AssessmentDialog } from "@/components/behavioral/AssessmentDialog";
import { Button } from "@/components/ui/button";
import {
  BEHAVIOR_DIMENSIONS,
  type BehaviorDimensionKey,
} from "@/lib/behavioral/client";
import {
  type AssessmentCycle,
  type ExtendedBehavioralAssessment,
  type ObservedBehaviorProfile,
} from "@/lib/behavioral/mapCycle";

function dateLabel(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

function confidenceLabel(value: "low" | "medium" | "high") {
  return value === "high" ? "confiança alta" : value === "medium" ? "confiança média" : "confiança baixa";
}

export function BehaviorWheel({
  latest,
  previous,
  assessments,
  observed,
  cycle,
  onSave,
  saving = false,
  baseline = null,
}: {
  latest: ExtendedBehavioralAssessment | null;
  previous: ExtendedBehavioralAssessment | null;
  assessments: ExtendedBehavioralAssessment[];
  observed: ObservedBehaviorProfile;
  cycle: AssessmentCycle;
  onSave: (scores: Record<BehaviorDimensionKey, number>) => Promise<void>;
  saving?: boolean;
  /** Leitura do Nino numa data anterior, desenhada como terceira camada. */
  baseline?: { date: string; scores: Partial<Record<BehaviorDimensionKey, number | null>> } | null;
}) {
  const [open, setOpen] = useState(false);

  const chart = useMemo(() => BEHAVIOR_DIMENSIONS.map((dimension) => ({
    subject: dimension.short,
    self: Number(latest?.scores?.[dimension.key] ?? 0),
    nino: observed.dimensions[dimension.key]?.score ?? null,
    before: baseline?.scores[dimension.key] ?? null,
    fullMark: 10,
  })), [latest, observed, baseline]);

  const strongest = latest
    ? [...BEHAVIOR_DIMENSIONS].sort((a, b) => Number(latest.scores?.[b.key] ?? 0) - Number(latest.scores?.[a.key] ?? 0))[0]
    : null;
  const focus = latest
    ? [...BEHAVIOR_DIMENSIONS].sort((a, b) => Number(latest.scores?.[a.key] ?? 0) - Number(latest.scores?.[b.key] ?? 0))[0]
    : null;
  const delta = latest && previous ? Number(latest.overall_score) - Number(previous.overall_score) : null;
  const strongestScore = strongest && latest ? Number(latest.scores?.[strongest.key] ?? 0) : null;

  const comparable = latest
    ? BEHAVIOR_DIMENSIONS
        .map((dimension) => ({
          dimension,
          self: Number(latest.scores?.[dimension.key] ?? 0),
          observed: observed.dimensions[dimension.key],
        }))
        .filter((row) => row.observed?.score != null)
        .map((row) => ({ ...row, gap: Number(row.observed.score) - row.self }))
        .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    : [];
  const largestGap = comparable[0] ?? null;

  const begin = () => setOpen(true);

  return (
    <>
      <section className="overflow-hidden rounded-[26px] border border-border bg-card shadow-card">
        <div className="p-5 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Seu mapa</p>
              <h2 className="mt-1 font-display text-xl font-bold tracking-tight">Roda financeira comportamental</h2>
              <p className="mt-1 max-w-[560px] text-xs leading-relaxed text-muted-foreground">
                Sua percepção de um lado; evidências financeiras do outro. As duas leituras ficam separadas para mostrar evolução sem transformar comportamento em diagnóstico.
              </p>
            </div>
          </div>

          {latest ? (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-[18px] border border-primary/15 bg-primary/5 p-3">
                <div className="flex items-center gap-1.5 text-primary"><UserRound size={14} /><span className="text-[10px] font-semibold uppercase tracking-wider">Sua percepção</span></div>
                <p className="mt-1 font-display text-2xl font-bold">{Number(latest.overall_score).toFixed(1)}</p>
                <p className="text-[10px] text-muted-foreground">preenchido em {dateLabel(latest.created_at)}</p>
                {delta != null && Math.abs(delta) >= 0.1 ? (
                  <p className={`mt-1 text-[10px] font-semibold ${delta > 0 ? "text-success" : "text-brand-coral"}`}>
                    {delta > 0 ? "+" : ""}{delta.toFixed(1)} vs. avaliação anterior
                  </p>
                ) : null}
              </div>

              <div className="rounded-[18px] border border-success/20 bg-success/5 p-3">
                <div className="flex items-center gap-1.5 text-success"><Eye size={14} /><span className="text-[10px] font-semibold uppercase tracking-wider">Nino observa</span></div>
                <p className="mt-1 font-display text-2xl font-bold">{observed.overallScore == null ? "—" : observed.overallScore.toFixed(1)}</p>
                <p className="text-[10px] text-muted-foreground">cobertura {observed.coverage}/8 dimensões</p>
              </div>

              <div className="col-span-2 rounded-[18px] border border-border bg-secondary/35 p-3 sm:col-span-1">
                <div className="flex items-center gap-1.5 text-muted-foreground"><CalendarClock size={14} /><span className="text-[10px] font-semibold uppercase tracking-wider">Próxima revisão</span></div>
                <p className="mt-1 text-sm font-semibold">
                  {cycle.due ? "Já está disponível" : cycle.daysRemaining === 1 ? "Amanhã" : `Em ${cycle.daysRemaining ?? cycle.cadenceDays} dias`}
                </p>
                <p className="text-[10px] text-muted-foreground">ciclo de {cycle.cadenceDays} dias · perguntas rotativas</p>
              </div>
            </div>
          ) : null}
        </div>

        {latest ? (
          <>
            <div className="h-[310px] px-1 sm:h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={chart} outerRadius="72%">
                  <PolarGrid stroke="hsl(var(--border))" gridType="polygon" />
                  <PolarAngleAxis
                    dataKey="subject"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontWeight: 600 }}
                    tickLine={false}
                  />
                  <Radar
                    name="Você"
                    dataKey="self"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary))"
                    fillOpacity={0.15}
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "hsl(var(--primary))", strokeWidth: 0 }}
                  />
                  {baseline ? (
                    <Radar
                      name="Antes"
                      dataKey="before"
                      stroke="hsl(var(--muted-foreground))"
                      fill="hsl(var(--muted-foreground))"
                      fillOpacity={0.04}
                      strokeWidth={1.5}
                      strokeDasharray="2 3"
                      dot={false}
                    />
                  ) : null}
                  {observed.coverage > 0 ? (
                    <Radar
                      name="Nino"
                      dataKey="nino"
                      stroke="hsl(var(--success))"
                      fill="hsl(var(--success))"
                      fillOpacity={0.07}
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={{ r: 2.5, fill: "hsl(var(--success))", strokeWidth: 0 }}
                    />
                  ) : null}
                </RadarChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center justify-center gap-5 px-4 pb-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-primary" /> Você</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-success" /> Nino observa hoje</span>
              {baseline ? <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border border-dashed border-muted-foreground" /> Nino em {baseline.date.split("-").reverse().slice(0, 2).join("/")}</span> : null}
            </div>

            <div className="grid gap-2 border-t border-border p-4 sm:grid-cols-2">
              {strongest ? (
                <div className="rounded-2xl bg-primary/7 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                    {strongestScore != null && strongestScore >= 7 ? "Ponto forte percebido" : "Sua maior nota hoje"}
                  </p>
                  <p className="mt-1 text-sm font-semibold">{strongest.label}</p>
                  <p className="text-xs text-muted-foreground">
                    Você se deu {Number(latest.scores[strongest.key]).toFixed(1)} de 10{strongestScore != null && strongestScore < 7 ? "; é o maior valor relativo, não um ponto forte consolidado" : ""}.
                  </p>
                </div>
              ) : null}
              {largestGap ? (
                <div className="rounded-2xl bg-success/7 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-success">Onde as leituras mais diferem</p>
                  <p className="mt-1 text-sm font-semibold">{largestGap.dimension.label}</p>
                  <p className="text-xs text-muted-foreground">Você {largestGap.self.toFixed(1)} · Nino {Number(largestGap.observed.score).toFixed(1)} · {confidenceLabel(largestGap.observed.confidence)}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{largestGap.observed.evidence}</p>
                </div>
              ) : focus ? (
                <div className="rounded-2xl bg-secondary/60 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Onde testar uma mudança</p>
                  <p className="mt-1 text-sm font-semibold">{focus.label}</p>
                  <p className="text-xs text-muted-foreground">{Number(latest.scores[focus.key]).toFixed(1)} de 10</p>
                </div>
              ) : null}
            </div>

            {assessments.length > 0 ? (
              <div className="border-t border-border px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Linha de evolução</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {assessments.length === 1 ? "Esta é sua primeira leitura. A próxima cria a primeira comparação real." : `${assessments.length} avaliações salvas para acompanhar sua evolução.`}
                    </p>
                  </div>
                  <div className="flex max-w-[45%] gap-1 overflow-hidden">
                    {[...assessments].slice(0, 6).reverse().map((assessment) => (
                      <span key={assessment.id} className="grid h-8 min-w-8 place-items-center rounded-full bg-secondary text-[10px] font-bold text-foreground">
                        {Number(assessment.overall_score).toFixed(1)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="px-5 pb-5 pt-4">
            <div className="rounded-[22px] border border-dashed border-primary/30 bg-primary/5 p-5 text-center">
              <Sparkles className="mx-auto h-7 w-7 text-primary" />
              <p className="mt-2 text-sm font-semibold">Monte seu primeiro mapa em cerca de 1 minuto</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                Você responde oito perguntas de 0 a 10. Depois, o Nino cruza sua percepção com fatos financeiros sem misturar uma coisa com a outra.
              </p>
            </div>
          </div>
        )}

        <div className="px-4 pb-4">
          <Button type="button" onClick={begin} className="min-h-11 w-full rounded-full font-semibold" variant={latest && !cycle.due ? "outline" : "default"}>
            {latest ? (cycle.due ? "Fazer revisão do mapa" : "Revisar meu mapa") : "Mapear meu momento"}
          </Button>
          {latest && !cycle.due ? (
            <p className="mt-2 text-center text-[10px] text-muted-foreground">Você pode revisar antes, mas o Nino vai te lembrar novamente quando completar o ciclo.</p>
          ) : null}
        </div>
      </section>

      <AssessmentDialog open={open} onClose={() => setOpen(false)} latest={latest} cycle={cycle} onSave={onSave} saving={saving} />
    </>
  );
}
