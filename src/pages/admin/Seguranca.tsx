import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Shield, UserPlus, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { can, roleLabel, type PlatformRole } from "@/lib/admin/permissions";
import { useState } from "react";

type Admin = {
  user_id: string;
  email: string;
  display_name: string | null;
  role: PlatformRole;
  active: boolean;
  created_at: string;
};

export default function Seguranca() {
  const { platformRole } = useAuth();
  const qc = useQueryClient();
  const [targetEmail, setTargetEmail] = useState("");
  const [role, setRole] = useState<PlatformRole>("support");

  const canManage = can(platformRole, "security.manage_admins");

  const q = useQuery({
    queryKey: ["platform_admins"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_platform_admins");
      if (error) throw error;
      return (data as Admin[]) ?? [];
    },
  });

  const audit = useQuery({
    queryKey: ["platform_audit"],
    queryFn: async () => {
      const { data, error } = await supabase.from("platform_admin_audit").select("*").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function onGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    // resolver user_id via admin_users_list por e-mail
    const { data, error } = await supabase.rpc("admin_users_list", { p_search: targetEmail, p_limit: 5, p_offset: 0 });
    if (error) { toast.error(error.message); return; }
    const match = (data as any[])?.find((r) => r.email?.toLowerCase() === targetEmail.toLowerCase());
    if (!match) { toast.error("Usuário não encontrado"); return; }
    const { error: gErr } = await supabase.rpc("grant_platform_admin", { _target: match.user_id, _role: role });
    if (gErr) { toast.error(gErr.message); return; }
    toast.success(`Concedido ${roleLabel(role)}`);
    setTargetEmail("");
    qc.invalidateQueries({ queryKey: ["platform_admins"] });
    qc.invalidateQueries({ queryKey: ["platform_audit"] });
  }

  async function onRevoke(userId: string) {
    if (!canManage) return;
    if (!confirm("Revogar acesso administrativo deste usuário?")) return;
    const { error } = await supabase.rpc("revoke_platform_admin", { _target: userId });
    if (error) { toast.error(error.message); return; }
    toast.success("Acesso revogado");
    qc.invalidateQueries({ queryKey: ["platform_admins"] });
    qc.invalidateQueries({ queryKey: ["platform_audit"] });
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Segurança</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Administradores da plataforma, auditoria e permissões. Apenas Platform Owner concede/revoga.
        </p>
      </header>

      {canManage && (
        <div className="surface-card p-5">
          <h2 className="text-sm font-semibold flex items-center gap-2"><UserPlus size={14} /> Conceder acesso</h2>
          <form onSubmit={onGrant} className="mt-3 grid gap-3 md:grid-cols-[1fr_180px_120px]">
            <input value={targetEmail} onChange={(e) => setTargetEmail(e.target.value)} placeholder="E-mail exato do usuário" className="rounded-xl border border-border bg-background px-3 py-2 text-sm" required />
            <select value={role} onChange={(e) => setRole(e.target.value as PlatformRole)} className="rounded-xl border border-border bg-background px-3 py-2 text-sm">
              <option value="platform_admin">Platform Admin</option>
              <option value="support">Suporte</option>
              <option value="analyst">Analista</option>
              <option value="platform_owner">Platform Owner</option>
            </select>
            <button className="rounded-xl bg-primary text-primary-foreground text-sm font-medium py-2.5">Conceder</button>
          </form>
        </div>
      )}

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Shield size={14} className="text-primary" /> Administradores</h2>
        {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty msg="Nenhum admin cadastrado." /> : (
          <div className="surface-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Nome</th>
                  <th className="px-4 py-3 text-left">E-mail</th>
                  <th className="px-4 py-3 text-left">Papel</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {q.data.map((a) => (
                  <tr key={a.user_id}>
                    <td className="px-4 py-3">{a.display_name ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{a.email}</td>
                    <td className="px-4 py-3">{roleLabel(a.role)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] rounded-full px-2 py-0.5 ${a.active ? "bg-success/10 text-success" : "bg-muted"}`}>
                        {a.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManage && a.active && (
                        <button onClick={() => onRevoke(a.user_id)} className="inline-flex items-center gap-1 text-xs text-destructive hover:underline">
                          <UserMinus size={12} /> Revogar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Auditoria (últimas 50 ações)</h2>
        {audit.isLoading ? <Spinner /> : !audit.data?.length ? <Empty msg="Sem eventos de auditoria." /> : (
          <div className="surface-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr><th className="px-4 py-3 text-left">Data</th><th className="px-4 py-3 text-left">Ação</th><th className="px-4 py-3 text-left">Detalhes</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {audit.data.map((row: any) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(row.created_at).toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-3">{row.action}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{JSON.stringify(row.meta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Spinner() { return <div className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>; }
function Empty({ msg }: { msg: string }) { return <div className="surface-card p-8 text-center"><p className="text-sm text-muted-foreground">{msg}</p></div>; }
