import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Minus, Plus } from "@phosphor-icons/react";
import {
  formatPlanPrice, joinPlanWaitlist, PRICE_INTENT_LABEL, trackPlanEvent, useLandingPlans, yearlySavingPct,
  type LandingPlan, type PriceIntent,
} from "@/lib/plans/landingPlans";

const RANK = { no: 0, limited: 1, yes: 2 } as const;

/** O que o plano acrescenta ao anterior: evita repetir a lista inteira em cada cartão. */
function incrementalFeatures(plan: LandingPlan, prev: LandingPlan | null): Array<{ key: string; label: string; sub: string | null }> {
  return plan.features.flatMap((f) => {
    const before = prev?.features.find((x) => x.key === f.key)?.value ?? "no";
    if (RANK[f.value] <= RANK[before]) return [];
    if (f.value === "limited") return [{ key: f.key, label: f.label, sub: f.note }];
    return [{ key: f.key, label: f.label, sub: before === "limited" ? "sem limite" : null }];
  });
}

/** Planos da landing (#planos). Conteúdo editável no admin; "Em breve" abre a lista de espera (fake door). */
export function PlansSection() {
  const { data: plans = [] } = useLandingPlans();
  const [waitlistFor, setWaitlistFor] = useState<LandingPlan | null>(null);
  const ref = useRef<HTMLElement | null>(null);
  const seen = useRef(false);

  // Uma visualização por plano quando a seção entra na tela.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (seen.current || !entries.some((e) => e.isIntersecting)) return;
      seen.current = true;
      plans.forEach((p) => trackPlanEvent(p.slug, "view"));
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [plans]);

  if (!plans.length) return null;
  const featureRows = plans[0]?.features ?? [];

  return (
    <section className="lp-chapter lp-chapter--cloud lp-plans" id="planos" ref={ref}>
      <div className="lp-wrap">
        <div className="lp-chapter-head">
          <h2>Comece grátis. Evolua quando fizer sentido.</h2>
          <p className="lp-lead">Escolha o quanto você quer o Nino por perto. Sem fidelidade e sem pegadinha.</p>
        </div>

        <div className="lp-plan-grid">
          {plans.map((plan, idx) => {
            const soon = plan.availability === "coming_soon";
            const saving = yearlySavingPct(plan);
            const prev = idx > 0 ? plans[idx - 1] : null;
            const items = incrementalFeatures(plan, prev);
            return (
              <article key={plan.slug} className={`lp-plan${plan.highlighted ? " is-highlighted" : ""}${soon ? " is-soon" : ""}`} data-plan={plan.slug}>
                <div className="lp-plan-top">
                  <h3 className="lp-plan-name">{plan.name}</h3>
                  {plan.badge ? <span className="lp-plan-badge">{plan.badge}</span> : null}
                </div>
                {plan.tagline ? <p className="lp-plan-tagline">{plan.tagline}</p> : null}
                <div className="lp-plan-price">
                  {soon || plan.price_monthly == null ? (
                    <strong className="lp-plan-soon">Em breve</strong>
                  ) : (
                    <>
                      <strong>{formatPlanPrice(plan.price_monthly)}</strong>
                      {plan.price_monthly > 0 ? <span>/mês</span> : null}
                    </>
                  )}
                </div>
                {!soon && plan.price_yearly ? (
                  <p className="lp-plan-yearly">ou {formatPlanPrice(plan.price_yearly)}/ano{saving ? <> · <b>economize {saving}%</b></> : null}</p>
                ) : null}

                {soon ? (
                  <button type="button" className="lp-btn ghost lp-plan-cta" onClick={() => { trackPlanEvent(plan.slug, "click_cta"); trackPlanEvent(plan.slug, "waitlist_open"); setWaitlistFor(plan); }}>
                    {plan.cta_label}
                  </button>
                ) : (
                  <Link to="/signup" className={`lp-btn lp-plan-cta ${plan.highlighted ? "primary" : "ghost"}`} onClick={() => trackPlanEvent(plan.slug, "click_cta")}>
                    {plan.cta_label}
                  </Link>
                )}

                {items.length > 0 ? (
                  <>
                    <p className="lp-plan-more">{prev ? `Tudo do ${prev.name}, mais` : "O que está incluído"}</p>
                    <ul className="lp-plan-features">
                      {items.map((f) => (
                        <li key={f.key}>
                          <Check size={16} weight="bold" aria-hidden="true" />
                          <span>{f.label}{f.sub ? <em>{f.sub}</em> : null}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </article>
            );
          })}
        </div>
        <p className="lp-micro lp-plans-foot">Ainda não cobramos nada. Quem já usa o Nino continua com tudo liberado.</p>

        <details className="lp-compare-details">
          <summary>
            Comparar todos os recursos
            <Plus size={20} weight="regular" className="lp-faq-icon" />
          </summary>
          <table className="lp-compare">
            <thead>
              <tr>
                <th scope="col" />
                {plans.map((p) => <th key={p.slug} scope="col" className={p.highlighted ? "is-highlighted" : ""}>{p.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {featureRows.map((row, i) => (
                <tr key={row.key}>
                  <th scope="row">
                    {row.label}
                    {row.description ? <small>{row.description}</small> : null}
                  </th>
                  {plans.map((p) => {
                    const cell = p.features.find((f) => f.key === row.key) ?? p.features[i];
                    return (
                      <td key={p.slug} className={p.highlighted ? "is-highlighted" : ""}>
                        {!cell || cell.value === "no" ? <Minus size={16} className="lp-no" aria-label="Não incluso" />
                          : cell.value === "limited" ? <span className="lp-cell-limited"><i aria-hidden="true" />{cell.note ?? "limitado"}</span>
                          : <Check size={18} weight="bold" aria-label="Incluso" />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
      {waitlistFor ? <WaitlistDialog plan={waitlistFor} onClose={() => setWaitlistFor(null)} /> : null}
    </section>
  );
}

const INTENTS = Object.keys(PRICE_INTENT_LABEL).filter((k) => k !== "nao_informou") as PriceIntent[];
const ERRORS: Record<string, string> = {
  invalid_email: "Confira o e-mail digitado.",
  consent_required: "Marque a autorização para podermos avisar você.",
  busy: "Muitas pessoas entrando agora. Tente de novo em alguns minutos.",
  network: "Não consegui enviar agora. Tente novamente.",
  invalid_plan: "Este plano não está mais disponível.",
};

function WaitlistDialog({ plan, onClose }: { plan: LandingPlan; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [intent, setIntent] = useState<PriceIntent | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await joinPlanWaitlist({ plan: plan.slug, email, intent, consent });
    setBusy(false);
    if (res.ok) setDone(true);
    else setError(ERRORS[res.error ?? "network"] ?? ERRORS.network);
  }

  return (
    <div className="lp-modal" role="dialog" aria-modal="true" aria-label={`Lista de espera: ${plan.name}`} onClick={onClose}>
      <div className="lp-modal-card" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <>
            <h3>Você está na lista.</h3>
            <p>Avisamos por e-mail quando o {plan.name} estiver disponível. Nenhuma cobrança foi feita.</p>
            <button type="button" className="lp-btn primary" onClick={onClose}>Fechar</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <h3>{plan.name} chega em breve</h3>
            <p>Ainda não está disponível e nada será cobrado. Deixe seu e-mail e avisamos quando abrir.</p>
            <label>
              E-mail
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" />
            </label>
            <fieldset>
              <legend>Quanto você pagaria por mês por algo assim? (opcional)</legend>
              <div className="lp-intents">
                {INTENTS.map((k) => (
                  <button key={k} type="button" className={intent === k ? "is-on" : ""} onClick={() => setIntent(intent === k ? null : k)}>{PRICE_INTENT_LABEL[k]}</button>
                ))}
              </div>
            </fieldset>
            <label className="lp-consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>Autorizo o Nino a me avisar por e-mail sobre este plano.</span>
            </label>
            {error ? <p className="lp-modal-error" role="alert">{error}</p> : null}
            <div className="lp-modal-actions">
              <button type="button" className="lp-btn ghost" onClick={onClose}>Cancelar</button>
              <button type="submit" className="lp-btn primary" disabled={busy}>{busy ? "Enviando…" : "Entrar na lista"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
