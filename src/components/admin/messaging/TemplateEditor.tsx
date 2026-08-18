import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Smartphone, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SidePanel } from "@/components/admin/kit/SidePanel";
import { HealthPill } from "@/components/admin/kit/HealthPill";
import { adminToast } from "@/components/admin/adminToast";
import { adminErrorMessage, callAdminRpc } from "@/lib/admin/adminRpc";

export type TemplateRow = {
  id: string;
  kind: string;
  channel: "app" | "whatsapp";
  title_template: string;
  body_template: string;
  allowed_variables: string[];
  active: boolean;
  version: number;
  mode?: "fixed" | "ai_framed" | null;
  frame_template?: string | null;
  catalog_content_mode?: string | null;
};

const VARIABLE_RX = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi;

/** Exemplos usados só na prévia, para o texto ser lido como o cliente lê. */
const SAMPLE: Record<string, string> = {
  title: "Fatura acelerando neste ciclo",
  body: "Sua fatura já soma R$ 1.240 com 11 dias de ciclo restantes — 28% acima do mesmo ponto do mês passado.",
  amount: "R$ 1.240,00",
  count: "7",
  description: "Mercado Central",
  remaining: "R$ 380,00",
  days_left: "11",
  monthly_needed: "R$ 620,00",
  category: "Alimentação",
  share: "28%",
  current: "R$ 1.240,00",
  avg: "R$ 970,00",
  due: "10/09",
  occurred_at: "14/08",
  severity: "atenção",
  kind: "card_cycle_acceleration",
  dedup_key: "exemplo",
  action_url: "meunino.com.br/app/alertas",
};

function usedVariables(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(VARIABLE_RX)).map((m) => m[1])));
}

function fill(text: string): string {
  return text.replace(VARIABLE_RX, (_all, name: string) => SAMPLE[name] ?? `[${name}]`);
}

function renderPreview(text: string, frame: string): string {
  const filled = fill(text);
  if (!frame.trim()) return filled;
  return fill(frame.replace(/\{\{\s*body\s*\}\}/gi, filled));
}


/**
 * Editor de mensagem com prévia no formato em que o cliente recebe.
 * Cada gravação publica uma nova versão — nunca sobrescreve histórico.
 */
