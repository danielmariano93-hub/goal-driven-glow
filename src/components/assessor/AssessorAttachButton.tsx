import { useRef } from "react";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export type PreparedAttachment = {
  file: File;
  url: string;
  name: string;
};

async function stripExifAndCompress(file: File): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxSide = 2000;
      let { width, height } = img;
      if (Math.max(width, height) > maxSide) {
        const ratio = maxSide / Math.max(width, height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas_ctx"));
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("blob_null")), "image/jpeg", 0.85);
    };
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = url;
  });
}

export async function ingestDocument(
  file: File,
  conversationId: string | null,
  guidance: string,
) {
  const blob = await stripExifAndCompress(file).catch(() => file);
  const bytes = new Uint8Array(await blob.arrayBuffer());
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
  const upload = create.data as { document_id: string; upload_url: string };
  const put = await fetch(upload.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: bytes,
  });
  if (!put.ok) throw new Error(`upload_failed:${put.status}`);
  const finalize = await supabase.functions.invoke("assistant-ingest-document", {
    body: { mode: "finalize", document_id: upload.document_id, guidance: guidance.trim() || null },
  });
  if (finalize.error) throw finalize.error;
  return finalize.data as {
    document_id: string;
    status: string;
    items_count?: number;
    document_kind?: string;
    error?: string | null;
  };
}

export function AssessorAttachButton({
  onSelected,
  disabled,
}: {
  onSelected: (attachment: PreparedAttachment) => void;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    if (!ALLOWED.includes(file.type)) {
      toast.error("Formato não suportado. Envie JPEG, PNG ou WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Arquivo muito grande (máximo 10MB).");
      return;
    }
    onSelected({ file, url: URL.createObjectURL(file), name: file.name });
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50"
        aria-label="Anexar imagem"
        title="Anexar recibo, fatura ou print"
      >
        <Paperclip size={16} />
      </button>
    </>
  );
}
