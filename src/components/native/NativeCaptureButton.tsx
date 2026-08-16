import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Camera as CameraIcon } from "lucide-react";
import { toast } from "sonner";
import { isNativePlatform } from "@/lib/native/platform";
import { withNativeInteraction } from "@/lib/native/interaction";
import { nativeError } from "@/lib/native/logSanitizer";
import type { PreparedAttachment } from "@/components/assessor/AssessorAttachButton";

const MAX_BYTES = 12 * 1024 * 1024;

function isCancellation(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error).toLowerCase();
  return message.includes("cancel") || message.includes("cancelou");
}

function isPermissionDenied(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error).toLowerCase();
  return message.includes("denied") || message.includes("permission") || message.includes("not authorized");
}

export function NativeCaptureButton({
  onSelected,
  disabled,
}: {
  onSelected: (file: PreparedAttachment) => void;
  disabled?: boolean;
}) {
  if (!isNativePlatform()) return null;

  async function capture() {
    try {
      const image = await withNativeInteraction(() =>
        Camera.getPhoto({
          resultType: CameraResultType.Uri,
          source: CameraSource.Prompt,
          quality: 88,
          correctOrientation: true,
          // Garante JPEG mesmo quando o iPhone captura em HEIC.
          promptLabelHeader: "Anexar documento",
          promptLabelPhoto: "Escolher da galeria",
          promptLabelPicture: "Usar a câmera",
          promptLabelCancel: "Cancelar",
        })
      );
      if (!image.webPath) return;
      const blob = await fetch(image.webPath).then((response) => response.blob());
      if (blob.size > MAX_BYTES) {
        toast.error("Essa imagem é muito grande. Tente uma foto com menos detalhe.");
        return;
      }
      const format = (image.format || "jpeg").toLowerCase();
      const mimeType = blob.type && blob.type !== "application/octet-stream" ? blob.type : `image/${format}`;
      const file = new File([blob], `documento-${Date.now()}.${format}`, { type: mimeType });
      onSelected({ file, url: URL.createObjectURL(file), name: file.name, mimeType });
    } catch (error) {
      if (isCancellation(error)) return;
      nativeError("camera", "capture_failed", error);
      if (isPermissionDenied(error)) {
        toast.error("Libere o acesso à câmera nos Ajustes para fotografar documentos.");
        return;
      }
      toast.error("Não conseguimos abrir a câmera agora. Tente novamente.");
    }
  }

  return (
    <button
      type="button"
      onClick={capture}
      disabled={disabled}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-secondary text-muted-foreground disabled:opacity-50"
      aria-label="Fotografar documento"
    >
      <CameraIcon size={17} />
    </button>
  );
}
