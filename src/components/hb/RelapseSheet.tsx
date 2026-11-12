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
          <DrawerHeader className="px-5 pb-1 text-left">
            <DrawerTitle className="font-display text-[22px] font-semibold leading-[1.1] tracking-[-0.025em]">Acontece. Vamos anotar.</DrawerTitle>
            <p className="pt-1 text-[14px] leading-6 text-muted-foreground">{title}: um escorregão não apaga o que você já construiu.</p>
          </DrawerHeader>
          <div className="flex flex-col gap-5 px-5 pt-2">
            <div>
              <p className="mb-3 text-[14px] font-medium">O que estava rolando? <span className="font-normal text-muted-foreground">(opcional)</span></p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="O que estava acontecendo">
                {TRIGGER_TAGS.map(([k, label]) => {
                  const on = tags.includes(k);
                  return <button key={k} type="button" aria-pressed={on} onClick={() => toggle(k)} className={cn("min-h-11 rounded-full border px-4 text-sm font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted")}>{label}</button>;
                })}
              </div>
            </div>
            <Button className="h-11 rounded-full text-base font-medium" disabled={relapse.isPending} onClick={() => void save(true)}>Recomeçar a contagem hoje</Button>
            <Button variant="outline" className="-mt-2 h-11 rounded-full text-base font-medium" disabled={relapse.isPending} onClick={() => void save(false)}>Só anotar, sem zerar</Button>
            <p className="pb-1 text-center text-[12px] text-muted-foreground">Seu recorde e o total de dias sem continuam guardados.</p>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
