import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { addDays } from "@/lib/habits/engine";

/** Escolhe um dia anterior (até 90 dias) para registrar o que já foi feito antes de criar o hábito no app. */
export function BackfillSheet({ today, weekly = false, open, onOpenChange, onPick }: { today: string; weekly?: boolean; open: boolean; onOpenChange: (o: boolean) => void; onPick: (date: string) => void }) {
  const [date, setDate] = useState(addDays(today, -1));
  const ok = date >= addDays(today, -90) && date <= today;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-md pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-display text-[18px] font-semibold tracking-[-0.02em]">Registrar um dia anterior</DrawerTitle>
            <DrawerDescription>Já fazia isso antes de usar o app? Escolha o dia (até 90 dias atrás). O hábito passa a contar desde o primeiro dia que você registrar.</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-3 px-4">
            <input type="date" value={date} min={addDays(today, -90)} max={today} onChange={(e) => setDate(e.target.value)} aria-label="Dia" className="h-11 rounded-2xl border border-border/70 bg-card px-4" />
            <p className="text-[12px] leading-[17px] text-muted-foreground">{weekly ? "As semanas passam a contar desde essa data. Registre cada dia em que você fez, e a meta da semana é conferida pelo total." : "Os dias entre o primeiro registro e hoje que ficarem sem registro contam como \"não fiz\". Registre os que você lembra."}</p>
            <Button className="h-11 rounded-full text-[14px] font-medium" disabled={!ok} onClick={() => { onOpenChange(false); onPick(date); }}>Continuar</Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
