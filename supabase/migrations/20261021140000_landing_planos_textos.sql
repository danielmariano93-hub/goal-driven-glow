-- Textos das funcionalidades em linguagem de usuário (editáveis no admin).
update public.landing_plan_features set label='Registre seus gastos e ganhos', description='Anote entradas e saídas e organize contas e cartões.' where key='lancamentos';
update public.landing_plan_features set label='Saiba para onde o dinheiro vai', description='Categorias e relatórios do seu mês, sem planilha.' where key='categorias';
update public.landing_plan_features set label='Metas de gasto', description='Defina um teto por categoria, como Lazer, e veja se está no ritmo.' where key='metas';
update public.landing_plan_feature_values v set note='até 3 metas' from public.landing_plans p, public.landing_plan_features f where v.plan_id=p.id and v.feature_id=f.id and p.slug='gratis' and f.key='metas';
update public.landing_plan_features set label='Converse com o Nino no app', description='Pergunte “quanto gastei com mercado?” e receba a resposta na hora.' where key='nino_app';
update public.landing_plan_feature_values v set note='algumas perguntas por dia' from public.landing_plans p, public.landing_plan_features f where v.plan_id=p.id and v.feature_id=f.id and p.slug='gratis' and f.key='nino_app';
update public.landing_plan_features set label='Registre pelo WhatsApp', description='Mande texto, áudio ou foto da nota e o Nino lança para você.' where key='whatsapp';
update public.landing_plan_features set label='Importe extrato e fatura', description='Envie PDF, OFX ou foto: o Nino lê, categoriza e você só confere.' where key='assessor';
update public.landing_plan_features set label='Avisos antes de o mês apertar', description='O Nino percebe gasto fora do ritmo e avisa a tempo de agir.' where key='proativo';
update public.landing_plan_feature_values v set note='avisos básicos' from public.landing_plans p, public.landing_plan_features f where v.plan_id=p.id and v.feature_id=f.id and p.slug='gratis' and f.key='proativo';
update public.landing_plan_features set label='Mapa Financeiro', description='Um retrato da sua saúde financeira: equilíbrio, segurança e futuro.' where key='mapa';
update public.landing_plan_feature_values v set note='versão resumida' from public.landing_plans p, public.landing_plan_features f where v.plan_id=p.id and v.feature_id=f.id and p.slug='gratis' and f.key='mapa';
update public.landing_plan_features set label='Hábitos e metas que aprendem', description='Entende seus padrões e diz se um ajuste de meta valeu a pena.' where key='habitos';
update public.landing_plan_features set label='Divisão de contas com amigos', description='Rachou o jantar? O Nino divide, acompanha quem pagou e cobra por você.' where key='role';
update public.landing_plan_feature_values v set note='1 divisão por mês' from public.landing_plans p, public.landing_plan_features f where v.plan_id=p.id and v.feature_id=f.id and p.slug='gratis' and f.key='role';
update public.landing_plan_features set label='Conecte seus bancos', description='Suas transações entram sozinhas, direto do banco (Open Finance).' where key='open_finance';
update public.landing_plan_features set label='Atualização automática', description='Tudo atualizado todo dia, sem você precisar lançar nada.' where key='sync_auto';
