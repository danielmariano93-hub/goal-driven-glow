import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste, History } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { parseContactsText, type ParsedContact } from "@/lib/split/parseContacts";
import { normalizeBrPhone } from "@/lib/phone";

type Props = {
  /** Telefones já no rolê (qualquer formato). */
  existingPhones: string[];
  onAdd: (rows: ParsedContact[]) => void;
};

/**
 * Atalhos para montar o rolê sem digitar número a número, em qualquer aparelho:
 *  • pessoas de rolês anteriores (um toque);
 *  • colar vários contatos de uma vez (lista do WhatsApp, notas, mensagem).
 * Não lê a agenda do aparelho (o iPhone não permite isso em site/app instalado pelo Safari).
 */
export function QuickAddPeople({ existingPhones, onAdd }: Props) {
  const [past, setPast] = useState<ParsedContact[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from("shared_expense_participants" as never)
        .select("name,phone_e164,updated_at" as never)
        .not("phone_e164" as never, "is", null)
        .order("updated_at" as never, { ascending: false })
        .limit(300);
      if (!alive) return;
      const seen = new Set<string>();
      const rows: ParsedContact[] = [];
      for (const r of ((data ?? []) as Array<{ name: string | null; phone_e164: string | null }>)) {
        const phone = r.phone_e164 ? normalizeBrPhone(r.phone_e164) : null;
        if (!phone || seen.has(phone)) continue;
        seen.add(phone);
        rows.push({ name: String(r.name ?? "").trim(), phone_e164: phone });
      }
      setPast(rows);
    })().catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const have = useMemo(() => new Set(existingPhones.map((p) => normalizeBrPhone(p)).filter(Boolean) as string[]), [existingPhones]);
  const suggestions = past.filter((p) => !have.has(p.phone_e164)).slice(0, 12);

  const submitPaste = () => {
    const { contacts, ignored } = parseContactsText(text);
    const fresh = contacts.filter((c) => !have.has(c.phone_e164));
    if (fresh.length === 0) {
      toast.error(contacts.length ? "Todos esses números já estão no rolê." : "Não encontrei telefone válido no texto (use DDD + número).");
      return;
    }
    onAdd(fresh);
    toast.success(`${fresh.length} pessoa${fresh.length === 1 ? "" : "s"} adicionada${fresh.length === 1 ? "" : "s"}.`, {
      description: ignored ? `${ignored} linha${ignored === 1 ? "" : "s"} sem telefone válido foi${ignored === 1 ? "" : "ram"} ignorada${ignored === 1 ? "" : "s"}.` : undefined,
    });
    setText(""); setPasteOpen(false);
  };

  return (
    <div className="w-full space-y-2">
      {suggestions.length > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><History size={11} /> De rolês anteriores</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((p) => (
              <button key={p.phone_e164} type="button" onClick={() => onAdd([p])}
                className="min-h-9 rounded-full border border-border bg-background px-3 text-xs font-medium active:bg-secondary">
                + {p.name || p.phone_e164.slice(-4)}
              </button>
            ))}
          </div>
        </div>
      )}
      <button type="button" onClick={() => setPasteOpen((v) => !v)} aria-expanded={pasteOpen}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-medium">
        <ClipboardPaste size={12} /> Colar vários números
      </button>
      {pasteOpen && (
        <div className="rounded-xl bg-secondary/40 p-3">
          <label className="block text-[11px] text-muted-foreground" htmlFor="paste-contacts">Um por linha, com o nome antes: “Roger 11 98426-5698”.</label>
          <textarea id="paste-contacts" value={text} onChange={(e) => setText(e.target.value)} rows={5}
            className="input-base mt-1 min-h-24 w-full" placeholder={"Roger 11 98426-5698\nLucas 11 97707-9909"} />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={submitPaste} className="min-h-10 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground">Adicionar ao rolê</button>
            <button type="button" onClick={() => { setPasteOpen(false); setText(""); }} className="min-h-10 px-3 text-xs text-muted-foreground">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
