import { useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { parseMoney } from "@/lib/mapa/questions";
import { useAddBenefitEntry } from "@/lib/db/benefitWallet";
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

/** Registro rápido: um campo para o saldo, valor + lugar para o gasto, valor para o crédito. */
export function EntrySheet({ open, onOpenChange, walletId, today }: { open: boolean; onOpenChange: (v: boolean) => void; walletId: string; today: string }) {
  const [mode, setMode] = useState<Mode>("reading");
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState(today);
  const add = useAddBenefitEntry();

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const value = parseMoney(amount);
    if (value === null || value <= 0) return void toast.error("Informe um valor maior que zero.");
    if (date > today) return void toast.error("A data não pode ser no futuro.");
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
          <SheetTitle>Registrar no Ticket</SheetTitle>
          <SheetDescription>Só o essencial. O Nino recalcula o ritmo e a data em que o saldo acaba.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <div role="tablist" className="flex gap-1.5 rounded-2xl bg-muted p-1">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={mode === t.id} onClick={() => setMode(t.id)}
                className={`min-h-11 flex-1 rounded-xl text-sm font-semibold transition-colors ${mode === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                {t.label}
              </button>
            ))}
          </div>
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
          <button type="submit" disabled={add.isPending} className="btn-brand min-h-12 disabled:opacity-60">
            {add.isPending ? "Salvando..." : mode === "reading" ? "Salvar saldo" : mode === "spend" ? "Salvar gasto" : "Salvar crédito"}
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
