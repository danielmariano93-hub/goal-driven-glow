import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logInsightEvent, projectedForTarget, type CommitmentState, type HabitPattern, type LimitSuggestion, type PatternAction } from "@/lib/behavioral/habitPatterns";
import type { PatternAnswerKey } from "../../../supabase/functions/_shared/proactive/habitContext";

const reais = (n: number) => `R$ ${Math.round(Math.abs(n)).toLocaleString("pt-BR")}`;

function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")} às ${get("hour")}:${get("minute")}`;
}

/** O combinado que já existe: uma faixa discreta, com a origem do aceite (a pessoa sempre sabe que aceitou). */
function CommitmentLine({
  category, c, busy, onChange, onUndo,
}: { category: string; c: CommitmentState; busy: boolean; onChange: () => void; onUndo: () => void }) {
  const who = c.source === "whatsapp" ? "pelo WhatsApp" : "aqui no app";
  return (
    <p className="rounded-xl bg-success/10 px-3 py-2 text-[12px] leading-relaxed" data-testid="limit-accepted">
      <strong>Combinado ativo:</strong> até {c.target_amount != null ? reais(c.target_amount) : "o limite combinado"} em {category}, aceito {who}{c.accepted_at ? ` em ${whenLabel(c.accepted_at)}` : ""}.{" "}
      <button type="button" disabled={busy} onClick={onChange} className="min-h-8 px-1 font-semibold text-primary">Alterar</button>
      <button type="button" disabled={busy} onClick={onUndo} aria-label="Desfazer combinado" className="min-h-8 px-1 font-semibold text-muted-foreground">Desfazer</button>
    </p>
  );
}

function LimitOffer({
  s, busy, initial, onAccept, onDecline,
}: { s: LimitSuggestion; busy: boolean; initial?: number | null; onAccept: (target: number) => void; onDecline: () => void }) {
  const [target, setTarget] = useState(initial ?? s.target);
  const valid = Number.isFinite(target) && target >= 10 && target <= Math.max(10, Math.round(s.expected));
  const projected = projectedForTarget(s, target);
  const vs = projected - s.anchor.amount;
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3">
      <label className="block text-sm font-semibold" htmlFor={`limit-${s.category}`}>Seu limite para {s.category} neste fim de semana (R$)</label>
      <input id={`limit-${s.category}`} type="number" inputMode="numeric" min={10} step={10} value={Number.isFinite(target) ? target : ""}
        onChange={(e) => setTarget(Number(e.target.value))}
        className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-base font-semibold" />
      {valid ? (
        <p className="mt-2 text-[13px] leading-relaxed" data-testid="limit-effect">
          Com {reais(target)}, o mês de {s.category} fecha em torno de <strong>{reais(projected)}</strong>, {vs > 0 ? <>ainda {reais(vs)} acima</> : <>{reais(vs)} abaixo</>} da {s.anchor.kind === "goal" ? "meta" : "média dos últimos 3 meses"} ({reais(s.anchor.amount)}).
        </p>
      ) : (
        <p className="mt-2 text-[12px] text-muted-foreground">Escolha um valor entre R$ 10 e {reais(s.expected)} (o seu fim de semana típico).</p>
      )}
      <details className="mt-2 text-[12px] text-muted-foreground">
        <summary className="cursor-pointer font-semibold text-foreground">Ver a conta</summary>
        <ol className="mt-1 space-y-1">{s.rationale.map((line) => <li key={line}>• {line}</li>)}</ol>
        <p className="mt-1">No ritmo atual, o mês de {s.category} pode fechar entre {reais(s.projected_low)} e {reais(s.projected_high)} (hipótese, não promessa).</p>
      </details>
      <div className="mt-3 flex gap-2">
        <Button type="button" className="min-h-11 flex-1 rounded-full font-semibold" disabled={!valid || busy} onClick={() => onAccept(target)}>
          <Check size={16} /> Aceitar {valid ? reais(target) : "limite"}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 rounded-full" disabled={busy} onClick={onDecline}>Agora não</Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Nada é criado até você aceitar.</p>
    </div>
  );
}

