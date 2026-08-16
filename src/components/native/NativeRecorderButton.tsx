import { useState } from "react";
import { Mic, Square } from "lucide-react";
import { VoiceRecorder } from "capacitor-voice-recorder";
import { supabase } from "@/integrations/supabase/client";
import { isNativePlatform } from "@/lib/native/platform";
import { toast } from "sonner";

export function NativeRecorderButton({ onTranscript, disabled }: { onTranscript: (text: string) => void; disabled?: boolean }) {
  const [recording, setRecording] = useState(false);
  if (!isNativePlatform()) return null;
  async function toggle() {
    try {
      if (!recording) {
        const permission = await VoiceRecorder.requestAudioRecordingPermission();
        if (!permission.value) { toast.error("Permita o microfone para gravar áudio"); return; }
        await VoiceRecorder.startRecording();
        setRecording(true);
        return;
      }
      const result = await VoiceRecorder.stopRecording();
      setRecording(false);
      const audio = result.value.recordDataBase64;
      if (!audio) throw new Error("empty_recording");
      const { data, error } = await supabase.functions.invoke("native-audio-transcribe", { body: { audio, mime_type: result.value.mimeType, duration_ms: result.value.msDuration } });
      if (error) throw error;
      const text = String((data as { text?: string })?.text ?? "").trim();
      if (!text) throw new Error("empty_transcript");
      onTranscript(text);
    } catch {
      setRecording(false);
      toast.error("Não consegui entender o áudio. Tente novamente.");
    }
  }
  return <button type="button" onClick={toggle} disabled={disabled} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-secondary text-muted-foreground disabled:opacity-50" aria-label={recording ? "Parar gravação" : "Gravar mensagem"}>{recording ? <Square size={15} className="fill-current text-destructive" /> : <Mic size={17} />}</button>;
}