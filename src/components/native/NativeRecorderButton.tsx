import { useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isNativePlatform } from "@/lib/native/platform";
import { audioRecorder } from "@/lib/native/audioRecorder";
import { beginNativeInteraction, endNativeInteraction } from "@/lib/native/interaction";
import { nativeError } from "@/lib/native/logSanitizer";

export function NativeRecorderButton({
  onTranscript,
  disabled,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  if (!isNativePlatform()) return null;

  async function startRecording() {
    beginNativeInteraction();
    const started = await audioRecorder.start();
    endNativeInteraction();
    if (!started.ok) {
      toast.error(
        started.error === "permission_denied"
          ? "Libere o microfone nos Ajustes para falar com o Nino."
          : "A gravação de áudio não está disponível neste aparelho."
      );
      return;
    }
    setState("recording");
  }

  async function finishRecording() {
    setState("sending");
    try {
      const recording = await audioRecorder.stop();
      if (!recording) {
        toast.error("A gravação ficou muito curta. Tente falar por mais tempo.");
        setState("idle");
        return;
      }
      const { data, error } = await supabase.functions.invoke("native-audio-transcribe", {
        body: {
          audio: recording.base64,
          mime_type: recording.mimeType,
          duration_ms: recording.durationMs,
        },
      });
      if (error) throw error;
      const text = String((data as { text?: string })?.text ?? "").trim();
      if (!text) throw new Error("empty_transcript");
      onTranscript(text);
    } catch (error) {
      nativeError("audio", "transcribe_failed", error);
      toast.error("Não consegui entender o áudio. Tente gravar novamente.");
    } finally {
      setState("idle");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void (state === "recording" ? finishRecording() : startRecording())}
      disabled={disabled || state === "sending"}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-secondary text-muted-foreground disabled:opacity-50"
      aria-label={state === "recording" ? "Parar gravação" : "Gravar mensagem"}
    >
      {state === "sending" ? (
        <Loader2 size={16} className="animate-spin" />
      ) : state === "recording" ? (
        <Square size={15} className="fill-current text-destructive" />
      ) : (
        <Mic size={17} />
      )}
    </button>
  );
}
