/**
 * Feedback padronizado do NoControle.ia.
 * Wrappers finos sobre sonner para manter tom pt-BR consistente
 * (claro, encorajador, sem culpa). Use em toda a UI do app.
 */
import { toast } from "sonner";

export function notifySuccess(message: string, description?: string) {
  return toast.success(message, description ? { description } : undefined);
}

export function notifyError(message: string, description?: string) {
  return toast.error(message, description ? { description } : undefined);
}

export function notifyInfo(message: string, description?: string) {
  return toast(message, description ? { description } : undefined);
}

export function notifyLoading(message: string): string | number {
  return toast.loading(message);
}

export function dismissToast(id: string | number) {
  toast.dismiss(id);
}

/** Extrai mensagem legível de qualquer erro. */
export function humanizeError(e: unknown, fallback = "Algo não deu certo. Tente novamente."): string {
  if (!e) return fallback;
  if (typeof e === "string") return e;
  if (e instanceof Error && e.message) return e.message;
  try { return JSON.stringify(e); } catch { return fallback; }
}
