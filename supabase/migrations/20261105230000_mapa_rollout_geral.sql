-- Rollout do Mapa Financeiro para todos (decisão do dono, 05/11/2026): o Mapa foi testado na conta dona e substitui as telas
-- anteriores de hábitos/emoções em /app/mapa.
--
-- Como funciona (reversível em uma linha):
--   - A linha da conta em `mapa_access` continua VENCENDO (true liga, false desliga aquela conta).
--   - Sem linha, vale a chave geral `agent_runtime_flags.mapa_financeiro_default`.
--   - Esta migração só CRIA a chave, DESLIGADA: nada muda para ninguém até alguém ligar a chave.
--   Ligar:     update public.agent_runtime_flags set enabled = true,  updated_at = now() where flag_name = 'mapa_financeiro_default';
--   Desligar:  update public.agent_runtime_flags set enabled = false, updated_at = now() where flag_name = 'mapa_financeiro_default';
-- O servidor (`mapaAccess`, `mapaUserIds` em `_shared/mapa/runtime.ts`) segue a mesma regra.

insert into public.agent_runtime_flags (flag_name, enabled, description, rollout_percent, pilot_user_ids, updated_at)
values ('mapa_financeiro_default', false, 'Mapa Financeiro para todas as contas sem linha em mapa_access (rollout geral).', 100, '{}', now())
on conflict (flag_name) do nothing;

create or replace function public.mapa_enabled()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select enabled from public.mapa_access where user_id = auth.uid()),
    (select enabled from public.agent_runtime_flags where flag_name = 'mapa_financeiro_default'),
    false
  )
$function$;
