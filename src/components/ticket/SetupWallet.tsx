import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { parseMoney } from "@/lib/mapa/questions";
import { useCreateBenefitWallet } from "@/lib/db/benefitWallet";

/** Primeira vez: valor e data do crédito, se a sobra acumula, e o saldo de hoje (a âncora do cálculo). */
export function SetupWallet({ today }: { today: string }) {
  const [credit, setCredit] = useState("");
  const [day, setDay] = useState("");
  const [carries, setCarries] = useState(true);
  const [balance, setBalance] = useState("");
  const create = useCreateBenefitWallet();

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const monthly = parseMoney(credit);
    const initial = parseMoney(balance);
    const d = Number(day);
    if (monthly === null || monthly <= 0) return void toast.error("Informe o valor do crédito mensal.");
    if (!Number.isInteger(d) || d < 1 || d > 31) return void toast.error("O dia do crédito deve estar entre 1 e 31.");
    if (initial === null) return void toast.error("Informe quanto tem no Ticket hoje.");
    create.mutate(
      { monthly_credit: monthly, credit_day: d, carries_over: carries, initial_balance: initial, today },
      { onError: () => toast.error("Não consegui criar agora. Tente de novo.") },
    );
  };

  const field = "min-h-11 rounded-xl border border-border bg-card px-3 text-sm";
  return (
    <form onSubmit={submit} className="surface-card flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-lg font-bold">Vamos configurar o seu Ticket</h2>
        <p className="mt-1 text-sm text-muted-foreground">Este saldo fica separado do seu caixa livre, da renda e do patrimônio. Só alimenta esta tela.</p>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">Valor do crédito mensal
        <input inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="900,00" className={field} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">Dia em que o crédito cai
        <input inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))} placeholder="5" className={field} />
      </label>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-3">
        <div className="text-sm"><strong className="font-semibold">A sobra acumula</strong><div className="text-muted-foreground">O que não gastar passa para o mês seguinte.</div></div>
        <Switch checked={carries} onCheckedChange={setCarries} aria-label="A sobra acumula para o mês seguinte" />
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">Quanto tem no Ticket hoje
        <input inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="412,40" className={field} />
      </label>
      <button type="submit" disabled={create.isPending} className="btn-brand min-h-12 disabled:opacity-60">{create.isPending ? "Criando..." : "Começar"}</button>
    </form>
  );
}