export function TemplateEditor({
  kind,
  kindLabel,
  onClose,
}: {
  kind: string | null;
  kindLabel: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [channel, setChannel] = useState<"app" | "whatsapp">("whatsapp");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [frame, setFrame] = useState("");
  const [mode, setMode] = useState<"fixed" | "ai_framed">("fixed");

  const templates = useQuery({
    queryKey: ["admin_communication_templates", kind],
    enabled: !!kind,
    queryFn: async (): Promise<TemplateRow[]> => {
      try {
        return (await callAdminRpc<TemplateRow[]>("admin_communication_templates", { _kind: kind })) ?? [];
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao carregar as mensagens deste fluxo"));
      }
    },
  });

  const current = useMemo(
    () => (templates.data ?? []).find((t) => t.channel === channel) ?? null,
    [templates.data, channel],
  );

  useEffect(() => {
    setTitle(current?.title_template ?? "");
    setBody(current?.body_template ?? "");
    setFrame(current?.frame_template ?? "");
    setMode((current?.mode as "fixed" | "ai_framed") ?? "fixed");
  }, [current?.id, current?.title_template, current?.body_template, current?.frame_template, current?.mode]);

  const allowed = current?.allowed_variables ?? [];
  const used = usedVariables(`${title} ${body} ${frame}`);
  const invalid = allowed.length > 0 ? used.filter((v) => !allowed.includes(v)) : [];

  const save = useMutation({
    mutationFn: async () => {
      if (!kind) return;
      if (!body.trim()) throw new Error("A mensagem não pode ficar vazia.");
      if (frame.trim() && !/\{\{\s*body\s*\}\}/i.test(frame)) {
        throw new Error("A moldura precisa conter {{body}} — é onde entra a leitura do Nino.");
      }
      if (invalid.length > 0) {
        throw new Error(`Variáveis não permitidas neste fluxo: ${invalid.join(", ")}`);
      }
      try {
        await callAdminRpc("admin_communication_template_upsert", {
          _kind: kind,
          _channel: channel,
          _title_template: title,
          _body_template: body,
          _active: true,
          _mode: mode,
          _frame_template: frame,
        });
      } catch (error) {
        throw new Error(adminErrorMessage(error, "Falha ao publicar a mensagem"));
      }
    },

    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin_communication_templates"] });
      adminToast.success("Nova versão publicada");
    },
    onError: (error: Error) => adminToast.error(error.message),
  });

  return (
    <SidePanel
      open={!!kind}
      onClose={onClose}
      title={`Mensagem · ${kindLabel}`}
      description="Edite o texto, confira a prévia e publique uma nova versão."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
            Publicar versão
          </Button>
        </>
      }
    >
      {templates.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando mensagens do fluxo…</p>
      ) : (
        <div className="space-y-5">
          <div className="inline-flex rounded-full border border-border bg-card p-1">
            {(["whatsapp", "app"] as const).map((c) => {
              const active = channel === c;
              const Icon = c === "whatsapp" ? MessageCircle : Smartphone;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannel(c)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "bg-gradient-brand text-primary-foreground shadow-brand"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  <Icon size={13} />
                  {c === "whatsapp" ? "WhatsApp" : "Aplicativo"}
                </button>
              );
            })}
          </div>

          {!current && (
            <p className="rounded-2xl border border-dashed border-border p-3 text-xs text-muted-foreground">
              Este fluxo ainda não tem mensagem neste canal. Escreva abaixo e publique para criar a
              primeira versão.
            </p>
          )}

          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Como o texto é escrito</p>
              <div className="mt-2 inline-flex rounded-full border border-border bg-card p-1">
                {([
                  { id: "fixed" as const, label: "Texto fixo" },
                  { id: "ai_framed" as const, label: "Moldura + leitura do Nino" },
                ]).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setMode(option.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      mode === option.id
                        ? "bg-gradient-brand text-primary-foreground shadow-brand"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Em “texto fixo”, o cliente recebe exatamente o que você escrever, com os números do
                motor. Em “moldura”, sua abertura e fecho ficam fixos e só a leitura do meio muda.
              </p>
            </div>

            <label className="block text-xs font-medium text-muted-foreground">
              Título
              <Input
                className="mt-1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título curto, aparece na notificação do app"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Mensagem
              <Textarea
                className="mt-1 min-h-[140px]"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Texto que o cliente recebe"
              />
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              Moldura (abertura e fecho, opcional)
              <Textarea
                className="mt-1 min-h-[120px]"
                value={frame}
                onChange={(e) => setFrame(e.target.value)}
                placeholder={"Oi! Olhei seus números.\n\n{{body}}\n\nQuer que eu te ajude com isso agora?"}
              />
            </label>
          </div>

          {allowed.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Variáveis disponíveis (clique para inserir)
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {allowed.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setBody((prev) => `${prev}{{${v}}}`)}
                    className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:border-primary/40 hover:text-primary"
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {invalid.length > 0 && (
            <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              Variáveis não permitidas neste fluxo: {invalid.join(", ")}. Remova antes de publicar.
            </p>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Prévia {channel === "whatsapp" ? "no WhatsApp" : "no aplicativo"}
              </p>
              {current && <HealthPill tone="info">versão atual v{current.version}</HealthPill>}
            </div>
            <div className="rounded-2xl bg-secondary p-4">
              <div className="max-w-sm rounded-2xl rounded-tl-sm bg-card p-3 shadow-sm">
                {title.trim() && (
                  <p className="text-sm font-semibold">{renderPreview(title, "")}</p>
                )}
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">
                  {renderPreview(body, frame) || "Sua mensagem aparece aqui."}
                </p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Prévia com números de exemplo. No envio real, o Nino usa os dados do cliente.
            </p>
          </div>

        </div>
      )}
    </SidePanel>
  );
}
