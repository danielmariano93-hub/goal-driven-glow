import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield, UserPlus, UserMinus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { can, roleLabel, type PlatformRole } from "@/lib/admin/permissions";
import { PageHeader } from "@/components/admin/PageHeader";
import { Section } from "@/components/admin/Section";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonTable } from "@/components/admin/AdminSkeleton";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { adminToast } from "@/components/admin/adminToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Admin = {
  user_id: string;
  email: string;
  display_name: string | null;
  role: PlatformRole;
  active: boolean;
  created_at: string;
};

type AuditRow = { id: string; created_at: string; action: string; meta: unknown };

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
      return (data ?? []) as AuditRow[];
    },
  });

  async function onGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    const { data, error } = await supabase.rpc("admin_users_list", { p_search: targetEmail, p_limit: 5, p_offset: 0 });
    if (error) { adminToast.fromError(error, "Não foi possível concluir a busca"); return; }
    const match = (data as Array<{ user_id: string; email: string }>)?.find((r) => r.email?.toLowerCase() === targetEmail.toLowerCase());
    if (!match) { adminToast.warn("Usuário não encontrado", { description: "Confira o e-mail exatamente como está cadastrado." }); return; }
    const { error: gErr } = await supabase.rpc("grant_platform_admin", { _target: match.user_id, _role: role });
    if (gErr) { adminToast.fromError(gErr, "Não foi possível conceder acesso"); return; }
    adminToast.success(`Concedido: ${roleLabel(role)}`);
    setTargetEmail("");
    qc.invalidateQueries({ queryKey: ["platform_admins"] });
    qc.invalidateQueries({ queryKey: ["platform_audit"] });
  }

  async function onRevoke(userId: string) {
    if (!canManage) return;
    const { error } = await supabase.rpc("revoke_platform_admin", { _target: userId });
    if (error) { adminToast.fromError(error, "Não foi possível revogar"); return; }
    adminToast.success("Acesso revogado");
    qc.invalidateQueries({ queryKey: ["platform_admins"] });
    qc.invalidateQueries({ queryKey: ["platform_audit"] });
  }

  const adminCols: Column<Admin>[] = [
    { key: "name", header: "Nome", cell: (a) => a.display_name ?? "—" },
    { key: "email", header: "E-mail", cell: (a) => <span className="font-mono text-xs text-muted-foreground">{a.email}</span> },
    { key: "role", header: "Papel", cell: (a) => <Badge variant="secondary">{roleLabel(a.role)}</Badge> },
    {
      key: "status",
      header: "Status",
      cell: (a) => a.active
        ? <Badge className="bg-success/15 text-success border-success/30">Ativo</Badge>
        : <Badge variant="secondary">Inativo</Badge>,
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      cell: (a) => canManage && a.active ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
              <UserMinus size={12} /> Revogar
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revogar acesso administrativo?</AlertDialogTitle>
              <AlertDialogDescription>Este usuário perde acesso ao painel imediatamente.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => onRevoke(a.user_id)}>Revogar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null,
    },
  ];

  const auditCols: Column<AuditRow>[] = [
    { key: "date", header: "Data", cell: (r) => <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-BR")}</span> },
    { key: "action", header: "Ação", cell: (r) => r.action },
    { key: "meta", header: "Detalhes", hideOnMobile: true, cell: (r) => <span className="font-mono text-[11px] text-muted-foreground break-words">{JSON.stringify(r.meta)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Segurança"
        description="Administradores da plataforma, auditoria e permissões. Apenas Platform Owner concede ou revoga."
      />

      {canManage && (
        <Section title="Conceder acesso" icon={UserPlus} description="A busca é feita por e-mail exato do cadastro.">
          <form onSubmit={onGrant} className="surface-card p-4 grid gap-3 md:grid-cols-[1fr_200px_140px] md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="grant-email">E-mail do usuário</Label>
              <Input id="grant-email" type="email" autoComplete="off" required value={targetEmail} onChange={(e) => setTargetEmail(e.target.value)} placeholder="pessoa@empresa.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grant-role">Papel</Label>
              <Select value={role} onValueChange={(v) => setRole(v as PlatformRole)}>
                <SelectTrigger id="grant-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="platform_owner">Platform Owner</SelectItem>
                  <SelectItem value="platform_admin">Platform Admin</SelectItem>
                  <SelectItem value="support">Suporte</SelectItem>
                  <SelectItem value="analyst">Analista</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit">Conceder</Button>
          </form>
        </Section>
      )}

      <Section title="Administradores" icon={Shield}>
        {q.isLoading ? <SkeletonTable rows={4} /> : !q.data?.length
          ? <EmptyState icon={Shield} title="Nenhum admin cadastrado" />
          : <DataTable rows={q.data} columns={adminCols} rowKey={(a) => a.user_id} ariaLabel="Administradores" />}
      </Section>

      <Section title="Auditoria (últimas 50)" description="Cada ação administrativa fica registrada.">
        {audit.isLoading ? <SkeletonTable rows={4} /> : !audit.data?.length
          ? <EmptyState title="Sem eventos de auditoria" />
          : <DataTable rows={audit.data} columns={auditCols} rowKey={(r) => r.id} ariaLabel="Auditoria" />}
      </Section>
    </div>
  );
}
