import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Plus, Send, Trash2, UserPlus, Users, LogOut, XCircle, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  useSharedGoal,
  useSharedGoalMembers,
  useSharedGoalContribs,
  useSharedGoalRole,
  useAddContribution,
  useInviteSharedGoal,
  useAcceptSharedGoalInvite,
  useDeclineSharedGoalInvite,
  useLeaveSharedGoal,
  useRemoveSharedGoalMember,
  useCancelSharedGoal,
  useUpdateSharedGoal,
} from "@/lib/db/sharedGoals";
import { formatBRL } from "@/lib/engine/facts";
import { normalizeBrPhone, maskBrPhone } from "@/lib/phone";
import { useAuth } from "@/context/AuthContext";

export default function MetaConjuntaDetalhe() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { data: goal, isLoading, error: goalError } = useSharedGoal(id);
  const { data: members = [] } = useSharedGoalMembers(id);
  const { data: contribs = [] } = useSharedGoalContribs(id);
  const { data: role = "outsider" } = useSharedGoalRole(id, user?.id);
  const addC = useAddContribution(id ?? "");
  const invite = useInviteSharedGoal(id ?? "");
  const accept = useAcceptSharedGoalInvite();
  const decline = useDeclineSharedGoalInvite();
  const leave = useLeaveSharedGoal();
  const removeMember = useRemoveSharedGoalMember(id ?? "");
  const cancel = useCancelSharedGoal();
  const update = useUpdateSharedGoal(id ?? "");
  const [openContrib, setOpenContrib] = useState(false);
  const [openInvite, setOpenInvite] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);

  const progress = useMemo(
    () => computeGoalProgressFacts(
      goal?.target_amount ?? 0,
      id ?? "",
      contribs.map((c) => ({ goal_id: id ?? "", amount: Number(c.amount) })),
    ),
    [contribs, goal?.target_amount, id],
  );
  const total = progress.total;
  const pct = progress.pct;
  const isOwner = role === "owner";
  const isMember = role === "owner" || role === "member";
  const isPending = role === "pending";

  if (isLoading) {
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (goalError || !goal) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="text-sm font-medium">Não foi possível abrir esta meta</p>
        <p className="mt-1 text-xs text-muted-foreground">{goalError ? String((goalError as Error).message) : "Meta não encontrada ou sem acesso."}</p>
        <button onClick={() => nav("/app/metas")} className="btn-brand mt-4 text-xs">Voltar para metas</button>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-4 flex items-center gap-2">
        <button onClick={() => nav("/app/metas")} className="rounded-full border border-border bg-card p-2" aria-label="Voltar">
          <ArrowLeft size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-bold tracking-tight">{goal.title}</h1>
          <p className="text-xs text-muted-foreground">
            Meta: {formatBRL(Number(goal.target_amount))}
            {goal.deadline ? ` · ${new Date(goal.deadline + "T00:00:00").toLocaleDateString("pt-BR")}` : ""}
            {goal.status === "cancelled" ? " · cancelada" : goal.status === "completed" ? " · concluída" : ""}
          </p>
        </div>
      </header>

      {isPending && (
        <div className="mb-4 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-semibold">Você foi convidado para esta meta</p>
          <p className="mt-1 text-xs text-muted-foreground">Aceite para acompanhar o progresso e contribuir.</p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => id && accept.mutate(id, { onSuccess: () => toast.success("Convite aceito") })}
              className="btn-brand px-3 py-1.5 text-xs"
            >
              Aceitar
            </button>
            <button
              onClick={() => id && decline.mutate(id, { onSuccess: () => { toast.success("Convite recusado"); nav("/app/metas"); } })}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs"
            >
              Recusar
            </button>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-gradient-brand transition-all" style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
        <p className="mt-2 text-xs">
          <span className="font-semibold tabular-nums">{formatBRL(total)}</span>{" "}
          <span className="text-muted-foreground">
            de {formatBRL(Number(goal.target_amount))} · faltam {formatBRL(Math.max(0, Number(goal.target_amount) - total))}
          </span>
        </p>
        {isMember && goal.status === "active" && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => setOpenContrib(true)} className="btn-brand inline-flex items-center gap-2 text-xs">
              <Plus size={12} /> Contribuir
            </button>
            {isOwner && (
              <>
                <button
                  onClick={() => setOpenInvite(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium"
                >
                  <UserPlus size={12} /> Convidar
                </button>
                <button
                  onClick={() => setOpenEdit(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium"
                >
                  <Pencil size={12} /> Editar
                </button>
                <button
                  onClick={() => {
                    if (confirm("Cancelar esta meta conjunta?")) {
                      cancel.mutate(id!, { onSuccess: () => { toast.success("Cancelada"); nav("/app/metas"); } });
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-destructive"
                >
                  <XCircle size={12} /> Cancelar
                </button>
              </>
            )}
            {!isOwner && (
              <button
                onClick={() => {
                  if (confirm("Sair desta meta?")) leave.mutate(id!, { onSuccess: () => { toast.success("Você saiu da meta"); nav("/app/metas"); } });
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-destructive"
              >
                <LogOut size={12} /> Sair
              </button>
            )}
          </div>
        )}
      </section>


      <section className="mt-5">
        <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Users size={12} /> Participantes ({members.length})
        </h2>
        {members.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-xs text-muted-foreground">
            Convide alguém para participar.
          </p>
        ) : (
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {m.user_id === user?.id ? "Você" : m.phone_e164 ? maskBrPhone(m.phone_e164) : "Membro"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {m.role === "owner" ? "criador(a)" : m.invite_status}
                    {m.contribution_total > 0 ? ` · ${formatBRL(Number(m.contribution_total))}` : ""}
                  </p>
                </div>
                {isOwner && m.role !== "owner" && m.user_id !== user?.id && (
                  <button
                    onClick={() => {
                      if (confirm("Remover este participante?")) {
                        removeMember.mutate(m.id, { onSuccess: () => toast.success("Removido") });
                      }
                    }}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Remover"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </li>

            ))}
          </ul>
        )}
      </section>

      <section className="mt-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contribuições</h2>
        {contribs.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-xs text-muted-foreground">
            Nenhuma contribuição ainda.
          </p>
        ) : (
          <ul className="space-y-1">
            {contribs.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  {new Date(c.occurred_at + "T00:00:00").toLocaleDateString("pt-BR")}
                  {c.user_id === user?.id ? " · você" : ""}
                </span>
                <span className="font-medium tabular-nums">{formatBRL(Number(c.amount))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {openContrib && (
        <ContribModal
          saving={addC.isPending}
          onClose={() => setOpenContrib(false)}
          onSubmit={(v) =>
            addC.mutate(v, {
              onSuccess: () => {
                toast.success("Contribuição registrada");
                setOpenContrib(false);
              },
              onError: (e) => toast.error("Erro", { description: String((e as Error).message) }),
            })
          }
        />
      )}

      {openInvite && (
        <InviteModal
          saving={invite.isPending}
          onClose={() => setOpenInvite(false)}
          onSubmit={(phone) =>
            invite.mutate(phone, {
              onSuccess: () => {
                toast.success("Convite enviado por WhatsApp", {
                  description: "Um lembrete automático é enviado em 72h se a pessoa ainda não tiver respondido.",
                });
                setOpenInvite(false);
              },
              onError: (e) => toast.error("Erro", { description: String((e as Error).message) }),
            })
          }
        />
      )}

      {openEdit && (
        <EditGoalModal
          initial={{ title: goal.title, target_amount: Number(goal.target_amount), deadline: goal.deadline }}
          saving={update.isPending}
          onClose={() => setOpenEdit(false)}
          onSubmit={(v) =>
            update.mutate(v, {
              onSuccess: () => { toast.success("Meta atualizada"); setOpenEdit(false); },
              onError: (e) => toast.error("Erro", { description: String((e as Error).message) }),
            })
          }
        />
      )}

      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        <Link to="/app/metas" className="underline">Ver metas individuais</Link>
      </p>
    </div>
  );
}

function EditGoalModal({
  initial,
  saving,
  onClose,
  onSubmit,
}: {
  initial: { title: string; target_amount: number; deadline: string | null };
  saving: boolean;
  onClose: () => void;
  onSubmit: (v: { title: string; target_amount: number; deadline: string | null }) => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [target, setTarget] = useState(String(initial.target_amount));
  const [deadline, setDeadline] = useState(initial.deadline ?? "");
  const [error, setError] = useState<string | null>(null);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(target.replace(",", "."));
    if (!title.trim() || !Number.isFinite(n) || n <= 0) { setError("Preencha título e valor válidos"); return; }
    onSubmit({ title: title.trim(), target_amount: n, deadline: deadline || null });
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-display text-lg font-bold">Editar meta</h2>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Título</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-base" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Valor alvo</label>
              <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Prazo</label>
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="input-base" />
            </div>
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" disabled={saving} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}


function ContribModal({
  saving,
  onClose,
  onSubmit,
}: {
  saving: boolean;
  onClose: () => void;
  onSubmit: (v: { amount: number; occurred_at: string; note: string }) => void;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      setError("Valor inválido");
      return;
    }
    onSubmit({ amount: n, occurred_at: date, note });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-display text-lg font-bold">Contribuir</h2>
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Valor</label>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Data</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Nota (opcional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="input-base" />
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Send size={12} /> Contribuir</>)}
          </button>
        </div>
      </form>
    </div>
  );
}

function InviteModal({
  saving,
  onClose,
  onSubmit,
}: {
  saving: boolean;
  onClose: () => void;
  onSubmit: (phone: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canPick = typeof navigator !== "undefined" && "contacts" in navigator && "ContactsManager" in window;

  async function pickContact() {
    try {
      // deno-lint-ignore no-explicit-any
      const contacts = await (navigator as any).contacts.select(["tel"], { multiple: false });
      const first = contacts?.[0]?.tel?.[0];
      if (first) setPhone(first);
    } catch (e) {
      // usuário cancelou ou API indisponível
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = normalizeBrPhone(phone);
    if (!n) {
      setError("Telefone inválido. Use DDD + número.");
      return;
    }
    onSubmit(n);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-display text-lg font-bold">Convidar</h2>
        <p className="mt-1 text-xs text-muted-foreground">Quando a pessoa entrar no Meu Nino com esse telefone, ela participa automaticamente.</p>
        <div className="mt-4 space-y-3">
          <label className="mb-1 block text-xs font-medium">Telefone (WhatsApp)</label>
          <div className="flex gap-2">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input-base flex-1" placeholder="(11) 99999-9999" />
            {canPick && (
              <button type="button" onClick={pickContact} className="rounded-full border border-border bg-background px-3 text-xs">
                Contatos
              </button>
            )}
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Convidar"}
          </button>
        </div>
      </form>
    </div>
  );
}
