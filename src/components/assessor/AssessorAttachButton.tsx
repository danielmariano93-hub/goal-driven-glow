import { useRef } from "react";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export type PreparedAttachment = {
  file: File;
  url: string;
  name: string;
  mimeType: string;
};

export type IngestResult = {
  document_id: string;
  status: string;
  items_count?: number;
  document_kind?: string | null;
  error?: string | null;
  correlation_id?: string | null;
  user_message?: string | null;
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

const POLL_STEPS_MS = [2000, 3000, 5000, 8000, 12000, 20000];
const TERMINAL = new Set(["needs_review", "confirmed", "partially_confirmed", "canceled", "failed"]);

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function invokeStatus(documentId: string): Promise<IngestResult> {
  const { data, error } = await supabase.functions.invoke("assistant-ingest-document", {
    body: { mode: "status", document_id: documentId },
  });
  if (error) throw error;
  return data as IngestResult;
}

async function invokeMode(mode: "finalize" | "resume", documentId: string, guidance?: string): Promise<IngestResult> {
  const { data, error } = await supabase.functions.invoke("assistant-ingest-document", {
    body: { mode, document_id: documentId, guidance: guidance?.trim() || null },
  });
  if (error) throw error;
  return data as IngestResult;
}

async function pollUntilTerminal(documentId: string): Promise<IngestResult> {
  let last: IngestResult | null = null;
  for (const wait of POLL_STEPS_MS) {
    await sleep(wait);
    try {
      last = await invokeStatus(documentId);
    } catch {
      continue;
    }
    if (last && TERMINAL.has(last.status)) return last;
  }
  return last ?? { document_id: documentId, status: "processing" };
}

/** Retomada silenciosa: dispara resume + polling curto para um doc já uploaded/processing. */
export async function resumeIngestion(documentId: string): Promise<IngestResult> {
  let current: IngestResult;
  try {
    current = await invokeMode("resume", documentId);
  } catch {
    current = await invokeStatus(documentId).catch(() => ({ document_id: documentId, status: "processing" } as IngestResult));
  }
  if (TERMINAL.has(current.status)) return current;
  return pollUntilTerminal(documentId);
}

export async function ingestDocument(
  file: File,
  conversationId: string | null,
  guidance: string,
): Promise<IngestResult> {
  const isPdf = file.type === "application/pdf";
  const blob = isPdf ? file : await stripExifAndCompress(file).catch(() => file);
  const mimeType = isPdf ? "application/pdf" : "image/jpeg";
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const create = await supabase.functions.invoke("assistant-ingest-document", {
    body: {
      mode: "create-upload",
      filename: file.name,
      mime_type: mimeType,
      size_bytes: bytes.length,
      conversation_id: conversationId,
    },
  });
  if (create.error) throw create.error;
  const upload = create.data as {
    document_id: string;
    upload_url: string;
    storage_path: string;
    token: string;
  };

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .uploadToSignedUrl(upload.storage_path, upload.token, blob, {
      contentType: mimeType,
      upsert: true,
    });
  if (uploadError) {
    const err = new Error("Não consegui enviar o arquivo. Verifique sua conexão e tente novamente.");
    (err as Error & { code?: string }).code = "upload";
    throw err;
  }

  // Fire finalize — server returns 202 quickly (background task).
  let current: IngestResult;
  try {
    current = await invokeMode("finalize", upload.document_id, guidance);
  } catch {
    // Fetch aborted or network hiccup: don't reupload; try resume path.
    current = { document_id: upload.document_id, status: "processing" };
  }

  if (!TERMINAL.has(current.status)) {
    current = await pollUntilTerminal(upload.document_id);
  }

  if (!TERMINAL.has(current.status)) {
    // Ainda travado: uma tentativa explícita de retomada.
    try {
      const resumed = await invokeMode("resume", upload.document_id, guidance);
      current = TERMINAL.has(resumed.status) ? resumed : await pollUntilTerminal(upload.document_id);
    } catch {
      current = await invokeStatus(upload.document_id).catch(() => current);
    }
  }

  return current;
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
      toast.error("Formato não suportado. Envie PDF, JPEG, PNG ou WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Arquivo muito grande (máximo 20 MB).");
      return;
    }
    onSelected({ file, url: URL.createObjectURL(file), name: file.name, mimeType: file.type });
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp,.pdf"
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
        aria-label="Anexar documento"
        title="Anexar PDF, extrato, fatura, recibo ou print"
      >
        <Paperclip size={16} />
      </button>
    </>
  );
}
