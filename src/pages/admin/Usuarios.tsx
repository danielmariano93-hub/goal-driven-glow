import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Users, ShieldCheck, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { SkeletonTable } from "@/components/admin/AdminSkeleton";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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

function useDebounced<T>(value: T, delay = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function Usuarios() {
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 250);

  const q = useQuery({
    queryKey: ["admin_users", debounced],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_users_list", {
        p_search: debounced || null,
        p_limit: 100,
        p_offset: 0,
      });
      if (error) throw error;
      return (data as Row[]) ?? [];
    },
  });

  const columns = useMemo<Column<Row>[]>(() => [
    {
      key: "name",
      header: "Nome",
      cell: (r) => <span className="font-medium">{r.display_name ?? "—"}</span>,
    },
    {
      key: "email",
      header: "E-mail",
      cell: (r) => <span className="font-mono text-xs text-muted-foreground">{mask(r.email)}</span>,
    },
    {
      key: "created",
      header: "Cadastro",
      cell: (r) => <span className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString("pt-BR")}</span>,
    },
    {
      key: "onboarding",
      header: "Onboarding",
      cell: (r) => r.onboarding_completed_at
        ? <Badge className="bg-success/15 text-success border-success/30">Concluído</Badge>
        : <Badge variant="secondary">Pendente</Badge>,
    },
    {
      key: "whatsapp",
      header: "WhatsApp",
      hideOnMobile: true,
      cell: (r) => r.whatsapp_linked
        ? <span className="inline-flex items-center gap-1 text-xs"><MessageCircle size={12} className="text-success" />Vinculado</span>
        : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      key: "role",
      header: "Papel",
      cell: (r) => r.is_platform_admin
        ? <Badge className="bg-primary/15 text-primary border-primary/30 gap-1"><ShieldCheck size={10} />Admin</Badge>
        : <Badge variant="secondary">Usuário</Badge>,
    },
  ], []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuários"
        description="Dados de cadastro e ativação apenas. Nunca exibimos transações, valores ou descrições individuais."
      />

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          autoComplete="off"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por e-mail ou nome"
          className="pl-9"
          aria-label="Buscar usuários"
        />
      </div>

      {q.isLoading ? (
        <SkeletonTable rows={6} />
      ) : q.error ? (
        <EmptyState title="Não foi possível carregar" description="Verifique suas permissões e tente novamente." />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState
          icon={Users}
          title={debounced ? "Nenhum usuário para esta busca" : "Nenhum usuário por aqui ainda"}
          description={debounced ? "Confira a grafia ou tente outro termo." : "Quando alguém entrar no MeuNino e ativar o perfil financeiro, aparece aqui."}
        />
      ) : (
        <DataTable rows={q.data} columns={columns} rowKey={(r) => r.user_id} ariaLabel="Lista de usuários" />
      )}

      <p className="text-[11px] text-muted-foreground">
        Ações como suspender, redefinir senha ou processar exclusão serão adicionadas a partir de fluxos auditados.
        Nesta versão não é possível &quot;entrar como usuário&quot; nem visualizar dados financeiros individuais.
      </p>
    </div>
  );
}
