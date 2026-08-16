import type { Session } from "@supabase/supabase-js";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { BiometricAuth, BiometryError, BiometryErrorType } from "@aparajita/capacitor-biometric-auth";
import { isNativePlatform } from "./platform";
import { nativeError, nativeLog } from "./logSanitizer";

const SESSION_KEY = "meunino.auth.session";
const BIOMETRIC_KEY = "meunino.biometric.enabled";

type StoredSession = { access_token: string; refresh_token: string; user_id: string | null };

/**
 * Persiste apenas os tokens necessários no Keychain (Secure Storage).
 * Nada de sessão em localStorage/sessionStorage/Preferences no app nativo.
 */
export async function persistNativeSession(session: Session | null): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    if (session?.access_token && session.refresh_token) {
      const payload: StoredSession = {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        user_id: session.user?.id ?? null,
      };
      await SecureStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    } else {
      await SecureStorage.removeItem(SESSION_KEY);
    }
  } catch (error) {
    nativeError("session", "persist_failed", error);
  }
}

export async function restoreNativeSession(): Promise<StoredSession | null> {
  if (!isNativePlatform()) return null;
  try {
    const value = await SecureStorage.getItem(SESSION_KEY);
    if (typeof value !== "string" || !value) return null;
    const parsed = JSON.parse(value) as StoredSession;
    if (!parsed?.access_token || !parsed?.refresh_token) return null;
    return parsed;
  } catch (error) {
    nativeError("session", "restore_failed", error);
    return null;
  }
}

/** Limpeza total (logout, troca de usuário, token revogado, reinstalação). */
export async function clearNativeSession(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await SecureStorage.removeItem(SESSION_KEY);
  } catch (error) {
    nativeError("session", "clear_failed", error);
  }
}

export type BiometryStatus = "available" | "not_enrolled" | "unavailable";

export async function biometricStatus(): Promise<BiometryStatus> {
  if (!isNativePlatform()) return "unavailable";
  try {
    const result = await BiometricAuth.checkBiometry();
    if (result.isAvailable) return "available";
    if (result.reason === "biometryNotEnrolled" || result.code === BiometryErrorType.biometryNotEnrolled) {
      return "not_enrolled";
    }
    return result.deviceIsSecure ? "not_enrolled" : "unavailable";
  } catch (error) {
    nativeError("biometrics", "check_failed", error);
    return "unavailable";
  }
}

/** Retrocompatível com o card de segurança do app. */
export async function biometricAvailability(): Promise<boolean> {
  return (await biometricStatus()) === "available";
}

export async function biometricEnabled(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  try {
    return (await SecureStorage.getItem(BIOMETRIC_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  if (!isNativePlatform()) return;
  if (enabled) {
    await BiometricAuth.authenticate({
      reason: "Confirme sua identidade para proteger o Meu Nino",
      cancelTitle: "Cancelar",
      allowDeviceCredential: true,
      androidTitle: "Desbloquear Meu Nino",
    });
    await SecureStorage.setItem(BIOMETRIC_KEY, "true");
  } else {
    await SecureStorage.removeItem(BIOMETRIC_KEY);
  }
}

export type UnlockOutcome =
  | { ok: true; reason: "not_required" | "authenticated" }
  | { ok: false; reason: "cancelled" | "failed" | "unavailable" | "not_enrolled" };

/**
 * Desbloqueio biométrico. Cancelar NUNCA descarta a sessão:
 * quem chama decide mostrar a tela de bloqueio com fallback de login.
 */
export async function requestBiometricUnlock(): Promise<UnlockOutcome> {
  if (!(await biometricEnabled())) return { ok: true, reason: "not_required" };
  const status = await biometricStatus();
  if (status !== "available") {
    nativeLog("biometrics", "unavailable_for_unlock", { status });
    return { ok: false, reason: status === "not_enrolled" ? "not_enrolled" : "unavailable" };
  }
  try {
    await BiometricAuth.authenticate({
      reason: "Desbloqueie para acessar seus dados financeiros",
      cancelTitle: "Usar login",
      allowDeviceCredential: true,
      androidTitle: "Desbloquear Meu Nino",
    });
    return { ok: true, reason: "authenticated" };
  } catch (error) {
    const code = error instanceof BiometryError ? error.code : undefined;
    const cancelled =
      code === BiometryErrorType.userCancel ||
      code === BiometryErrorType.appCancel ||
      code === BiometryErrorType.systemCancel ||
      code === BiometryErrorType.userFallback;
    nativeLog("biometrics", cancelled ? "unlock_cancelled" : "unlock_failed", { code });
    return { ok: false, reason: cancelled ? "cancelled" : "failed" };
  }
}
