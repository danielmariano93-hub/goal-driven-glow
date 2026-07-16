import { useEffect, useState } from "react";
import { Loader2, MessageCircle, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { copy } from "@/lib/copy/strings";

const OFFICIAL_NUMBER =
  (import.meta.env.VITE_WHATSAPP_OFFICIAL_NUMBER as string | undefined) ?? "";

type LinkRow = {
  status: "pending" | "active" | "revoked";
  phone_masked: string;
};

export function WhatsAppLinkSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<LinkRow | null>(null);
  const [consent, setConsent] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    supabase.rpc("list_my_whatsapp_link").then(({ data }) => {
      const row = (data?.[0] as LinkRow | undefined) ?? null;
      setLink(row?.status === "active" ? row : null);
      setLoading(false);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const generateAndOpen = async () => {
    if (!consent) return toast.error("Confirme o consentimento primeiro.");
    if (!OFFICIAL_NUMBER) {
      toast.error("O número oficial ainda está em configuração.");
      return;
    }
    setGenerating(true);
    const { data, error } = await supabase.rpc("create_phone_link_code");
    setGenerating(false);
    if (error) {
      toast.error(
        error.message?.includes("too many")
          ? "Muitas tentativas. Tente novamente em alguns minutos."
          : "Não consegui gerar o código."
      );
      return;
    }
    const url = `https://wa.me/${OFFICIAL_NUMBER.replace(/\D/g, "")}?text=${encodeURIComponent(
      "VINCULAR " + String(data)
    )}`;
    window.open(url, "_blank", "noopener,noreferrer");
    onClose();
  };

  const openConversation = () => {
    if (!OFFICIAL_NUMBER) return toast.error("Número oficial ainda em configuração.");
    window.open(`https://wa.me/${OFFICIAL_NUMBER.replace(/\D/g, "")}`, "_blank", "noopener,noreferrer");
    onClose();
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={copy.whatsapp.linkSheet.title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm md:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl bg-card p-6 shadow-2xl md:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-success/10 text-success">
              <MessageCircle size={16} />
            </div>
            <h2 className="font-display text-base font-bold">{copy.whatsapp.linkSheet.title}</h2>
          </div>
          <button aria-label={copy.common.close} onClick={onClose} className="p-1.5 text-muted-foreground">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="grid place-items-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : link ? (
          <>
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3">
              <ShieldCheck size={16} className="text-success" />
              <div className="text-xs">
                <p className="font-medium">Vinculado</p>
                <p className="text-muted-foreground">{link.phone_masked}</p>
              </div>
            </div>
            <button
              onClick={openConversation}
              className="mt-4 w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              {copy.whatsapp.linkSheet.alreadyLinked}
            </button>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              {copy.whatsapp.linkSheet.manageIn}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{copy.whatsapp.linkSheet.body}</p>
            <p className="mt-2 text-xs text-muted-foreground">{copy.whatsapp.linkSheet.privacy}</p>
            <label className="mt-4 flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5"
                autoFocus
              />
              <span>{copy.whatsapp.linkSheet.consent}</span>
            </label>
            <button
              disabled={!consent || generating}
              onClick={generateAndOpen}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle size={14} />}
              {copy.whatsapp.linkSheet.generate}
            </button>
            {!OFFICIAL_NUMBER && (
              <p className="mt-3 rounded-lg bg-muted p-2 text-[11px] text-muted-foreground">
                O número oficial ainda está em configuração.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
