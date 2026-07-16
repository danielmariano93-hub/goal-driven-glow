import { useEffect, useState } from "react";
import { Copy, ExternalLink, Loader2, MessageCircle, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { copy } from "@/lib/copy/strings";
import { normalizeBrPhone } from "@/lib/phone";

const OFFICIAL_NUMBER_ENV =
  (import.meta.env.VITE_WHATSAPP_OFFICIAL_NUMBER as string | undefined) ?? "";

type LinkRow = {
  status: "pending" | "active" | "revoked";
  phone_masked: string;
};

type OfficialResolution =
  | { state: "resolving" }
  | { state: "available"; number: string }
  | { state: "unavailable" };

async function resolveOfficialNumber(): Promise<OfficialResolution> {
  // 1) Server-side (WAHA getMe / cache)
  try {
    const { data, error } = await supabase.functions.invoke<{
      available: boolean;
      official_number: string | null;
    }>("whatsapp-official-number", { method: "GET" as any });
    if (!error && data?.available && data.official_number) {
      const n = normalizeBrPhone(data.official_number);
      if (n) return { state: "available", number: n };
    }
  } catch {
    // fallthrough
  }
  // 2) Sanitized public config
  try {
    const { data } = await supabase
      .from("platform_public_config")
      .select("value")
      .eq("key", "official_whatsapp_number")
      .maybeSingle();
    const raw = (data as { value?: string } | null)?.value;
    const n = raw ? normalizeBrPhone(raw) : null;
    if (n) return { state: "available", number: n };
  } catch {
    // fallthrough
  }
  // 3) Build-time env
  const envN = OFFICIAL_NUMBER_ENV ? normalizeBrPhone(OFFICIAL_NUMBER_ENV) : null;
  if (envN) return { state: "available", number: envN };
  return { state: "unavailable" };
}

function waMeUrl(numberE164: string, code?: string) {
  const digits = numberE164.replace(/\D/g, "");
  return code
    ? `https://wa.me/${digits}?text=${encodeURIComponent("VINCULAR " + code)}`
    : `https://wa.me/${digits}`;
}

export function WhatsAppLinkSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<LinkRow | null>(null);
  const [consent, setConsent] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [official, setOfficial] = useState<OfficialResolution>({ state: "resolving" });
  const [code, setCode] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setCode(null);
    setPopupBlocked(false);
    setOfficial({ state: "resolving" });
    Promise.all([
      supabase.rpc("list_my_whatsapp_link").then(({ data }) => {
        const row = (data?.[0] as LinkRow | undefined) ?? null;
        setLink(row?.status === "active" ? row : null);
      }),
      resolveOfficialNumber().then(setOfficial),
    ]).finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const openWaMe = (numberE164: string, codeValue: string) => {
    const url = waMeUrl(numberE164, codeValue);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      setPopupBlocked(true);
      return false;
    }
    return true;
  };

  const generateAndOpen = async () => {
    if (!consent) return toast.error("Confirme o consentimento primeiro.");
    if (official.state !== "available") {
      toast.error("Não consegui localizar o número oficial agora. Tente novamente em instantes.");
      return;
    }
    setGenerating(true);
    let codeValue = code;
    if (!codeValue) {
      const { data, error } = await supabase.rpc("create_phone_link_code");
      setGenerating(false);
      if (error) {
        toast.error(
          error.message?.includes("too many")
            ? "Muitas tentativas. Tente novamente em alguns minutos."
            : "Não consegui gerar o código.",
        );
        return;
      }
      codeValue = String(data);
      setCode(codeValue);
    } else {
      setGenerating(false);
    }
    const opened = openWaMe(official.number, codeValue!);
    if (opened) onClose();
  };

  const retryOpen = () => {
    if (official.state !== "available" || !code) return;
    const opened = openWaMe(official.number, code);
    if (opened) {
      setPopupBlocked(false);
      onClose();
    }
  };

  const copyMessage = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText("VINCULAR " + code);
      toast.success("Mensagem copiada!");
    } catch {
      toast.error("Não consegui copiar. Copie manualmente o texto acima.");
    }
  };

  const openConversation = () => {
    if (official.state !== "available") {
      toast.error("Não consegui localizar o número oficial agora.");
      return;
    }
    window.open(waMeUrl(official.number), "_blank", "noopener,noreferrer");
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
              disabled={official.state !== "available"}
              className="mt-4 w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {copy.whatsapp.linkSheet.alreadyLinked}
            </button>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              {copy.whatsapp.linkSheet.manageIn}
            </p>
          </>
        ) : popupBlocked && code && official.state === "available" ? (
          <>
            <p className="text-sm">
              Seu navegador bloqueou a abertura automática do WhatsApp. Use os botões abaixo para continuar.
            </p>
            <div className="mt-4 rounded-xl bg-muted p-4 text-center font-mono text-lg tracking-wider">
              VINCULAR {code}
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={retryOpen}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
              >
                <ExternalLink size={14} /> Abrir WhatsApp novamente
              </button>
              <button
                onClick={copyMessage}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm"
              >
                <Copy size={14} /> Copiar mensagem
              </button>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Cole a mensagem no chat com o número oficial do NoControle.ia para concluir a vinculação.
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
              disabled={!consent || generating || official.state === "resolving"}
              onClick={generateAndOpen}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {generating || official.state === "resolving" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageCircle size={14} />
              )}
              {copy.whatsapp.linkSheet.generate}
            </button>
            {official.state === "unavailable" && (
              <p className="mt-3 rounded-lg bg-muted p-2 text-[11px] text-muted-foreground">
                Não consegui localizar o número oficial agora. Tente novamente em instantes.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
