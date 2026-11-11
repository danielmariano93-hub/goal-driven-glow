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
          <DrawerHeader className="text-left"><DrawerTitle className="font-display text-xl">Antes de começar</DrawerTitle></DrawerHeader>
          <div className="flex flex-col gap-3 px-4 text-sm leading-6">
            <p>Esse hábito envolve a sua saúde. Para ajudar, o Nino guarda o que você registra e pode mandar lembretes sobre ele.</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Só você vê esses registros.</li>
              <li>Eles não aparecem para outras pessoas nem em ranking.</li>
              <li>Mensagens falam do hábito de forma discreta.</li>
              <li>Você pode retirar a autorização em Mais, a qualquer momento.</li>
            </ul>
            <p className="text-xs text-muted-foreground">O Nino não substitui acompanhamento profissional. Se estiver difícil, o CVV atende 24 horas pelo 188.</p>
            <Button className="mt-1 h-12 rounded-full text-[15px] font-semibold" disabled={grant.isPending} onClick={() => void accept()}>Entendi e autorizo</Button>
            <Button variant="ghost" className="h-11 rounded-full text-muted-foreground" onClick={() => onOpenChange(false)}>Agora não</Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