const LINKS: Record<string, { to: string; label: (c: string) => string }> = {
  review_goal: { to: "/app/metas", label: (c) => `Rever a meta de ${c}` },
  create_goal: { to: "/app/metas", label: (c) => `Definir uma meta para ${c}` },
  shared_expenses: { to: "/app/divisao-do-role", label: () => "Dividir uma conta" },
};

function ActionBlock({
  action, commitment, busy, onAccept, onDecline, onUndo,
}: {
  action: PatternAction;
  commitment?: CommitmentState;
  busy: boolean;
  onAccept: (s: LimitSuggestion, t: number) => void;
  onDecline: (s: LimitSuggestion) => void;
  onUndo: (s: LimitSuggestion) => void;
}) {
  const [open, setOpen] = useState(false);
  if (action.kind === "suggest_limit") {
    const accepted = commitment && ["accepted", "kept", "missed"].includes(commitment.status);
    const declined = commitment?.status === "declined";
    if (declined) return null;
    if (accepted && !open) {
      return <CommitmentLine category={action.category} c={commitment} busy={busy} onChange={() => setOpen(true)} onUndo={() => onUndo(action)} />;
    }
    if (open) {
      return <LimitOffer s={action} busy={busy} initial={commitment?.target_amount} onAccept={(t) => { setOpen(false); onAccept(action, t); }} onDecline={() => { setOpen(false); if (!accepted) onDecline(action); }} />;
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" className="min-h-11 rounded-full font-semibold" onClick={() => { setOpen(true); logInsightEvent(`limit:${action.category}`, "limit_opened"); }}>Ver um limite possível para {action.category}</Button>
        <button type="button" className="min-h-11 px-2 text-sm text-muted-foreground" onClick={() => onDecline(action)} disabled={busy}>Agora não</button>
      </div>
    );
  }
  const link = LINKS[action.kind];
  const [first, ...rest] = action.rationale;
  return (
    <div className="text-[13px] leading-relaxed">
      <p className="text-muted-foreground">{first}</p>
      {rest.length ? (
        <details className="mt-1 text-[12px] text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-foreground">Entender</summary>
          {rest.map((line) => <p key={line} className="mt-1">{line}</p>)}
        </details>
      ) : null}
      <Link to={link.to} className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary">{link.label(action.category)} <ArrowRight size={14} aria-hidden /></Link>
    </div>
  );
}

/**
 * Hierarquia de um insight (uma coisa principal por vez):
 *   título → uma frase de evidência → UMA pergunta (ou a resposta + o que dá para fazer) → consequência curta.
 * Tudo o mais (evidências por categoria, o que o Nino não sabe, outras explicações, "fez sentido?") fica em "Ver detalhes".
 */
