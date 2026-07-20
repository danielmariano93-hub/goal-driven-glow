import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useAllCategories, useSaveCategory, type CategoryRow } from "@/lib/db/finance";

/**
 * Filtra categorias para o seletor: ativas + globais do tipo pedido, mais a
 * arquivada correspondente ao valor atual (para não perder rótulo em edição de
 * lançamentos históricos).
 */
export function filterCategoryOptions(all: CategoryRow[], type: "expense" | "income", selectedId: string | null) {
  const active = all.filter(
    (c) => c.archived_at == null && (c.type === type || (c.type as string) === "both")
  );
  const selectedArchived = selectedId && !active.some((c) => c.id === selectedId)
    ? all.find((c) => c.id === selectedId) ?? null
    : null;
  return { active, selectedArchived };
}


const CREATE_TOKEN = "__create__";

type Props = {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  type: "expense" | "income";
  disabled?: boolean;
  className?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  id?: string;
  showManageLink?: boolean;
};

/**
 * Seletor unificado de categoria: mostra globais + pessoais ativas filtradas por
 * tipo, permite criar nova inline (arquivadas ficam preservadas em históricos
 * porém somem de novos selects) e expõe atalho para gerenciar categorias.
 */
export function CategorySelect({
  value,
  onChange,
  type,
  disabled,
  className,
  allowEmpty = true,
  emptyLabel = "Sem categoria",
  id,
  showManageLink = true,
}: Props) {
  const { data: all = [], isLoading } = useAllCategories();
  const [creating, setCreating] = useState(false);

  const options = useMemo(() => filterCategoryOptions(all, type, value ?? null), [all, type, value]);

  const handleChange = (val: string) => {
    if (val === CREATE_TOKEN) {
      setCreating(true);
      return;
    }
    onChange(val || null);
  };

  return (
    <>
      <div className="flex min-w-0 max-w-full items-center gap-2">
        <select
          id={id}
          value={value ?? ""}
          onChange={(e) => handleChange(e.target.value)}
          disabled={disabled || isLoading}
          className={`${className ?? "input-base"} min-w-0 max-w-full`}
          aria-label="Categoria"
        >
          {allowEmpty && <option value="">{emptyLabel}</option>}
          {options.selectedArchived && (
            <option value={options.selectedArchived.id}>
              {options.selectedArchived.name} (arquivada)
            </option>
          )}
          {options.active.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.user_id === null ? "" : " ·"}
            </option>
          ))}
          <option value={CREATE_TOKEN}>+ Criar nova categoria…</option>
        </select>
        {showManageLink && (
          <Link
            to="/app/categorias"
            title="Gerenciar categorias"
            aria-label="Gerenciar categorias"
            className="shrink-0 rounded-full border border-border p-2 text-muted-foreground hover:text-foreground"
          >
            <Settings2 size={14} />
          </Link>
        )}
      </div>

      {creating && (
        <QuickCreateCategoryModal
          initialType={type}
          onClose={() => setCreating(false)}
          onCreated={(cat) => {
            setCreating(false);
            onChange(cat.id);
          }}
        />
      )}
    </>
  );
}

const COLORS = ["#8B5CF6", "#6D3BFF", "#FF6B4A", "#FF9F1C", "#16A37A", "#0EA5E9", "#EF4444", "#EC4899", "#EAB308"];

function QuickCreateCategoryModal({
  initialType,
  onClose,
  onCreated,
}: {
  initialType: "expense" | "income";
  onClose: () => void;
  onCreated: (cat: CategoryRow) => void;
}) {
  const save = useSaveCategory();
  const [name, setName] = useState("");
  const [type, setType] = useState<"expense" | "income">(initialType);
  const [color, setColor] = useState(COLORS[0]);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("Dê um nome com pelo menos 2 letras.");
      return;
    }
    save.mutate(
      { name: trimmed, type, color },
      {
        onSuccess: (row) => {
          toast.success("Categoria criada");
          onCreated(row);
        },
        onError: (e: unknown) => setError((e as Error).message ?? "Erro ao criar"),
      }
    );
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-card"
      >
        <h3 className="font-display text-base font-bold">Nova categoria</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Fica disponível em todos os lançamentos.</p>
        <div className="mt-3 space-y-3">
          <input
            autoFocus
            placeholder="Ex.: Cafezinho, Pet, Cursos…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-base"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setType("expense")}
              className={`rounded-xl border px-3 py-1.5 text-xs ${type === "expense" ? "border-destructive bg-destructive/10 text-destructive" : "border-border"}`}
            >
              Despesa
            </button>
            <button
              type="button"
              onClick={() => setType("income")}
              className={`rounded-xl border px-3 py-1.5 text-xs ${type === "income" ? "border-success bg-success/10 text-success" : "border-border"}`}
            >
              Receita
            </button>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Cor</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                  aria-label={`Cor ${c}`}
                />
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-border px-3 py-1.5 text-xs">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={save.isPending}
            className="btn-brand inline-flex items-center gap-1.5 !py-1.5 !text-xs"
          >
            {save.isPending ? <Loader2 size={12} className="animate-spin" /> : "Criar e usar"}
          </button>
        </div>
      </form>
    </div>
  );
}
