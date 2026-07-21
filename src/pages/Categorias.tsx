import { useState } from "react";
import { Plus, Trash2, Loader2, Pencil, Tag } from "lucide-react";
import { toast } from "sonner";
import { useCategories, useSaveCategory, useDeleteCategory, resolveVisibleCategories, type CategoryRow } from "@/lib/db/finance";
import { categorySchema } from "@/lib/validation/finance";
import { useAuth } from "@/context/AuthContext";

type EditingState =
  | { mode: "personal"; row: CategoryRow }
  | { mode: "override"; source: CategoryRow }
  | null;

export default function Categorias() {
  const { user } = useAuth();
  const { data: cats, isLoading } = useCategories();
  const save = useSaveCategory();
  const del = useDeleteCategory();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EditingState>(null);

  const visible = resolveVisibleCategories(cats ?? [], user?.id ?? null);
  const globals = visible.filter((c) => c.user_id === null);
  const mine = visible.filter((c) => c.user_id === user?.id);

  return (
    <div>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Categorias</h1>
          <p className="text-sm text-muted-foreground">Padrões do sistema + suas categorias.</p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          className="btn-brand inline-flex items-center gap-2"
        >
          <Plus size={14} /> Nova
        </button>
      </header>

      {isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold">Minhas categorias</h2>
            {mine.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-xs text-muted-foreground">
                Você ainda não criou categorias pessoais.
              </div>
            ) : (
              <ul className="space-y-2">
                {mine.map((c) => (
                  <li key={c.id} className="flex items-center justify-between rounded-2xl border border-border bg-card p-3 shadow-card">
                    <div className="flex items-center gap-2">
                      <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ backgroundColor: (c.color || "#8B5CF6") + "22", color: c.color || "#8B5CF6" }}>
                        <Tag size={14} />
                      </span>
                      <div>
                        <p className="text-sm font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.type === "income" ? "Receita" : "Despesa"}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditing({ mode: "personal", row: c });
                          setOpen(true);
                        }}
                        className="rounded-full border border-border p-2 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm("Remover esta categoria? Se houver histórico, ela será arquivada.")) {
                            del.mutate(c.id, {
                              onSuccess: (r) => {
                                if (r?.archived) toast.success("Arquivada", { description: `Mantida no histórico (${r.count} lançamento${r.count === 1 ? "" : "s"}).` });
                                else toast.success("Excluída");
                              },
                              onError: (e: unknown) => toast.error("Erro", { description: String((e as Error).message) }),
                            });
                          }
                        }}
                        className="rounded-full border border-border p-2 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Padrões do sistema</h2>
            <p className="mb-2 text-[11px] text-muted-foreground">Editar cria uma cópia pessoal e só vale para você — a padrão original fica intacta.</p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {globals.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-xl border border-border bg-card p-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-md" style={{ backgroundColor: (c.color || "#8B5CF6") + "22", color: c.color || "#8B5CF6" }}>
                    <Tag size={12} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{c.name}</p>
                    <p className="text-[10px] text-muted-foreground">{c.type === "income" ? "Receita" : "Despesa"}</p>
                  </div>
                  <button
                    onClick={() => {
                      setEditing({ mode: "override", source: c });
                      setOpen(true);
                    }}
                    className="shrink-0 rounded-full border border-border p-1.5 text-muted-foreground hover:text-foreground"
                    title="Personalizar esta padrão"
                    aria-label="Personalizar esta padrão"
                  >
                    <Pencil size={12} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {open && (
        <CatModal
          initial={editing?.mode === "personal" ? editing.row : editing?.mode === "override" ? editing.source : null}
          overrideNotice={editing?.mode === "override"}
          saving={save.isPending}
          onClose={() => setOpen(false)}
          onSubmit={(v) => {
            const isOverride = editing?.mode === "override";
            const isPersonal = editing?.mode === "personal";
            save.mutate(
              {
                ...v,
                id: isPersonal ? editing.row.id : undefined,
                sourceSlug: isOverride ? (editing.source.slug ?? undefined) : undefined,
              },
              {
                onSuccess: () => {
                  toast.success(isOverride ? "Padrão personalizada" : "Salva", {
                    description: isOverride ? "A cópia pessoal foi criada e só vale para você." : undefined,
                  });
                  setOpen(false);
                },
                onError: (e: unknown) => toast.error("Erro", { description: String((e as Error).message) }),
              }
            );
          }}
        />
      )}
    </div>
  );
}

const COLORS = ["#8B5CF6", "#6D3BFF", "#FF6B4A", "#FF9F1C", "#16A37A", "#0EA5E9", "#EF4444", "#EC4899", "#EAB308"];

function CatModal({
  initial,
  saving,
  onClose,
  onSubmit,
}: {
  initial: CategoryRow | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (v: ReturnType<typeof categorySchema.parse>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<"income" | "expense">((initial?.type as "income" | "expense") ?? "expense");
  const [color, setColor] = useState(initial?.color ?? COLORS[0]);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = categorySchema.safeParse({ name, type, color });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    onSubmit(parsed.data);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="font-display text-lg font-bold">{initial ? "Editar categoria" : "Nova categoria"}</h2>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input-base" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Tipo</label>
            <select value={type} onChange={(e) => setType(e.target.value as "income" | "expense")} className="input-base">
              <option value="expense">Despesa</option>
              <option value="income">Receita</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Cor</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                  aria-label={`Cor ${c}`}
                />
              ))}
            </div>
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border bg-card px-4 py-2 text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="btn-brand inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
