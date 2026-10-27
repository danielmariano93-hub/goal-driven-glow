import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, MessageCircle, Mic, Bell, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WhatsAppLinkSheet } from "@/components/whatsapp/WhatsAppLinkSheet";

type LinkRow = { status: "pending" | "active" | "revoked"; phone_masked: string };

const BENEFITS = [
  { icon: Mic, text: "Anote gastos por texto ou áudio, sem abrir o app" },
  { icon: Bell, text: "Receba lembretes de contas e alertas do seu dinheiro" },
  { icon: Users, text: "Veja e pague divisões de rolê em que você foi incluído" },
];

async function loadActiveLink(): Promise<LinkRow | null> {
  const { data } = await supabase.rpc("list_my_whatsapp_link");
  const row = (data?.[0] as LinkRow | undefined) ?? null;
  return row?.status === "active" ? row : null;
}

/** Passo opcional do onboarding: vincula o WhatsApp enviando o código pela conversa (a prova é a mensagem, não o número digitado). */
export function OnboardingWhatsAppStep({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) {
  const [link, setLink] = useState<LinkRow | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => loadActiveLink().then((row) => { if (!cancelled) setLink(row); }).catch(() => undefined);
    refresh();
    // O vínculo se completa fora do app (mensagem no WhatsApp): confere de tempos em tempos enquanto o passo está aberto.
    const iv = setInterval(refresh, 5_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  return (
    <>
      <h1 className="font-display text-2xl font-bold tracking-tight">Conecte seu WhatsApp</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        O Nino funciona melhor na conversa. Leva menos de um minuto e você pode fazer depois.
      </p>
      <ul className="mt-5 space-y-3">
        {BENEFITS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-sm">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon size={15} /></span>
            <span className="pt-1">{text}</span>
          </li>
        ))}
      </ul>

      {link ? (
        <div role="status" className="mt-6 flex items-center gap-3 rounded-2xl border border-success/30 bg-success/10 p-3 text-sm">
          <CheckCircle2 size={18} className="text-success" />
          <div>
            <p className="font-semibold">WhatsApp conectado</p>
            <p className="text-xs text-muted-foreground">{link.phone_masked}</p>
          </div>
        </div>
      ) : (
        <>
          <button type="button" onClick={() => setOpen(true)} className="btn-brand mt-6 inline-flex w-full items-center justify-center gap-2">
            <MessageCircle size={16} /> Conectar WhatsApp
          </button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Você vai enviar uma mensagem com um código para o número do Nino. Use o mesmo número com que seus amigos te adicionaram em um rolê.
          </p>
        </>
      )}

      <div className="mt-6 flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Voltar
        </button>
        <button type="button" onClick={onContinue} className="btn-brand inline-flex items-center gap-2">
          {link ? "Continuar" : "Fazer depois"} <ArrowRight size={14} />
        </button>
      </div>

      <WhatsAppLinkSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
