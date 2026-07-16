import { useRef, useState } from "react";
import { Paperclip, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

async function stripExifAndCompress(file: File): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxSide = 2000;
      let { width, height } = img;
      if (Math.max(width, height) > maxSide) {
        const r = maxSide / Math.max(width, height);
        width = Math.round(width * r);
        height = Math.round(height * r);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas_ctx"));
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error("blob_null")), "image/jpeg", 0.85);
    };
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = url;
  });
}

export function AssessorAttachButton({
  conversationId,
  onExtracted,
  disabled,
}: {
  conversationId: string | null;
  onExtracted: (info: { document_id: string; status: string; items_count?: number; document_kind?: string; error?: string | null }) => void;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    if (!ALLOWED.includes(file.type)) {
      toast.error("Formato não suportado. Envie JPEG, PNG ou WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Arquivo muito grande (máximo 10MB).");
      return;
    }
    setPreview({ url: URL.createObjectURL(file), name: file.name });
    setBusy(true);
    try {
      // Compress + strip EXIF client-side (canvas re-encode discards EXIF)
      const blob = await stripExifAndCompress(file).catch(() => file);
      const bytes = new Uint8Array(await blob.arrayBuffer());

      // 1) Ask edge function for a signed upload URL
      const create = await supabase.functions.invoke("assistant-ingest-document", {
        body: {
          mode: "create-upload",
          filename: file.name,
          mime_type: "image/jpeg",
          size_bytes: bytes.length,
          conversation_id: conversationId,
        },
      });
      if (create.error) throw create.error;
      const cr = create.data as { document_id: string; upload_url: string; storage_path: string; token: string };

      // 2) Upload directly using the signed URL
      const put = await fetch(cr.upload_url, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg", "x-upsert": "true" },
        body: bytes,
      });
      if (!put.ok) {
        const t = await put.text();
        throw new Error(`upload_failed:${put.status}:${t.slice(0, 120)}`);
      }

      // 3) Finalize (validate + extract)
      const fin = await supabase.functions.invoke("assistant-ingest-document", {
        body: { mode: "finalize", document_id: cr.document_id },
      });
      if (fin.error) throw fin.error;
      const fr = fin.data as { document_id: string; status: string; items_count?: number; document_kind?: string; error?: string | null };
      onExtracted(fr);
      setPreview(null);
    } catch (e) {
      toast.error("Falha ao processar imagem", { description: (e as Error).message });
      setPreview(null);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy || disabled}
        className="grid h-10 w-10 place-items-center rounded-full border border-border bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50"
        aria-label="Anexar imagem"
        title="Anexar recibo, fatura ou print"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
      </button>
      {preview && (
        <div className="fixed bottom-24 right-4 z-50 flex items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-brand">
          <img src={preview.url} alt="Preview" className="h-14 w-14 rounded-lg object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{preview.name}</p>
            <p className="text-[11px] text-muted-foreground">Processando…</p>
          </div>
          <button
            onClick={() => setPreview(null)}
            className="grid h-6 w-6 place-items-center rounded-full hover:bg-secondary"
            aria-label="Cancelar"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </>
  );
}
