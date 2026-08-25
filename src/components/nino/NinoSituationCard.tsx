import { Link } from "react-router-dom";
import { CalendarClock, CheckCircle2, CircleAlert, Lightbulb, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NinoCardShell } from "@/components/nino/NinoCardShell";
import { buildCommunicationIntent } from "@/lib/copy/commIntent";
import { diagnosisActionLabel, diagnosisRouteForSituation } from "@/lib/nino/actions";
import { useNinoSituationFeedback, type FinancialSituation, type FinancialSituationAction } from "@/lib/nino/diagnosis";

const LABEL: Record<string, string> = { behavioral_pattern: "Aprendizado", anticipation: "Prepare-se", data_quality_issue: "Organização", duplicate_review: "Organização" };

export function NinoSituationCard({ situation, action, surface, compact = false }: { situation: FinancialSituation; action?: FinancialSituationAction | null; surface: string; compact?: boolean }) {
  const feedback = useNinoSituationFeedback();
  const label = diagnosisActionLabel(situation, action);
  const tone = situation.severity === "critical" ? "critical" : situation.severity === "attention" ? "attention" : situation.severity === "positive" ? "positive" : "neutral";
  const Icon = situation.temporal_scope === "future" ? CalendarClock : situation.severity === "positive" ? CheckCircle2 : situation.situation_type === "behavioral_pattern" ? Lightbulb : CircleAlert;
  const send = async (value: "useful" | "not_useful" | "acted") => {
    try { await feedback.mutateAsync({ situationId: situation.id, feedback: value, surface }); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível registrar"); }
  };
  // `nino_comm.v1`: conclusão no nível 1, contexto em UMA frase, resto sob demanda.
  const intent = buildCommunicationIntent(
    {
      headline: situation.headline,
      one_line_summary: situation.one_line_summary,
      summary: situation.cause_summary,
      consequence_summary: situation.consequence_summary,
      forecast_summary: situation.forecast_summary,
      impact_amount: situation.impact_amount,
      severity: situation.severity,
      confidence: situation.confidence,
    },
    compact ? "card" : "card_detail",
  );
  const consolidatedCount = Number(situation.evaluation?.consolidated_count ?? 1);
  return (
    <NinoCardShell compact={compact} tone={tone} badge={<><Icon className="h-3 w-3" />{LABEL[situation.situation_type] ?? (situation.narrative_role === "counterpoint" ? "Contraponto" : "Leitura")}</>} title={intent.conclusion}
      metric={intent.impact_label ?? (consolidatedCount > 1 ? `${consolidatedCount} leituras reunidas` : undefined)}
      details={!compact && intent.detail.length ? <div className="space-y-1">{intent.detail.map((text) => <p key={text}>{text}</p>)}</div> : undefined}
      actions={!compact && label ? <Button asChild size="sm" className="h-8 rounded-full px-3 text-[11px]"><Link to={diagnosisRouteForSituation(situation, action)} onClick={() => void send("acted")}>{label}</Link></Button> : undefined}
      feedback={!compact ? <><Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-[10px]" onClick={() => void send("useful")}><ThumbsUp className="h-3 w-3" /> Útil</Button><Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-[10px]" onClick={() => void send("not_useful")}><ThumbsDown className="h-3 w-3" /> Não ajudou</Button></> : undefined}
    >
      {intent.why_it_matters ?? "Leitura baseada nos seus registros mais recentes."}
    </NinoCardShell>
  );
}
