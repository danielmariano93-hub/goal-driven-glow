import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useImportBenefitEntries, useReadBenefitStatement, type BenefitEntryRow } from "@/lib/db/benefitWallet";
import { markKnownEntries, type BenefitStatementCandidate } from "@/lib/engine/benefitStatement";

const brl2 = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Reduz o print antes de enviar: leitura mais rápida e barata, sem perder o texto. */
async function toDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Importar do extrato: o Nino lê o print, mostra o que achou e só lança o que você marcar. */
export function StatementImportSheet({ open, onOpenChange, walletId, entries }: {
  open: boolean; onOpenChange: (v: boolean) => void; walletId: string; entries: BenefitEntryRow[];
}) {
  const input = useRef<HTMLInputElement>(null);
  const read = useReadBenefitStatement();
  const save = useImportBenefitEntries(walletId);
  const [found, setFound] = useState<BenefitStatementCandidate[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const reset = () => { setFound(null); setPicked(new Set()); };

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const out = await read.mutateAsync(await toDataUrl(file));
      if (!out.recognized || !out.items.length) { toast.error("Não reconheci um extrato de Ticket nessa imagem."); return; }
      const marked = markKnownEntries(out.items, entries);
      setFound(marked);
      setPicked(new Set(marked.map((c, i) => (c.already_recorded ? -1 : i)).filter((i) => i >= 0)));
    } catch {
      toast.error("Não consegui ler esse print agora. Tente de novo em instantes.");
    }
  };

  const confirm = () => {
    if (!found) return;
    const chosen = found.filter((_, i) => picked.has(i));
    save.mutate(chosen, {
      onSuccess: () => { toast.success(`${chosen.length} ${chosen.length === 1 ? "lançamento importado" : "lançamentos importados"}`); reset(); onOpenChange(false); },
      onError: () => toast.error("Não consegui salvar agora. Tente de novo."),
    });
  };

  const newCount = found?.filter((c) => !c.already_recorded).length ?? 0;
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-3xl">
        <SheetHeader className="text-left">
          <SheetTitle>Importar do extrato</SheetTitle>
          <SheetDescription>Envie um print do extrato do cartão. Eu mostro o que li e você confirma antes de lançar.</SheetDescription>
        </SheetHeader>
        <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        {!found ? (
          <button type="button" onClick={() => input.current?.click()} disabled={read.isPending}
            className="btn-brand mt-4 flex min-h-12 w-full items-center justify-center gap-2">
            {read.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Lendo o extrato…</> : <><Camera size={18} /> Escolher o print</>}
          </button>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Achei {found.length} {found.length === 1 ? "linha" : "linhas"}; {newCount} {newCount === 1 ? "é nova" : "são novas"}. Confira os valores contra o app do ticket.</p>
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
              {found.map((c, i) => (
                <li key={`${c.occurred_on}-${c.time}-${c.amount}-${i}`}>
                  <label className={`flex min-h-12 items-center gap-3 px-3 py-2 ${c.already_recorded ? "opacity-50" : ""}`}>
                    <input type="checkbox" className="h-5 w-5" disabled={c.already_recorded} checked={picked.has(i)}
                      onChange={(e) => setPicked((prev) => { const next = new Set(prev); if (e.target.checked) next.add(i); else next.delete(i); return next; })} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{c.kind === "credit" ? "Crédito recebido" : (c.merchant ?? "Sem nome")}</span>
                      <span className="block text-xs text-muted-foreground">{dm(c.occurred_on)}{c.time ? ` · ${c.time}` : ""}{c.already_recorded ? " · já lançado" : ""}</span>
                    </span>
                    <span className={`text-sm font-bold ${c.kind === "credit" ? "text-success" : ""}`}>{c.kind === "credit" ? "+" : ""}{brl2(c.amount)}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button type="button" onClick={reset} className="min-h-12 flex-1 rounded-xl border border-border text-sm font-semibold">Outro print</button>
              <button type="button" onClick={confirm} disabled={!picked.size || save.isPending} className="btn-brand min-h-12 flex-1">
                {save.isPending ? "Salvando…" : `Lançar ${picked.size}`}
              </button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
