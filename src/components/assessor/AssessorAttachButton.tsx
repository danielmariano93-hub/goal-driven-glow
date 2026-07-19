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

export type IngestProgress = {
  stage: "preparing" | "uploading" | "processing";
  documentId?: string;
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

async function invokeVerifyUpload(documentId: string): Promise<{ exists: boolean; size: number }> {
  const { data, error } = await supabase.functions.invoke("assistant-ingest-document", {
    body: { mode: "verify-upload", document_id: documentId },
  });
  if (error) throw error;
  const d = data as { exists?: boolean; size?: number };
  return { exists: !!d?.exists, size: Number(d?.size ?? 0) };
}

async function invokeMarkUploadMissing(documentId: string): Promise<IngestResult> {
  const { data, error } = await supabase.functions.invoke("assistant-ingest-document", {
    body: { mode: "mark-upload-missing", document_id: documentId },
  });
  if (error) throw error;
  return data as IngestResult;
}

export async function getIngestionStatus(documentId: string): Promise<IngestResult> {
  return invokeStatus(documentId);
}

/** Retomada silenciosa: verifica objeto no storage; se sumiu, marca upload_missing sem reprocessar. */
export async function resumeIngestion(documentId: string): Promise<IngestResult> {
  // Antes de tentar resume, confirmar que o arquivo físico existe.
  try {
    const verify = await invokeVerifyUpload(documentId);
    if (!verify.exists) {
      try { return await invokeMarkUploadMissing(documentId); }
      catch { return { document_id: documentId, status: "failed", error: "upload_missing", user_message: "Não consegui salvar o arquivo. Reenvie, por favor." }; }
    }
  } catch {
    // Se verify falhar (ex: 404), segue para status.
  }
  let current: IngestResult;
  try {
    current = await invokeMode("resume", documentId);
  } catch {
    current = await invokeStatus(documentId).catch(() => ({ document_id: documentId, status: "processing" } as IngestResult));
  }
  return current;
}

export type DocumentSourceContext = {
  sourceAccountId?: string | null;
  sourceCreditCardId?: string | null;
};

export async function ingestDocument(
  file: File,
  conversationId: string | null,
  guidance: string,
  onProgress?: (progress: IngestProgress) => void,
  sourceContext: DocumentSourceContext = {},
): Promise<IngestResult> {
  if (sourceContext.sourceAccountId && sourceContext.sourceCreditCardId) {
    throw new Error("Escolha uma conta ou um cartão, não os dois.");
  }
  onProgress?.({ stage: "preparing" });
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
      guidance: guidance.trim() || null,
      source_account_id: sourceContext.sourceAccountId ?? null,
      source_credit_card_id: sourceContext.sourceCreditCardId ?? null,
    },
  });
  if (create.error) throw create.error;
  const upload = create.data as {
    document_id: string;
    upload_url: string;
    storage_path: string;
    token: string;
  };
  onProgress?.({ stage: "uploading", documentId: upload.document_id });

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .uploadToSignedUrl(upload.storage_path, upload.token, blob, {
      contentType: mimeType,
      upsert: true,
    });

  // Verificação server-side: o objeto realmente está no storage?
  // Se o signed-url falhou, pulamos o primeiro verify e vamos direto ao fallback.
  let verified = uploadError
    ? { exists: false, size: 0 }
    : await invokeVerifyUpload(upload.document_id).catch(() => ({ exists: false, size: 0 }));

  if (!verified.exists) {
    // Fallback único: upload autenticado no mesmo caminho (respeita RLS por prefixo user_id/).
    try {
      const { error: fbErr } = await supabase.storage
        .from("documents")
        .upload(upload.storage_path, blob, { contentType: mimeType, upsert: true });
      if (fbErr) throw fbErr;
    } catch {
      // segue: se falhou, verify vai continuar false
    }
    verified = await invokeVerifyUpload(upload.document_id).catch(() => ({ exists: false, size: 0 }));
  }

  onProgress?.({ stage: "processing", documentId: upload.document_id });

  if (!verified.exists) {
    // Sinaliza no servidor e aborta antes de qualquer IA.
    try { await invokeMarkUploadMissing(upload.document_id); } catch { /* ignore */ }
    const err = new Error("Não consegui salvar o arquivo. Verifique sua conexão e tente novamente.");
    (err as Error & { code?: string }).code = "upload_missing";
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

  // O processamento é um job do servidor. Não mantenha o composer bloqueado nem
  // vincule a vida do job a este painel: AssessorPanel acompanha o status pelo id.
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
