import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { parseMoney } from "@/lib/mapa/questions";
import { useAddBenefitEntry, useEditBenefitEntry, type BenefitEntryRow } from "@/lib/db/benefitWallet";
import type { BenefitKind } from "@/lib/engine/benefitWallet";

type Mode = "reading" | "spend" | "credit";

const TABS: Array<{ id: Mode; label: string }> = [
  { id: "reading", label: "Saldo agora" },
  { id: "spend", label: "Gastei" },
  { id: "credit", label: "Entrou crédito" },
];
const KIND: Record<Mode, BenefitKind> = { reading: "balance_reading", spend: "spend", credit: "credit" };
const QUESTION: Record<Mode, string> = {
  reading: "Quanto tem no Ticket agora?",
  spend: "Quanto você gastou?",
  credit: "Qual foi o valor do crédito?",
};

const MODE_OF: Partial<Record<BenefitKind, Mode>> = { balance_reading: "reading", spend: "spend", credit: "credit" };
/** Só estes tipos podem ser corrigidos na tela (o ajuste é um acerto do próprio cálculo). */
export const isEditableBenefitEntry = (e: { kind: BenefitKind }) => e.kind in MODE_OF;

/**
 * Registro rápido: um campo para o saldo, valor + lugar para o gasto, valor para o crédito.
 * Com `entry`, vira a correção desse lançamento (valor, dia e lugar; o tipo não muda).
 */
export function EntrySheet({ open, onOpenChange, walletId, today, entry = null }: { open: boolean; onOpenChange: (v: boolean) => void; walletId: string; today: string; entry?: BenefitEntryRow | null }) {
  const [mode, setMode] = useState<Mode>("reading");
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState(today);
  const add = useAddBenefitEntry();
  const edit = useEditBenefitEntry(walletId);
  const editing = !!entry;

  useEffect(() => {
    if (!open) return;
    if (entry) {
      setMode(MODE_OF[entry.kind] ?? "spend");
      setAmount(entry.amount.toFixed(2).replace(".", ","));
      setMerchant(entry.merchant ?? "");
      setDate(entry.occurred_on);
    } else {
      setMode("reading"); setAmount(""); setMerchant(""); setDate(today);
    }
  }, [open, entry, today]);

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const value = parseMoney(amount);
    if (value === null || value <= 0) return void toast.error("Informe um valor maior que zero.");
    if (date > today) return void toast.error("A data não pode ser no futuro.");
    if (entry) {
      edit.mutate(
        { original: entry, amount: value, occurred_on: date, merchant: mode === "spend" ? merchant : null },
        {
          onSuccess: () => { toast.success("Lançamento corrigido"); onOpenChange(false); },
          onError: (err) => toast.error(err instanceof Error && err.message === "edit_old_not_removed"
            ? "Salvei a correção, mas não consegui remover o lançamento antigo. Exclua o antigo na lista."
            : "Não consegui salvar agora. Tente de novo."),
        },
      );
      return;
    }
    add.mutate(
      { wallet_id: walletId, kind: KIND[mode], amount: value, occurred_on: date, merchant: mode === "spend" ? merchant : null },
      {
        onSuccess: () => {
          toast.success(mode === "reading" ? "Saldo atualizado" : mode === "spend" ? "Gasto registrado" : "Crédito registrado");
          setAmount(""); setMerchant(""); setDate(today); onOpenChange(false);
        },
        onError: () => toast.error("Não consegui salvar agora. Tente de novo."),
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader className="text-left">
          <SheetTitle>{editing ? "Corrigir lançamento" : "Registrar no Ticket"}</SheetTitle>
          <SheetDescription>{editing ? "Ajuste o valor, o dia ou o lugar. O Nino recalcula o ritmo na hora." : "Só o essencial. O Nino recalcula o ritmo e a data em que o saldo acaba."}</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          {!editing && <div role="tablist" className="flex gap-1.5 rounded-2xl bg-muted p-1">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={mode === t.id} onClick={() => setMode(t.id)}
                className={`min-h-11 flex-1 rounded-xl text-sm font-semibold transition-colors ${mode === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                {t.label}
              </button>
            ))}
          </div>}
          <div className="flex flex-col gap-2">
            <label htmlFor="ticket-amount" className="text-sm font-semibold">{QUESTION[mode]}</label>
            <div className="flex items-center gap-2 rounded-2xl border-2 border-primary bg-card px-4 py-3">
              <span className="text-xl font-semibold text-muted-foreground">R$</span>
              <input id="ticket-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00"
                className="min-w-0 flex-1 bg-transparent text-3xl font-bold outline-none" />
            </div>
          </div>
          {mode === "spend" && (
            <div className="flex flex-col gap-2">
              <label htmlFor="ticket-merchant" className="text-sm font-semibold">Onde? (opcional)</label>
              <input id="ticket-merchant" value={merchant} maxLength={80} onChange={(e) => setMerchant(e.target.value)} placeholder="Mercado, restaurante, iFood..."
                className="min-h-11 rounded-xl border border-border bg-card px-3 text-sm" />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <label htmlFor="ticket-date" className="text-sm font-semibold">Quando</label>
            <input id="ticket-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="min-h-11 rounded-xl border border-border bg-card px-3 text-sm" />
          </div>
          <button type="submit" disabled={add.isPending || edit.isPending} className="btn-brand min-h-12 disabled:opacity-60">
            {add.isPending || edit.isPending ? "Salvando..." : editing ? "Salvar correção" : mode === "reading" ? "Salvar saldo" : mode === "spend" ? "Salvar gasto" : "Salvar crédito"}
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
