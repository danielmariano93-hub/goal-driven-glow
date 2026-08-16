import type { Session } from "@supabase/supabase-js";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { BiometricAuth } from "@aparajita/capacitor-biometric-auth";
import { isNativePlatform } from "./platform";

const SESSION_KEY = "meunino.auth.session";
const BIOMETRIC_KEY = "meunino.biometric.enabled";

export async function persistNativeSession(session: Session | null): Promise<void> {
  if (!isNativePlatform()) return;
  if (session) await SecureStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else await SecureStorage.removeItem(SESSION_KEY);
}

export async function restoreNativeSession(): Promise<Session | null> {
  if (!isNativePlatform()) return null;
  const value = await SecureStorage.getItem(SESSION_KEY);
  if (!value) return null;
  try { return JSON.parse(value) as Session; } catch { return null; }
}

export async function biometricAvailability(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  const result = await BiometricAuth.checkBiometry();
  return result.isAvailable && result.deviceIsSecure;
}

export async function biometricEnabled(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  return (await SecureStorage.getItem(BIOMETRIC_KEY)) === "true";
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

export async function unlockWithBiometrics(): Promise<boolean> {
  if (!(await biometricEnabled())) return true;
  try {
    await BiometricAuth.authenticate({
      reason: "Desbloqueie para acessar seus dados financeiros",
      cancelTitle: "Usar login",
      allowDeviceCredential: true,
      androidTitle: "Desbloquear Meu Nino",
    });
    return true;
  } catch { return false; }
}