import { Capacitor } from "@capacitor/core";
import { VoiceRecorder } from "capacitor-voice-recorder";
import { nativeError, nativeLog } from "./logSanitizer";

export type RecordingResult = { base64: string; mimeType: string; durationMs: number };
export type RecorderStartError = "permission_denied" | "unavailable";

const MAX_DURATION_MS = 120_000;

/**
 * Gravação de áudio no app nativo.
 *
 * O plugin capacitor-voice-recorder não é compatível com SPM (Capacitor 8/iOS),
 * então no iOS usamos MediaRecorder da WKWebView, que já tem acesso ao microfone
 * via NSMicrophoneUsageDescription. Em Android usamos o plugin quando disponível.
 * Nos dois casos o resultado segue idêntico para o pipeline de transcrição.
 */
class AudioRecorder {
  private usePlugin = false;
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  private pluginAvailable(): boolean {
    return Capacitor.isPluginAvailable("VoiceRecorder") && Capacitor.getPlatform() === "android";
  }

  async start(): Promise<{ ok: boolean; error?: RecorderStartError }> {
    this.usePlugin = this.pluginAvailable();
    if (this.usePlugin) {
      try {
        const permission = await VoiceRecorder.requestAudioRecordingPermission();
        if (!permission.value) return { ok: false, error: "permission_denied" as const };
        await VoiceRecorder.startRecording();
        this.startedAt = Date.now();
        return { ok: true };
      } catch (error) {
        nativeError("audio", "plugin_start_failed", error);
        this.usePlugin = false;
      }
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      nativeLog("audio", "getusermedia_denied", error);
      return { ok: false, error: "permission_denied" as const };
    }
    const mimeType = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(
      (candidate) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)
    );
    try {
      this.mediaRecorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    } catch (error) {
      nativeError("audio", "mediarecorder_unavailable", error);
      this.releaseStream();
      return { ok: false, error: "unavailable" as const };
    }
    this.chunks = [];
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.mediaRecorder.start();
    this.startedAt = Date.now();
    this.timeout = setTimeout(() => {
      if (this.mediaRecorder?.state === "recording") this.mediaRecorder.stop();
    }, MAX_DURATION_MS);
    return { ok: true };
  }

  async stop(): Promise<RecordingResult | null> {
    if (this.usePlugin) {
      try {
        const result = await VoiceRecorder.stopRecording();
        const base64 = result.value?.recordDataBase64 ?? "";
        if (!base64) return null;
        return {
          base64,
          mimeType: result.value.mimeType || "audio/aac",
          durationMs: result.value.msDuration || Date.now() - this.startedAt,
        };
      } catch (error) {
        nativeError("audio", "plugin_stop_failed", error);
        return null;
      }
    }
    const recorder = this.mediaRecorder;
    if (!recorder) return null;
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType || "audio/mp4" }));
      if (recorder.state === "recording") recorder.stop();
      else resolve(new Blob(this.chunks, { type: recorder.mimeType || "audio/mp4" }));
    });
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    this.mediaRecorder = null;
    this.releaseStream();
    if (blob.size < 800) {
      nativeLog("audio", "recording_too_short", { bytes: blob.size });
      return null;
    }
    const base64 = await blobToBase64(blob);
    return { base64, mimeType: blob.type || "audio/mp4", durationMs: Date.now() - this.startedAt };
  }

  async cancel(): Promise<void> {
    if (this.usePlugin) {
      await VoiceRecorder.stopRecording().catch(() => undefined);
      return;
    }
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    if (this.mediaRecorder?.state === "recording") this.mediaRecorder.stop();
    this.mediaRecorder = null;
    this.releaseStream();
  }

  private releaseStream() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buffer.length; i += chunk) {
    binary += String.fromCharCode(...buffer.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export const audioRecorder = new AudioRecorder();
