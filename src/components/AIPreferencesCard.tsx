import { useEffect, useState } from "react";
import { Loader2, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Preferences = {
  tone: "friendly" | "neutral" | "formal";
  verbosity: "concise" | "balanced" | "detailed";
  explanation_style: "plain" | "technical" | "storytelling";
  example_style: "concrete" | "abstract";
  suggestion_frequency: "low" | "medium" | "high";
  technical_level: "basic" | "intermediate" | "advanced";
};

const DEFAULTS: Preferences = {
  tone: "friendly", verbosity: "balanced", explanation_style: "plain",
  example_style: "concrete", suggestion_frequency: "medium", technical_level: "basic",
};

export function AIPreferencesCard() {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("user-ai-preferences", { method: "GET" });
        if (error) throw error;
        setPrefs({ ...DEFAULTS, ...(data?.preferences ?? {}) });
      } catch { /* silencioso */ }
      finally { setLoading(false); }
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke("user-ai-preferences", { body: prefs });
      if (error) throw error;
      toast.success("Preferências salvas");
    } catch (e: any) {
      toast.error(e.message ?? "Falha ao salvar");
    } finally { setSaving(false); }
  }

  if (loading) {
    return (
      <div className="surface-card p-5 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" size={16} /> Carregando preferências…
      </div>
    );
  }

  return (
    <div className="surface-card p-5 space-y-4">
      <header className="flex items-center gap-2">
        <Sparkles className="text-primary" size={18} />
        <div>
          <h2 className="font-semibold text-sm">Personalização do assistente</h2>
          <p className="text-xs text-muted-foreground">Ajuste como o MeuNino conversa com você.</p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Select label="Tom" value={prefs.tone} onChange={(v) => setPrefs({ ...prefs, tone: v as any })}
          options={[["friendly", "Acolhedor"], ["neutral", "Neutro"], ["formal", "Formal"]]} />
        <Select label="Verbosidade" value={prefs.verbosity} onChange={(v) => setPrefs({ ...prefs, verbosity: v as any })}
          options={[["concise", "Direto"], ["balanced", "Equilibrado"], ["detailed", "Detalhado"]]} />
        <Select label="Explicações" value={prefs.explanation_style} onChange={(v) => setPrefs({ ...prefs, explanation_style: v as any })}
          options={[["plain", "Simples"], ["technical", "Técnicas"], ["storytelling", "Narrativas"]]} />
        <Select label="Exemplos" value={prefs.example_style} onChange={(v) => setPrefs({ ...prefs, example_style: v as any })}
          options={[["concrete", "Concretos"], ["abstract", "Abstratos"]]} />
        <Select label="Sugestões proativas" value={prefs.suggestion_frequency} onChange={(v) => setPrefs({ ...prefs, suggestion_frequency: v as any })}
          options={[["low", "Raramente"], ["medium", "Quando faz diferença"], ["high", "Com frequência"]]} />
        <Select label="Nível técnico" value={prefs.technical_level} onChange={(v) => setPrefs({ ...prefs, technical_level: v as any })}
          options={[["basic", "Básico"], ["intermediate", "Intermediário"], ["advanced", "Avançado"]]} />
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-white text-sm font-semibold px-4 py-2 disabled:opacity-60"
      >
        {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
        Salvar preferências
      </button>
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]>;
}) {
  return (
    <label className="text-sm space-y-1 block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
