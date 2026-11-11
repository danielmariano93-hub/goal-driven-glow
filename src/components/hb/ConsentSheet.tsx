import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { hbErrorMessage, useGrantConsent } from "@/lib/habits/api";

/** Autorização específica para hábitos de saúde e substâncias. Só o próprio usuário e o Nino veem; nada vai para ranking ou para terceiros. */
export function ConsentSheet({ open, onOpenChange, onGranted }: { open: boolean; onOpenChange: (o: boolean) => void; onGranted: () => void }) {
  const grant = useGrantConsent();
  const accept = async () => {
    try {
      await grant.mutateAsync();
      onGranted();
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-md pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <DrawerHeader className="px-5 pb-1 text-left"><DrawerTitle className="font-display text-[26px] font-semibold leading-[1.1] tracking-[-0.025em]">Antes de começar</DrawerTitle></DrawerHeader>
          <div className="flex flex-col gap-4 px-5 pt-2 text-[15px] leading-6">
            <p>Esse hábito envolve a sua saúde. Para ajudar, o Nino guarda o que você registra e pode mandar lembretes sobre ele.</p>
            <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground marker:text-primary/60">
              <li>Só você vê esses registros.</li>
              <li>Eles não aparecem para outras pessoas nem em ranking.</li>
              <li>Mensagens falam do hábito de forma discreta.</li>
              <li>Você pode retirar a autorização em Mais, a qualquer momento.</li>
            </ul>
            <p className="rounded-2xl bg-primary/5 p-4 text-[13px] leading-5 text-muted-foreground">O Nino não substitui acompanhamento profissional. Se estiver difícil, o CVV atende 24 horas pelo 188.</p>
            <Button className="mt-1 h-14 rounded-full text-base font-medium" disabled={grant.isPending} onClick={() => void accept()}>Entendi e autorizo</Button>
            <Button variant="ghost" className="-mt-2 h-12 rounded-full text-muted-foreground" onClick={() => onOpenChange(false)}>Agora não</Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
