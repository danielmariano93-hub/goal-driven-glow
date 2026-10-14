// Cliente das notificações push (Web Push). iOS só entrega push para o app instalado na Tela de Início (iOS 16.4+),
// e o pedido de permissão precisa vir de um toque da pessoa.
import { supabase } from "@/integrations/supabase/client";

export type PushSupport =
  | { state: "unsupported" }
  | { state: "ios_needs_install" }
  | { state: "denied" }
  | { state: "ready"; permission: NotificationPermission };

export const isIOSDevice = () =>
  typeof navigator !== "undefined"
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

export const isStandalone = () =>
  typeof window !== "undefined"
  && ((navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true);

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return { state: "unsupported" };
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!capable) return isIOSDevice() && !isStandalone() ? { state: "ios_needs_install" } : { state: "unsupported" };
  if (Notification.permission === "denied") return { state: "denied" };
  return { state: "ready", permission: Notification.permission };
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("/sw.js", { scope: "/" }); } catch { return null; }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("push-notify", { body });
  if (error) throw new Error("Não foi possível concluir agora. Tente de novo.");
  return data as T;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registerServiceWorker();
  if (!reg) return null;
  const ready = await navigator.serviceWorker.ready;
  return ready.pushManager.getSubscription();
}

/** Chamar a partir de um toque (clique): pede permissão, assina e registra o aparelho. */
export async function enablePush(): Promise<{ ok: true } | { ok: false; reason: "denied" | "unsupported" | "failed" }> {
  const support = pushSupport();
  if (support.state === "unsupported" || support.state === "ios_needs_install") return { ok: false, reason: "unsupported" };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };
  try {
    const { public_key } = await call<{ public_key: string }>({ action: "config" });
    const reg = await registerServiceWorker();
    if (!reg) return { ok: false, reason: "failed" };
    const ready = await navigator.serviceWorker.ready;
    const existing = await ready.pushManager.getSubscription();
    const subscription = existing ?? await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key) as unknown as BufferSource,
    });
    await call({ action: "subscribe", subscription: subscription.toJSON(), user_agent: navigator.userAgent });
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await call({ action: "unsubscribe", endpoint: subscription.endpoint }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}

export async function sendTestPush(): Promise<{ sent: number }> {
  return call<{ sent: number }>({ action: "test" });
}
