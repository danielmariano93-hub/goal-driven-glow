import { useEffect, useState } from "react";
import { Loader2, Copy, ShieldCheck, MessageCircle, RefreshCw, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { normalizeBrPhone } from "@/lib/phone";

// The single official WhatsApp number of the platform. Resolved from the connected
// WAHA session via the `whatsapp-official-number` edge function, with a persistent
// sanitized fallback and a build-time env fallback.
const OFFICIAL_NUMBER_ENV = (import.meta.env.VITE_WHATSAPP_OFFICIAL_NUMBER as string | undefined) ?? "";

async function resolveOfficialNumber(): Promise<string | null> {
  try {
    const { data } = await supabase.functions.invoke<{ available: boolean; official_number: string | null }>(
      "whatsapp-official-number", { method: "GET" as any });
    if (data?.available && data.official_number) {
      const n = normalizeBrPhone(data.official_number);
      if (n) return n;
    }
  } catch { /* fallthrough */ }
  try {
    const { data } = await supabase.from("platform_public_config")
      .select("value").eq("key", "official_whatsapp_number").maybeSingle();
    const raw = (data as { value?: string } | null)?.value;
    const n = raw ? normalizeBrPhone(raw) : null;
    if (n) return n;
  } catch { /* fallthrough */ }
  return OFFICIAL_NUMBER_ENV ? normalizeBrPhone(OFFICIAL_NUMBER_ENV) : null;
}

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
  const [officialNumber, setOfficialNumber] = useState<string | null>(null);

  useEffect(() => { resolveOfficialNumber().then(setOfficialNumber); }, []);


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

  const linkMessage = code
    ? `Olá! Quero vincular meu WhatsApp ao NoControle. Meu código de verificação é: ${code}`
    : "";
  const waLink = code && officialNumber
    ? `https://wa.me/${officialNumber.replace(/\D/g, "")}?text=${encodeURIComponent(linkMessage)}`
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
          <div className="mt-4 rounded-xl bg-muted p-4 text-sm leading-relaxed">
            {linkMessage}
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => { navigator.clipboard.writeText(linkMessage); toast.success("Copiado!"); }}
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
          {!officialNumber && (
            <p className="mt-3 rounded-md bg-yellow-50 p-3 text-xs text-yellow-800">
              Não consegui localizar o número oficial agora. Tente novamente em instantes.
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

      {link && <PendingAndReceipts />}

      <div className="mt-6 rounded-2xl border bg-card p-6">
        <p className="text-sm font-semibold">O que eu entendo</p>
        <ul className="mt-2 text-sm text-muted-foreground space-y-1">
          <li>• “gastei 42,90 no almoço hoje no Nubank”</li>
          <li>• “recebi 3000 salário”</li>
          <li>• “transferir 100 de Nubank para Itaú”</li>
          <li>• “resumo do mês” ou “posso gastar 200 hoje?”</li>
          <li>• <strong>!ja gastei 42,90 no almoço no Nubank</strong> — registra direto, sem confirmação</li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Toda operação que mexe no seu dinheiro pede um CONFIRMAR antes de gravar — exceto quando você usa <code>!ja</code>.
        </p>
      </div>
    </div>
  );
}

function PendingAndReceipts() {
  const qc = useQueryClient();
  const pending = useQuery({
    queryKey: ["wl_pending"],
    queryFn: async () => {
      const { data } = await supabase.from("pending_confirmations")
        .select("id, kind, summary_text, expires_at")
        .eq("status", "pending").order("created_at", { ascending: false });
      return (data as any[]) ?? [];
    },
  });
  const receipts = useQuery({
    queryKey: ["wl_receipts"],
    queryFn: async () => {
      const { data } = await supabase.from("pending_confirmations")
        .select("id, kind, summary_text, status, executed_at")
        .in("status", ["confirmed", "cancelled"]).order("created_at", { ascending: false }).limit(10);
      return (data as any[]) ?? [];
    },
  });

  const act = async (id: string, action: "confirm" | "cancel") => {
    const fn = action === "confirm" ? "confirm_pending_action" : "cancel_pending_action";
    const { error } = await supabase.rpc(fn, { p_id: id });
    if (error) toast.error(error.message);
    else {
      toast.success(action === "confirm" ? "Confirmado." : "Cancelado.");
      qc.invalidateQueries({ queryKey: ["wl_pending"] });
      qc.invalidateQueries({ queryKey: ["wl_receipts"] });
    }
  };

  return (
    <>
      {(pending.data ?? []).length > 0 && (
        <div className="mt-6 rounded-2xl border bg-card p-6">
          <p className="text-sm font-semibold mb-3">Pendências para confirmar</p>
          <ul className="space-y-3">
            {pending.data!.map(p => (
              <li key={p.id} className="text-sm rounded-lg border p-3">
                <p>{p.summary_text}</p>
                <p className="text-xs text-muted-foreground mt-1">Expira em {new Date(p.expires_at).toLocaleString("pt-BR")}</p>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => act(p.id, "confirm")} className="rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs">CONFIRMAR</button>
                  <button onClick={() => act(p.id, "cancel")} className="rounded-full border px-3 py-1 text-xs">CANCELAR</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(receipts.data ?? []).length > 0 && (
        <div className="mt-6 rounded-2xl border bg-card p-6">
          <p className="text-sm font-semibold mb-2">Últimas ações do agente</p>
          <ul className="text-sm space-y-1">
            {receipts.data!.map(r => (
              <li key={r.id} className="text-xs flex items-start gap-2">
                {r.status === "confirmed"
                  ? <CheckCircle2 className="h-3 w-3 mt-0.5 text-green-600" />
                  : <XCircle className="h-3 w-3 mt-0.5 text-muted-foreground" />}
                <span>{r.summary_text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
