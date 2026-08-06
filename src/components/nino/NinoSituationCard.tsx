import { Link } from "react-router-dom";
import { CalendarClock, CheckCircle2, CircleAlert, Lightbulb, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NinoCardShell } from "@/components/nino/NinoCardShell";
import { diagnosisActionLabel, diagnosisRouteForSituation } from "@/lib/nino/actions";
import { useNinoSituationFeedback, type FinancialSituation, type FinancialSituationAction } from "@/lib/nino/diagnosis";
import { brl } from "@/lib/nino/format";

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
  const details = [situation.cause_summary, situation.consequence_summary, situation.forecast_summary].filter(Boolean) as string[];
  const consolidatedCount = Number(situation.evaluation?.consolidated_count ?? 1);
  return (
    <NinoCardShell compact={compact} tone={tone} badge={<><Icon className="h-3 w-3" />{LABEL[situation.situation_type] ?? (situation.narrative_role === "counterpoint" ? "Contraponto" : "Leitura")}</>} title={situation.one_line_summary || situation.headline}
      metric={situation.impact_amount != null ? `Impacto estimado: ${brl(Math.abs(situation.impact_amount))}` : consolidatedCount > 1 ? `${consolidatedCount} leituras relacionadas reunidas` : undefined}
      details={!compact && details.length ? <div className="space-y-1">{details.map((text) => <p key={text}>{text}</p>)}<p>Confiança: {Math.round(situation.confidence * 100)}%</p></div> : undefined}
      actions={!compact && label ? <Button asChild className="rounded-full"><Link to={diagnosisRouteForSituation(situation, action)} onClick={() => void send("acted")}>{label}</Link></Button> : undefined}
      feedback={!compact ? <><Button type="button" variant="ghost" size="sm" onClick={() => void send("useful")}><ThumbsUp /> Útil</Button><Button type="button" variant="ghost" size="sm" onClick={() => void send("not_useful")}><ThumbsDown /> Não ajudou</Button></> : undefined}
    >
      {situation.cause_summary || situation.consequence_summary || "Leitura baseada nos seus dados financeiros mais recentes."}
    </NinoCardShell>
  );
}
