import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { hbErrorMessage, useClearAutoRule, useExpenseCategories, useRuleAgreement, useSetAutoRule, type HabitView, type HbSnapshot } from "@/lib/habits/api";

type Rule = NonNullable<HbSnapshot["auto_rules"]>[number];

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** "Medido pelo Nino": o dia conta como cumprido pelos seus lançamentos (ex.: nenhum gasto em Delivery). Sua marcação sempre vale mais. */
export function MeasureCard({ view, rule }: { view: HabitView; rule: Rule | null }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<Rule["rule_type"]>(rule?.rule_type ?? "no_spend_category");
  const [category, setCategory] = useState(rule?.category_id ?? "");
  const [limit, setLimit] = useState(rule?.limit_amount != null ? String(rule.limit_amount) : "");
  const categories = useExpenseCategories(open || !!rule);
  const agreement = useRuleAgreement(!!rule);
  const setRule = useSetAutoRule();
  const clear = useClearAutoRule();
  const name = (categories.data ?? []).find((c) => c.id === rule?.category_id)?.name ?? "a categoria";
  const ag = agreement.data?.[view.habit.id];
  const limitNum = Number(limit.replace(",", "."));
  const invalid = !category || (type === "spend_under_limit" && !(limitNum >= 0 && limit.trim() !== ""));

  const save = async () => {
    try {
      await setRule.mutateAsync({ habit_id: view.habit.id, rule_type: type, category_id: category, limit_amount: type === "spend_under_limit" ? limitNum : null });
      toast.success("Pronto. O Nino passa a medir este hábito pelos seus lançamentos.");
      setOpen(false);
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };
  const remove = async () => {
    try {
      await clear.mutateAsync(view.habit.id);
      toast.success("Medição automática desligada");
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };
  const chip = (on: boolean) => cn("min-h-11 flex-1 rounded-full border px-3 text-sm font-semibold", on ? "border-foreground bg-foreground text-background" : "border-border bg-card");

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Medido pelo Nino">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-muted-foreground">Medido pelo Nino</h2>
        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">pelos seus lançamentos</span>
      </div>
      {rule ? (
        <>
          <p className="mt-2 text-[15px] leading-6">
            {rule.rule_type === "no_spend_category" ? `O dia conta como feito se você não gastar nada em ${name}.` : `O dia conta como feito se você gastar até ${brl(rule.limit_amount ?? 0)} em ${name}.`}
          </p>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            Dias já fechados entram sozinhos. Se você marcar um dia, a sua marcação vale.
            {ag && ag.days >= 5 ? ` Em ${ag.days} dias que você também marcou, a regra concordou em ${Math.round((ag.agree / ag.days) * 100)}%.` : ""}
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" className="h-11 flex-1 rounded-full" onClick={() => setOpen(true)}>Ajustar</Button>
            <Button variant="ghost" className="h-11 flex-1 rounded-full text-muted-foreground" disabled={clear.isPending} onClick={() => void remove()}>Desligar</Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">Se este hábito é sobre gasto (por exemplo, não pedir delivery), o Nino pode marcar os dias por você a partir dos seus lançamentos.</p>
          <Button variant="outline" className="mt-3 h-11 w-full rounded-full font-semibold" onClick={() => setOpen(true)}>Medir pelo Nino</Button>
        </>
      )}

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <div className="mx-auto w-full max-w-md pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <DrawerHeader className="text-left"><DrawerTitle className="font-display text-[22px] font-semibold tracking-[-0.02em]">Como medir</DrawerTitle></DrawerHeader>
            <div className="flex flex-col gap-4 px-4">
              <div className="flex gap-2" role="group" aria-label="Regra">
                <button type="button" aria-pressed={type === "no_spend_category"} className={chip(type === "no_spend_category")} onClick={() => setType("no_spend_category")}>Nenhum gasto</button>
                <button type="button" aria-pressed={type === "spend_under_limit"} className={chip(type === "spend_under_limit")} onClick={() => setType("spend_under_limit")}>Até um valor</button>
              </div>
              <select aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)} className="h-12 w-full rounded-2xl border border-input bg-background px-3 text-sm">
                <option value="">Escolha a categoria</option>
                {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {type === "spend_under_limit" ? <Input aria-label="Valor máximo por dia" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Máximo por dia, em reais" className="h-12 rounded-2xl" /> : null}
              <Button className="h-12 rounded-full text-[15px] font-medium" disabled={invalid || setRule.isPending} onClick={() => void save()}>Salvar</Button>
              <p className="text-center text-xs text-muted-foreground">Conta só gasto confirmado (sem transferências nem pagamento de fatura).</p>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </section>
  );
}
