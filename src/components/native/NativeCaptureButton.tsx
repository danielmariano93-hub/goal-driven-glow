import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Camera as CameraIcon } from "lucide-react";
import { toast } from "sonner";
import { isNativePlatform } from "@/lib/native/platform";
import type { PreparedAttachment } from "@/components/assessor/AssessorAttachButton";

export function NativeCaptureButton({ onSelected, disabled }: { onSelected: (file: PreparedAttachment) => void; disabled?: boolean }) {
  if (!isNativePlatform()) return null;
  async function capture() {
    try {
      const image = await Camera.getPhoto({ resultType: CameraResultType.Uri, source: CameraSource.Prompt, quality: 88, correctOrientation: true });
      if (!image.webPath) return;
      const blob = await fetch(image.webPath).then((response) => response.blob());
      const file = new File([blob], `documento-${Date.now()}.${image.format || "jpeg"}`, { type: blob.type || `image/${image.format || "jpeg"}` });
      onSelected({ file, url: URL.createObjectURL(file), name: file.name, mimeType: file.type });
    } catch (error) {
      if (!String(error).toLowerCase().includes("cancel")) toast.error("Não foi possível abrir a câmera");
    }
  }
  return <button type="button" onClick={capture} disabled={disabled} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-secondary text-muted-foreground disabled:opacity-50" aria-label="Fotografar documento"><CameraIcon size={17} /></button>;
}