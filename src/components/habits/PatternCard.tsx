import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { projectedForTarget, type CommitmentState, type HabitPattern, type LimitSuggestion } from "@/lib/behavioral/habitPatterns";

const reais = (n: number) => `R$ ${Math.round(Math.abs(n)).toLocaleString("pt-BR")}`;

function LimitOffer({
  s, busy, onAccept, onDecline,
}: { s: LimitSuggestion; busy: boolean; onAccept: (target: number) => void; onDecline: () => void }) {
  const [target, setTarget] = useState(s.target);
  const valid = Number.isFinite(target) && target >= 10 && target <= Math.max(10, Math.round(s.expected));
  const projected = projectedForTarget(s, target);
  const vs = projected - s.anchor.amount;
  return (
    <div className="mt-3 rounded-2xl border border-primary/20 bg-primary/5 p-3">
      <p className="text-sm font-semibold">Um limite possível para este fim de semana</p>
      <ol className="mt-2 space-y-1 text-[13px] leading-relaxed text-muted-foreground">
        {s.rationale.map((line) => <li key={line}>• {line}</li>)}
      </ol>
      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
        No ritmo atual, o mês de {s.category} pode fechar entre {reais(s.projected_low)} e {reais(s.projected_high)} (hipótese, não promessa).
      </p>
      <label className="mt-3 block text-[12px] font-semibold" htmlFor={`limit-${s.category}`}>Seu limite para {s.category} (R$)</label>
      <input id={`limit-${s.category}`} type="number" inputMode="numeric" min={10} step={10} value={Number.isFinite(target) ? target : ""}
        onChange={(e) => setTarget(Number(e.target.value))}
        className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-base font-semibold" />
      {valid ? (
        <p className="mt-2 text-[13px] leading-relaxed" data-testid="limit-effect">
          Com {reais(target)}, o mês de {s.category} fecha em torno de <strong>{reais(projected)}</strong>, {vs > 0 ? <>ainda {reais(vs)} acima</> : <>{reais(vs)} abaixo</>} da {s.anchor.kind === "goal" ? "meta" : "média dos últimos 3 meses"} ({reais(s.anchor.amount)}).
        </p>
      ) : (
        <p className="mt-2 text-[12px] text-muted-foreground">Escolha um valor entre R$ 10 e {reais(s.expected)} (o seu fim de semana típico).</p>
      )}
      <div className="mt-3 flex gap-2">
        <Button type="button" className="min-h-11 flex-1 rounded-full font-semibold" disabled={!valid || busy} onClick={() => onAccept(target)}>
          <Check size={16} /> Aceitar {valid ? reais(target) : "limite"}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 rounded-full" disabled={busy} onClick={onDecline}>Agora não</Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Nada é criado até você aceitar. Na segunda, o Nino conta como foi — sem julgamento.</p>
    </div>
  );
}

/** Uma descoberta recorrente: observação → evidência → o que pode significar → o que dá para fazer. */
export function PatternCard({
  pattern, commitment, busy, onAccept, onDecline,
}: {
  pattern: HabitPattern;
  commitment?: CommitmentState;
  busy: boolean;
  onAccept: (s: LimitSuggestion, target: number) => void;
  onDecline: (s: LimitSuggestion) => void;
}) {
  const [open, setOpen] = useState(false);
  const action = pattern.action;
  const accepted = commitment?.status === "accepted" || commitment?.status === "kept" || commitment?.status === "missed";
  const declined = commitment?.status === "declined";
  return (
    <article className="rounded-[22px] border border-border bg-card p-4 shadow-card" aria-label={pattern.title}>
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"><Repeat size={12} aria-hidden /> Um padrão que se repete</p>
      <h3 className="mt-1 font-display text-lg font-bold leading-tight tracking-tight">{pattern.title}</h3>
      <ul className="mt-2 space-y-1 text-[13px] leading-relaxed">
        {pattern.evidence.map((line) => <li key={line}>• {line}</li>)}
      </ul>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{pattern.meaning}</p>
      <details className="mt-2 text-[12px] text-muted-foreground">
        <summary className="cursor-pointer font-semibold text-foreground">Outras explicações possíveis</summary>
        <ul className="mt-1 space-y-1">{pattern.alternatives.map((a) => <li key={a}>• {a}</li>)}</ul>
      </details>

      {action?.kind === "review_goal" ? (
        <div className="mt-3 rounded-2xl bg-secondary/50 p-3 text-[13px] leading-relaxed">
          {action.rationale.map((line) => <p key={line} className="text-muted-foreground">{line}</p>)}
          <Link to="/app/metas" className="mt-1 inline-flex min-h-11 items-center gap-1 font-semibold text-primary">Rever a meta de {action.category} <ArrowRight size={14} aria-hidden /></Link>
        </div>
      ) : null}

      {action?.kind === "suggest_limit" && !declined ? (
        accepted ? (
          <p className="mt-3 rounded-2xl bg-success/10 p-3 text-[13px] leading-relaxed" data-testid="limit-accepted">
            <strong>Combinado:</strong> até {commitment?.target_amount != null ? reais(commitment.target_amount) : reais(action.target)} em {action.category} neste fim de semana. Na segunda o Nino conta como foi.
          </p>
        ) : open ? (
          <LimitOffer s={action} busy={busy} onAccept={(t) => onAccept(action, t)} onDecline={() => { setOpen(false); onDecline(action); }} />
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="min-h-11 rounded-full font-semibold" onClick={() => setOpen(true)}>Ver um limite possível</Button>
            <button type="button" className="min-h-11 px-2 text-sm text-muted-foreground" onClick={() => onDecline(action)} disabled={busy}>Agora não</button>
          </div>
        )
      ) : null}
    </article>
  );
}
