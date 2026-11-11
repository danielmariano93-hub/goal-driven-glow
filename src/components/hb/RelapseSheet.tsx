import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { hbErrorMessage, useRelapse } from "@/lib/habits/api";

const TRIGGER_TAGS: Array<[string, string]> = [["stress", "Estresse"], ["tedio", "Tédio"], ["social", "Com outras pessoas"], ["cansaco", "Cansaço"], ["rotina", "Hábito de sempre"], ["outro", "Outro"]];

/** Recaída sem culpa: o recorde e o total ficam; a pessoa escolhe recomeçar a contagem ou só anotar. */
export function RelapseSheet({ habitId, title, open, onOpenChange, onDone }: { habitId: string; title: string; open: boolean; onOpenChange: (o: boolean) => void; onDone?: (reset: boolean) => void }) {
  const relapse = useRelapse();
  const [tags, setTags] = useState<string[]>([]);
  const toggle = (t: string) => setTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  const save = async (reset: boolean) => {
    try {
      await relapse.mutateAsync({ habit_id: habitId, reset, tags });
      toast.success(reset ? "Contagem recomeçada. O seu recorde continua guardado." : "Anotado. A contagem continua.");
      setTags([]);
      onOpenChange(false);
      onDone?.(reset);
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-md pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-display text-[22px] font-semibold tracking-[-0.02em]">Acontece. Vamos anotar.</DrawerTitle>
            <p className="text-sm text-muted-foreground">{title}: um escorregão não apaga o que você já construiu.</p>
          </DrawerHeader>
          <div className="flex flex-col gap-4 px-4">
            <div>
              <p className="mb-2 text-sm font-medium">O que estava rolando? (opcional)</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="O que estava acontecendo">
                {TRIGGER_TAGS.map(([k, label]) => {
                  const on = tags.includes(k);
                  return <button key={k} type="button" aria-pressed={on} onClick={() => toggle(k)} className={cn("min-h-11 rounded-full border px-4 text-sm font-semibold", on ? "border-foreground bg-foreground text-background" : "border-border bg-card")}>{label}</button>;
                })}
              </div>
            </div>
            <Button className="h-12 rounded-full text-[15px] font-medium" disabled={relapse.isPending} onClick={() => void save(true)}>Recomeçar a contagem hoje</Button>
            <Button variant="outline" className="h-12 rounded-full text-[15px] font-medium" disabled={relapse.isPending} onClick={() => void save(false)}>Só anotar, sem zerar</Button>
            <p className="text-center text-xs text-muted-foreground">Seu recorde e o total de dias sem continuam guardados.</p>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
