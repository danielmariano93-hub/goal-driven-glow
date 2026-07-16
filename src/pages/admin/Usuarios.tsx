import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  user_id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  onboarding_completed_at: string | null;
  last_sign_in_at: string | null;
  whatsapp_linked: boolean;
  is_platform_admin: boolean;
};

function mask(email: string): string {
  const [u, d] = email.split("@");
  if (!d) return email;
  const short = u.length <= 2 ? u : u.slice(0, 2) + "•••";
  return `${short}@${d}`;
}

export default function Usuarios() {
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["admin_users", search],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_users_list", {
        p_search: search || null,
        p_limit: 100,
        p_offset: 0,
      });
      if (error) throw error;
      return (data as Row[]) ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Usuários</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Dados de cadastro e ativação apenas. Nunca exibimos transações, valores ou descrições individuais.
        </p>
      </header>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por e-mail ou nome"
          className="w-full rounded-xl border border-border bg-card px-9 py-2.5 text-sm"
        />
      </div>

      {q.isLoading ? (
        <div className="grid place-items-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : q.error ? (
        <p className="text-sm text-destructive">Não foi possível carregar. Verifique suas permissões.</p>
      ) : !q.data || q.data.length === 0 ? (
        <div className="surface-card p-8 text-center">
          <p className="text-sm font-semibold">Nenhum usuário por aqui ainda</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Quando alguém entrar no NoControle.ia e ativar o perfil financeiro, aparece nesta lista.
          </p>
        </div>

      ) : (
        <div className="surface-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Nome</th>
                <th className="px-4 py-3 text-left">E-mail</th>
                <th className="px-4 py-3 text-left">Cadastro</th>
                <th className="px-4 py-3 text-left">Onboarding</th>
                <th className="px-4 py-3 text-left">WhatsApp</th>
                <th className="px-4 py-3 text-left">Papel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.map((row) => (
                <tr key={row.user_id}>
                  <td className="px-4 py-3 font-medium">{row.display_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{mask(row.email)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(row.created_at).toLocaleDateString("pt-BR")}</td>
                  <td className="px-4 py-3">
                    {row.onboarding_completed_at ? (
                      <span className="rounded-full bg-success/10 text-success text-[10px] px-2 py-0.5">Concluído</span>
                    ) : (
                      <span className="rounded-full bg-muted text-[10px] px-2 py-0.5">Pendente</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{row.whatsapp_linked ? "Sim" : "—"}</td>
                  <td className="px-4 py-3">
                    {row.is_platform_admin ? (
                      <span className="rounded-full bg-primary/10 text-primary text-[10px] px-2 py-0.5">Admin</span>
                    ) : (
                      <span className="rounded-full bg-muted text-[10px] px-2 py-0.5">Usuário</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Ações como suspender, redefinir senha ou processar exclusão serão adicionadas a partir de fluxos auditados.
        Nesta versão não é possível &quot;entrar como usuário&quot; nem visualizar dados financeiros individuais.
      </p>
    </div>
  );
}
