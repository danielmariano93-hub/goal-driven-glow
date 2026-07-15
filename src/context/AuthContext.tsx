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
  isAdmin: boolean;
  recovering: boolean;
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
}> {
  const [profileRes, rolesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, onboarding_completed_at, timezone, currency")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
  ]);
  if (profileRes.error) throw profileRes.error;
  if (rolesRes.error) throw rolesRes.error;
  const profile = (profileRes.data as Profile | null) ?? null;
  const roles = ((rolesRes.data as { role: AppRole }[] | null) ?? []).map((r) => r.role);
  return { profile, roles };
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
  const [recovering, setRecovering] = useState(false);
  const lastUserIdRef = useRef<string | null>(null);

  const hydrateProfile = async (uid: string) => {
    setAuthError(null);
    try {
      let { profile, roles } = await fetchProfileAndRoles(uid);
      if (!profile) {
        // Try to self-heal: some old accounts may lack profile row
        await supabase.rpc("ensure_profile");
        const again = await fetchProfileAndRoles(uid);
        profile = again.profile;
        roles = again.roles;
      }
      setProfile(profile);
      setRoles(roles);
      setStatus("ready");
    } catch (e) {
      console.error("[auth] hydrate profile failed", e);
      setAuthError("Não conseguimos carregar seu perfil. Verifique sua conexão.");
      setStatus("error");
    }
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
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
        setStatus("ready");
      }
    });

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        lastUserIdRef.current = data.session.user.id;
        await hydrateProfile(data.session.user.id);
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
      isAdmin: roles.includes("admin"),
      recovering,
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
        setProfile(null);
        setRoles([]);
        setRecovering(false);
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
    [status, authError, session, user, profile, roles, recovering]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