export function PatternCard({
  pattern, commitments, busy, onAnswer, onClearAnswer, onAccept, onDecline, onUndo,
}: {
  pattern: HabitPattern;
  commitments: Record<string, CommitmentState>;
  busy: boolean;
  onAnswer: (categories: string[], key: PatternAnswerKey) => void;
  onClearAnswer: (categories: string[]) => void;
  onAccept: (s: LimitSuggestion, target: number) => void;
  onDecline: (s: LimitSuggestion) => void;
  onUndo: (s: LimitSuggestion) => void;
}) {
  const [skipped, setSkipped] = useState(false);
  const [vote, setVote] = useState<"useful" | "not_useful" | null>(null);
  useEffect(() => { logInsightEvent(pattern.id, "shown", { scope: pattern.scope, asked: !!pattern.question }); }, [pattern.id, pattern.scope, pattern.question]);

  const shownActions: PatternAction[] = pattern.answer ? pattern.actions : skipped ? pattern.skip_actions : [];
  const existing = pattern.categories.filter((c) => commitments[c] && ["accepted", "kept", "missed"].includes(commitments[c].status));
  // O combinado existente aparece (discreto) mesmo antes de qualquer resposta, para a pessoa saber o que já vale.
  const orphanCommitments = existing.filter((c) => !shownActions.some((a) => a.kind === "suggest_limit" && a.category === c));

  return (
    <article className="rounded-[22px] border border-border bg-card p-4 shadow-card" aria-label={pattern.title}>
      <h3 className="font-display text-xl font-bold leading-tight tracking-tight">{pattern.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-foreground/80" data-testid="pattern-summary">{pattern.summary}</p>

      {pattern.question && !skipped ? (
        <div className="mt-4" data-testid="context-question">
          <p className="text-sm font-semibold">{pattern.question.text}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {pattern.question.options.map((o) => (
              <button key={o.key} type="button" disabled={busy}
                onClick={() => { onAnswer(pattern.categories, o.key); logInsightEvent(pattern.id, "answered", { answer: o.key }); }}
                className="min-h-10 rounded-full border border-border px-4 text-[13px] font-semibold active:bg-secondary">{o.label}</button>
            ))}
          </div>
          <button type="button" className="mt-1 min-h-9 text-[11px] text-muted-foreground"
            onClick={() => { setSkipped(true); logInsightEvent(pattern.id, "skipped"); }}>Prefiro não responder</button>
        </div>
      ) : null}

      {pattern.answer ? (
        <div className="mt-3 text-[13px] leading-relaxed">
          <p className="flex flex-wrap items-center gap-x-2">
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[12px] font-semibold text-primary">Você respondeu: {pattern.answer.label}</span>
            <button type="button" disabled={busy} onClick={() => onClearAnswer(pattern.categories)} className="min-h-9 text-[12px] font-semibold text-muted-foreground">Alterar</button>
          </p>
          {pattern.interpretation ? <p className="mt-1 text-muted-foreground">{pattern.interpretation}</p> : null}
        </div>
      ) : null}

      {shownActions.length ? (
        <div className="mt-3 space-y-2" data-testid="pattern-actions">
          {shownActions.map((a, i) => (
            <ActionBlock key={`${a.kind}-${a.category}-${i}`} action={a} commitment={commitments[a.category]} busy={busy} onAccept={onAccept} onDecline={onDecline} onUndo={onUndo} />
          ))}
        </div>
      ) : null}

      {orphanCommitments.map((c) => (
        <div key={c} className="mt-3">
          <CommitmentLine category={c} c={commitments[c]} busy={busy}
            onChange={() => setSkipped(true)} onUndo={() => onUndo({ category: c, friday: commitments[c].friday } as LimitSuggestion)} />
        </div>
      ))}

      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground" data-testid="consequence-line">{pattern.consequence_short}</p>

      <details className="mt-2 text-[12px] text-muted-foreground">
        <summary className="cursor-pointer py-1 font-semibold text-foreground">Ver detalhes</summary>
        <ul className="mt-1 space-y-1">{pattern.evidence.map((line) => <li key={line}>• {line}</li>)}</ul>
        <p className="mt-2">{pattern.consequence}</p>
        {pattern.unknown ? <p className="mt-2"><strong className="text-foreground">O que ainda não sei:</strong> {pattern.unknown.replace(/^Ainda não sei /, "")}</p> : null}
        <p className="mt-2 font-semibold text-foreground">Outras explicações possíveis</p>
        <ul className="mt-1 space-y-1">{pattern.alternatives.map((a) => <li key={a}>• {a}</li>)}</ul>
        <div className="mt-3 flex items-center gap-1 border-t border-border pt-2">
          <span className="mr-1">Isso fez sentido?</span>
          <button type="button" aria-label="Fez sentido" aria-pressed={vote === "useful"} disabled={vote != null}
            onClick={() => { setVote("useful"); logInsightEvent(pattern.id, "useful"); }} className="grid h-10 w-10 place-items-center rounded-full hover:bg-secondary"><ThumbsUp size={15} /></button>
          <button type="button" aria-label="Não fez sentido" aria-pressed={vote === "not_useful"} disabled={vote != null}
            onClick={() => { setVote("not_useful"); logInsightEvent(pattern.id, "not_useful"); }} className="grid h-10 w-10 place-items-center rounded-full hover:bg-secondary"><ThumbsDown size={15} /></button>
          {vote ? <span className="ml-1">Obrigado.</span> : null}
        </div>
      </details>
    </article>
  );
}
