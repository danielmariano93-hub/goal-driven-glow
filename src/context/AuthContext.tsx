import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { PlatformRole } from "@/lib/admin/permissions";
import {
  clearNativeSession,
  persistNativeSession,
  requestBiometricUnlock,
  restoreNativeSession,
} from "@/lib/native/session";
import { isNativePlatform } from "@/lib/native/platform";
import { nativeLog } from "@/lib/native/logSanitizer";

export type Profile = {
  id: string;
  display_name: string | null;
  onboarding_completed_at: string | null;
  timezone: string;
  currency: string;
};

export type AppRole = "admin" | "user";

type AuthStatus = "loading" | "ready" | "error";

type AuthContextValue = {
  status: AuthStatus;
  loading: boolean;
  authError: string | null;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  roles: AppRole[];
  isFinancialUser: boolean;
  platformRole: PlatformRole | null;
  isPlatformAdmin: boolean;
  recovering: boolean;
  /** App nativo: sessão válida, porém aguardando desbloqueio biométrico. */
  locked: boolean;
  lockReason: "cancelled" | "failed" | "unavailable" | "not_enrolled" | null;
  unlock: () => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    displayName: string
  ) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
  retryProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchProfileAndRoles(userId: string): Promise<{
  profile: Profile | null;
  roles: AppRole[];
  platformRole: PlatformRole | null;
}> {
  const [profileRes, rolesRes, platformRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, onboarding_completed_at, timezone, currency")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.rpc("current_platform_admin_role"),
  ]);
  if (profileRes.error) throw profileRes.error;
  if (rolesRes.error) throw rolesRes.error;
  const profile = (profileRes.data as Profile | null) ?? null;
  const roles = ((rolesRes.data as { role: AppRole }[] | null) ?? []).map((r) => r.role);
  const platformRole = (!platformRes.error && platformRes.data
    ? (platformRes.data as PlatformRole)
    : null);
  return { profile, roles, platformRole };
}

function friendlyAuthError(message: string | undefined): string {
  if (!message) return "Não foi possível concluir a operação. Tente novamente.";
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "E-mail ou senha inválidos.";
  if (m.includes("email not confirmed")) return "Confirme seu e-mail antes de entrar.";
  if (m.includes("user already registered")) return "Este e-mail já está cadastrado.";
  if (m.includes("password")) return "Senha inválida ou insegura.";
  if (m.includes("rate limit")) return "Muitas tentativas. Aguarde alguns minutos.";
  return "Não foi possível concluir a operação. Tente novamente.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [authError, setAuthError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [platformRole, setPlatformRole] = useState<PlatformRole | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockReason, setLockReason] = useState<AuthContextValue["lockReason"]>(null);
  const lastUserIdRef = useRef<string | null>(null);

  const hydrateProfile = async (uid: string) => {
    setAuthError(null);
    try {
      let { profile, roles, platformRole } = await fetchProfileAndRoles(uid);
      if (!profile && !platformRole) {
        // Self-heal: legacy accounts may lack profile row (financial users only)
        await supabase.rpc("ensure_profile");
        const again = await fetchProfileAndRoles(uid);
        profile = again.profile;
        roles = again.roles;
        platformRole = again.platformRole;
      }
      setProfile(profile);
      setRoles(roles);
      setPlatformRole(platformRole);
      setStatus("ready");
    } catch (e) {
      console.error("[auth] hydrate profile failed", e);
      setAuthError("Não conseguimos carregar sua conta. Verifique sua conexão.");
      setStatus("error");
    }
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      void persistNativeSession(newSession);
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (event === "PASSWORD_RECOVERY") {
        setRecovering(true);
        return;
      }

      const uid = newSession?.user?.id ?? null;
      if (uid && uid !== lastUserIdRef.current) {
        lastUserIdRef.current = uid;
        setStatus("loading");
        setTimeout(() => hydrateProfile(uid), 0);
      } else if (!uid) {
        lastUserIdRef.current = null;
        setProfile(null);
        setRoles([]);
        setPlatformRole(null);
        setStatus("ready");
      }
    });

    supabase.auth.getSession().then(async ({ data }) => {
      let activeSession = data.session;
      if (!activeSession && isNativePlatform()) {
        const stored = await restoreNativeSession().catch(() => null);
        if (stored?.access_token && stored.refresh_token) {
          const restored = await supabase.auth.setSession({ access_token: stored.access_token, refresh_token: stored.refresh_token });
          activeSession = restored.data.session;
        }
      }
      if (activeSession) {
        // Cancelar/falhar a biometria NÃO derruba a sessão: entramos em estado bloqueado.
        const outcome = await requestBiometricUnlock();
        if (!outcome.ok) {
          nativeLog("auth", "session_locked", { reason: outcome.reason });
          setLocked(true);
          setLockReason(outcome.reason as AuthContextValue["lockReason"]);
        }
      }
      setSession(activeSession);
      setUser(activeSession?.user ?? null);
      if (activeSession?.user) {
        lastUserIdRef.current = activeSession.user.id;
        await hydrateProfile(activeSession.user.id);
      } else {
        setStatus("ready");
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      loading: status === "loading",
      authError,
      session,
      user,
      profile,
      roles,
      isFinancialUser: roles.includes("user"),
      platformRole,
      isPlatformAdmin: !!platformRole,
      recovering,
      locked,
      lockReason,
      async unlock() {
        const outcome = await requestBiometricUnlock();
        if (outcome.ok) {
          setLocked(false);
          setLockReason(null);
          return true;
        }
        setLockReason(outcome.reason as AuthContextValue["lockReason"]);
        return false;
      },
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error ? friendlyAuthError(error.message) : null };
      },
      async signUp(email, password, displayName) {
        const redirectTo = `${window.location.origin}/app`;
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectTo,
            data: { display_name: displayName },
          },
        });
        if (error) return { error: friendlyAuthError(error.message), needsEmailConfirmation: false };
        const needsEmailConfirmation = !data.session;
        return { error: null, needsEmailConfirmation };
      },
      async signOut() {
        await supabase.auth.signOut();
        await clearNativeSession();
        setProfile(null);
        setRoles([]);
        setPlatformRole(null);
        setRecovering(false);
        setLocked(false);
        setLockReason(null);
      },
      async requestPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        return { error: error ? friendlyAuthError(error.message) : null };
      },
      async updatePassword(newPassword) {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (!error) setRecovering(false);
        return { error: error ? friendlyAuthError(error.message) : null };
      },
      async refreshProfile() {
        if (user?.id) await hydrateProfile(user.id);
      },
      async retryProfile() {
        if (user?.id) {
          setStatus("loading");
          await hydrateProfile(user.id);
        }
      },
    }),
    [status, authError, session, user, profile, roles, platformRole, recovering, locked, lockReason]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
