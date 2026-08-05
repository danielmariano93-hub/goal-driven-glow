import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function RhythmMethodSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[82dvh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Como calculamos o ritmo</SheetTitle>
          <SheetDescription>Uma leitura comparável do consumo, sem transformar projeção em certeza.</SheetDescription>
        </SheetHeader>
        <dl className="mt-5 space-y-5 text-sm">
          <div><dt className="font-bold text-foreground">Ritmo atual</dt><dd className="mt-1 leading-relaxed text-muted-foreground">Gasto líquido realizado dividido por todos os dias corridos do período, inclusive dias sem gasto.</dd></div>
          <div><dt className="font-bold text-foreground">Ritmo típico</dt><dd className="mt-1 leading-relaxed text-muted-foreground">Referência dos últimos 90 dias, sem despesas estruturais, recorrentes e valores atípicos quando há amostra suficiente.</dd></div>
          <div><dt className="font-bold text-foreground">Período anterior</dt><dd className="mt-1 leading-relaxed text-muted-foreground">Usa os mesmos dias do mês anterior ou uma janela imediatamente anterior com a mesma duração.</dd></div>
        </dl>
      </SheetContent>
    </Sheet>
  );
}