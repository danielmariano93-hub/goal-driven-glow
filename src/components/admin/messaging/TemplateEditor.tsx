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
};

const VARIABLE_RX = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi;

function usedVariables(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(VARIABLE_RX)).map((m) => m[1])));
}

function renderPreview(text: string): string {
  return text.replace(VARIABLE_RX, (_all, name: string) => `[${name}]`);
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
  }, [current?.id, current?.title_template, current?.body_template]);

  const allowed = current?.allowed_variables ?? [];
  const used = usedVariables(`${title} ${body}`);
  const invalid = allowed.length > 0 ? used.filter((v) => !allowed.includes(v)) : [];

  const save = useMutation({
    mutationFn: async () => {
      if (!kind) return;
      if (!body.trim()) throw new Error("A mensagem não pode ficar vazia.");
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
                className="mt-1 min-h-[160px]"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Texto que o cliente recebe"
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
                  <p className="text-sm font-semibold">{renderPreview(title)}</p>
                )}
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">
                  {renderPreview(body) || "Sua mensagem aparece aqui."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </SidePanel>
  );
}
