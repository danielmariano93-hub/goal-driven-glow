import { useEffect, useState } from "react";
import { Loader2, Save, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

const DEFAULT_TOKEN = "!ja";

export function FastLogTokenCard() {
  const { user } = useAuth();
  const [token, setToken] = useState(DEFAULT_TOKEN);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("user_ai_preferences" as never)
        .select("fast_log_token").eq("user_id", user.id).maybeSingle();
      const v = (data as { fast_log_token?: string } | null)?.fast_log_token;
      if (v && v.trim()) setToken(v.trim());
      setLoading(false);
    })();
  }, [user]);

  async function save() {
    if (!user) return;
    const clean = token.trim();
    if (!clean || clean.length > 16 || /\s/.test(clean)) {
      toast.error("Use até 16 caracteres, sem espaços (ex.: !ja, #ja, /go).");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("user_ai_preferences" as never)
      .upsert({ user_id: user.id, fast_log_token: clean } as never, { onConflict: "user_id" });
    setSaving(false);
    if (error) toast.error("Não consegui salvar. Tente de novo.");
    else toast.success("Palavra-mágica atualizada");
  }

  if (loading) {
    return (
      <div className="surface-card p-5 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" size={16} /> Carregando…
      </div>
    );
  }

  return (
    <div className="surface-card p-5 space-y-3">
      <header className="flex items-center gap-2">
        <Zap className="text-primary" size={18} />
        <div>
          <h2 className="font-semibold text-sm">Registro rápido</h2>
          <p className="text-xs text-muted-foreground">
            Comece ou termine a mensagem com essa palavra-mágica no Assessor ou no WhatsApp
            para registrar o lançamento na hora, sem passar pela confirmação.
          </p>
        </div>
      </header>

      <label className="text-sm space-y-1 block">
        <span className="text-xs font-medium text-muted-foreground">Palavra-mágica</span>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          maxLength={16}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
          placeholder={DEFAULT_TOKEN}
        />
      </label>

      <p className="text-xs text-muted-foreground">
        Exemplo: <code className="rounded bg-muted px-1.5 py-0.5">{token} gastei 42,90 no almoço no Nubank</code>
      </p>

      <button
        onClick={save}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-white text-sm font-semibold px-4 py-2 disabled:opacity-60"
      >
        {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
        Salvar
      </button>
    </div>
  );
}
