-- Meu Nino P2+P3 — conteúdo inicial do workspace de Comunicações.
-- Migração aditiva e idempotente: preserva templates personalizados.

WITH curated(kind, channel, title_template, body_template) AS (
  VALUES
    ('categorize_transaction', 'app',
      'Vamos organizar esse gasto?',
      E'{{body}}\n\nLeva poucos segundos para categorizar e deixar sua visão mais fiel.'),
    ('duplicate_expense', 'app',
      'Esse gasto apareceu duas vezes',
      E'{{body}}\n\nDê uma olhada e confirme se foram duas compras diferentes.'),
    ('duplicate_expense', 'whatsapp',
      'Rapidinho: esse gasto está certo?',
      E'{{body}}\n\nSe forem compras diferentes, é só confirmar. Se não, o Nino ajuda a ajustar.'),
    ('goal_at_risk', 'app',
      'Sua meta pediu um pouco de atenção',
      E'{{body}}\n\nVeja o que mudou e escolha um próximo passo possível para hoje.'),
    ('goal_at_risk', 'whatsapp',
      'Vamos cuidar da sua meta?',
      E'{{body}}\n\nAbra o Meu Nino para ver uma sugestão simples de ajuste.'),
    ('spending_spike', 'app',
      'Um gasto saiu do seu ritmo',
      E'{{body}}\n\nPode estar tudo certo — vale conferir para manter sua leitura realista.'),
    ('spending_spike', 'whatsapp',
      'Notei algo diferente nos seus gastos',
      E'{{body}}\n\nSem bronca: confira no Meu Nino se esse movimento faz sentido.'),
    ('forgotten_bill', 'app',
      'Tem uma conta pedindo atenção',
      E'{{body}}\n\nConfira o vencimento e marque como resolvida quando pagar.'),
    ('forgotten_bill', 'whatsapp',
      'Lembrete leve de uma conta',
      E'{{body}}\n\nSe você já resolveu, pode desconsiderar e atualizar no Meu Nino.'),
    ('engagement_drop', 'app',
      'Que tal colocar o Nino em dia?',
      E'{{body}}\n\nRegistre o que ficou para trás e retome de onde parou.'),
    ('recurring_pattern', 'app',
      'Isso parece acontecer todo mês',
      E'{{body}}\n\nTransforme em recorrência para não precisar registrar sempre.'),
    ('saving_opportunity', 'app',
      'Encontrei uma chance de economizar',
      E'{{body}}\n\nVeja a sugestão e decida se ela combina com sua rotina.'),
    ('underused_subscription', 'app',
      'Essa assinatura ainda faz sentido?',
      E'{{body}}\n\nConfira o uso antes de decidir manter ou cancelar.'),
    ('emotional_spending', 'app',
      'Seus gastos contam uma história',
      E'{{body}}\n\nObserve o padrão com curiosidade, sem julgamento.'),
    ('impulsive_spending', 'app',
      'Muitos gastos em pouco tempo',
      E'{{body}}\n\nUma pausa rápida agora pode ajudar nas próximas escolhas.'),
    ('financial_procrastination', 'app',
      'Vamos tirar uma pendência do caminho?',
      E'{{body}}\n\nEscolha uma ação pequena para avançar hoje.'),
    ('financial_discipline', 'app',
      'Boa: você manteve o ritmo',
      E'{{body}}\n\nConsistência vale mais que perfeição. Continue assim.'),
    ('relapse_risk', 'app',
      'Seu ritmo mudou um pouco',
      E'{{body}}\n\nSem culpa: confira o que aconteceu e escolha como retomar.'),
    ('advisor_review_weekly', 'app',
      'Seu resumo da semana está pronto',
      E'{{body}}\n\nVeja os principais movimentos e o que merece atenção.'),
    ('advisor_review_monthly', 'app',
      'Seu fechamento do mês chegou',
      E'{{body}}\n\nConfira avanços, mudanças de ritmo e próximos passos.')
),
eligible AS (
  SELECT
    c.*,
    coalesce((
      SELECT max(t.version)
      FROM public.communication_templates t
      WHERE t.kind = c.kind AND t.channel = c.channel
    ), 0) + 1 AS next_version
  FROM curated c
  WHERE EXISTS (
    SELECT 1
    FROM public.communication_catalog catalog
    WHERE catalog.kind = c.kind
      AND c.channel = ANY(catalog.allowed_channels)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.communication_templates current_template
    WHERE current_template.kind = c.kind
      AND current_template.channel = c.channel
      AND current_template.title_template = c.title_template
      AND current_template.body_template = c.body_template
  )
),
deactivated AS (
  UPDATE public.communication_templates current_template
     SET active = false,
         updated_at = now()
   WHERE current_template.active
     AND EXISTS (
       SELECT 1 FROM eligible e
       WHERE e.kind = current_template.kind
         AND e.channel = current_template.channel
     )
  RETURNING current_template.id
)
INSERT INTO public.communication_templates (
  kind,
  channel,
  title_template,
  body_template,
  allowed_variables,
  active,
  version
)
SELECT
  e.kind,
  e.channel,
  e.title_template,
  e.body_template,
  ARRAY[
    'title','body','kind','severity','dedup_key','action_url',
    'amount','count','description','remaining','days_left','monthly_needed',
    'category','share','current','avg','due','occurred_at'
  ]::text[],
  true,
  e.next_version
FROM eligible e;

COMMENT ON TABLE public.communication_templates IS
  'Templates versionados para app e WhatsApp. Conteúdo inicial P2+P3 preserva versões personalizadas e ativa apenas uma versão por caso de uso/canal.';
