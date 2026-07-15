import { useEffect, useState } from "react";
import { Loader2, Copy, ShieldCheck, MessageCircle, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

// The single official WhatsApp number of the platform. This is a placeholder until the WAHA
// credentials are provisioned; the UI shows "número oficial em configuração" when unset.
const OFFICIAL_NUMBER = (import.meta.env.VITE_WHATSAPP_OFFICIAL_NUMBER as string | undefined) ?? "";

type LinkRow = {
  id: string;
  status: "pending" | "active" | "revoked";
  phone_masked: string;
  consent_at: string;
  last_verified_at: string | null;
};

export default function WhatsApp() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<LinkRow | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [ttl, setTtl] = useState<number>(0);
  const [consent, setConsent] = useState(false);
  const [generating, setGenerating] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_my_whatsapp_link");
    if (error) toast.error("Não consegui carregar seu vínculo.");
    const row = (data?.[0] as LinkRow | undefined) ?? null;
    setLink(row?.status === "active" ? row : null);
    setLoading(false);
  };

  useEffect(() => { if (user) refresh(); }, [user]);

  useEffect(() => {
    if (!code) return;
    const start = Date.now();
    const total = 10 * 60;
    setTtl(total);
    const iv = setInterval(() => {
      const left = total - Math.floor((Date.now() - start) / 1000);
      setTtl(Math.max(0, left));
      if (left <= 0) { clearInterval(iv); setCode(null); }
    }, 1000);
    return () => clearInterval(iv);
  }, [code]);

  const generate = async () => {
    if (!consent) { toast.error("Confirme o consentimento primeiro."); return; }
    setGenerating(true);
    const { data, error } = await supabase.rpc("create_phone_link_code");
    setGenerating(false);
    if (error) { toast.error(error.message.includes("too many") ? "Muitas tentativas. Aguarde 30 min." : "Não consegui gerar o código."); return; }
    setCode(String(data));
  };

  const revoke = async () => {
    if (!confirm("Deseja desvincular seu WhatsApp?")) return;
    const { error } = await supabase.rpc("revoke_whatsapp_link");
    if (error) { toast.error("Não consegui desvincular."); return; }
    toast.success("Vínculo revogado.");
    setLink(null);
  };

  const waLink = code && OFFICIAL_NUMBER
    ? `https://wa.me/${OFFICIAL_NUMBER.replace(/\D/g, "")}?text=${encodeURIComponent("VINCULAR " + code)}`
    : null;

  if (loading) {
    return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">WhatsApp</h1>
        <p className="text-sm text-muted-foreground">Um número, seu contexto privado.</p>
      </header>

      {link ? (
        <div className="rounded-2xl border bg-card p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-3"><ShieldCheck className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="font-semibold">Vinculado</p>
              <p className="text-sm text-muted-foreground">{link.phone_masked}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Consentimento em {new Date(link.consent_at).toLocaleString("pt-BR")}
              </p>
            </div>
          </div>
          <button onClick={revoke} className="mt-6 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm hover:bg-accent">
            <Trash2 className="h-4 w-4" /> Desvincular
          </button>
        </div>
      ) : code ? (
        <div className="rounded-2xl border bg-card p-6">
          <p className="text-sm text-muted-foreground">Envie a seguinte mensagem ao número oficial do NoControle.ia pelo WhatsApp:</p>
          <div className="mt-4 rounded-xl bg-muted p-4 font-mono text-lg tracking-wider text-center">
            VINCULAR {code}
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => { navigator.clipboard.writeText("VINCULAR " + code); toast.success("Copiado!"); }}
              className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm hover:bg-accent"
            >
              <Copy className="h-4 w-4" /> Copiar
            </button>
            {waLink && (
              <a href={waLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground">
                <MessageCircle className="h-4 w-4" /> Abrir WhatsApp
              </a>
            )}
            <button onClick={generate} className="ml-auto inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm hover:bg-accent">
              <RefreshCw className="h-4 w-4" /> Novo código
            </button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Código expira em {Math.floor(ttl / 60)}:{String(ttl % 60).padStart(2, "0")}. Este código aparece apenas uma vez.
          </p>
          {!OFFICIAL_NUMBER && (
            <p className="mt-3 rounded-md bg-yellow-50 p-3 text-xs text-yellow-800">
              O número oficial ainda está em configuração. Assim que estiver ativo o botão acima ficará disponível.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            Vinculando seu WhatsApp, você poderá registrar gastos, tirar dúvidas e acompanhar suas metas por mensagem, com confirmação obrigatória antes de qualquer alteração no seu dinheiro.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground list-disc pl-5">
            <li>Um único número oficial atende todos os usuários.</li>
            <li>Seu número fica associado exclusivamente à sua conta.</li>
            <li>Nada é gravado sem sua confirmação explícita.</li>
          </ul>
          <label className="mt-5 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
            <span>Li e concordo com o tratamento do meu número para vincular ao NoControle.ia (LGPD).</span>
          </label>
          <button
            disabled={!consent || generating}
            onClick={generate}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            Gerar código de vínculo
          </button>
        </div>
      )}
    </div>
  );
}
