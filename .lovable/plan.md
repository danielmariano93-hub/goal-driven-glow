# Plano fechado — Nova Home Meu Nino com verdade financeira única

## Objetivo

Entregar a nova Home como superfície decisional do Meu Nino, fiel à referência visual obrigatória e sustentada por um único contrato financeiro auditável para App, Relatórios, Nino, Assessor e WhatsApp.

A sequência narrativa será:

```text
agora → ação → orientação → comportamento → futuro
```

Não haverá publicação em produção sem autorização explícita.

## Diagnóstico confirmado

- O cálculo canônico atual já inclui dias sem gasto no denominador e possui testes para isso (`spendingRhythm.ts` e `spending-projection-v5.test.ts`). Essa regra será preservada, não reimplementada.
- Home e Relatórios já usam `computeFinancialSnapshot`, mas a Home ainda monta o snapshot no cliente a partir de 14 consultas; Assessor/WhatsApp usam um adaptador Edge separado. A fórmula compartilhada existe, porém o contrato de leitura e a proveniência ainda não são únicos.
- O banco já tem `financial_daily_facts` e `financial_current_snapshots`; o snapshot persistido atual é resumido e não contém ritmo, projeção, exposição de cartão, composição, fontes ausentes e evidências suficientes para a nova Home.
- O snapshot do app expõe `contractVersion`, versões de fórmula, confiança da projeção e disponibilidade parcial, mas não oferece um envelope completo e uniforme com `generated_at`, `as_of`, `period`, `source freshness`, `completeness`, `confidence` e `evidence` por métrica.
- O banco usa `numeric(14,2)`, mas o núcleo TypeScript calcula com `number` e arredondamento final. Valores críticos da nova composição serão normalizados em centavos inteiros nas fronteiras do contrato.
- A comparação de ritmo e a projeção atuais são apropriadas para o período em andamento; períodos históricos encerrados precisam de semântica explícita para não mostrar “projeção futura” indevida.
- O layout atual preserva a resiliência parcial, mas Hero, gráfico de ritmo, projeção, hierarquia, tipografia e densidade visual divergem da referência anexada.
- O modo privacidade já persiste por usuário e atravessa `formatBRL`; a nova Home precisa manter todos os valores, gráficos, tooltips e detalhes protegidos pela mesma preferência.

## Entrega única

### 1. Congelar o contrato financeiro v6

Criar `financial_snapshot_contract.v6` como envelope canônico:

- `contract_version`, `formula_versions`, `timezone: America/Sao_Paulo`;
- `generated_at`, `as_of`, `period.start`, `period.end`, `period.status` (`open` ou `closed`);
- `completeness`, `confidence`, `missing_sources`, `source_freshness`;
- saldo disponível e sua composição;
- entradas confirmadas, compromissos conhecidos e exposição de cartão sem dupla contagem;
- ritmo atual, ritmo típico, período comparável e séries diárias com dias zerados;
- projeção de consumo e fechamento, com premissas/evidências;
- ponte de caixa e metadados necessários para explicação do Nino.

Regras obrigatórias:

- saldo de conta segue caixa (`posted_at` com precedência já definida);
- consumo segue competência econômica (`occurred_at`);
- compra no cartão entra no consumo; pagamento de fatura não entra novamente;
- fatura oficial prevalece sobre estimativa e toda estimativa é rotulada;
- transferências, investimentos, empréstimos e estornos preservam a semântica já consolidada;
- período aberto projeta somente os dias restantes; período encerrado exibe realizado e comparação, sem futuro fictício;
- recorrências ausentes ou fonte complementar indisponível reduzem a completude e nunca viram `R$ 0,00` silencioso;
- somas, subtrações e invariantes monetários críticos operam em centavos inteiros; formatação ocorre apenas na apresentação.

### 2. Tornar a leitura realmente única

Implementar uma migração aditiva para evoluir a camada financeira existente sem apagar histórico:

- ampliar o read model canônico para armazenar/servir o payload v6 e sua proveniência;
- criar uma função autenticada de leitura por período e data de referência;
- manter RLS por `auth.uid()`, `GRANT SELECT/EXECUTE` apenas aos papéis necessários e acesso operacional ao `service_role`;
- preservar `financial_daily_facts` como fatos derivados e `transactions`, saldos, faturas e recorrências como fontes primárias;
- usar a feature flag financeira já existente para shadow-read e rollback instantâneo;
- registrar divergências entre v5 e v6 antes do corte.

Refatorar o adaptador de dados para que Home, Relatórios, geração de relatórios, insights, Nino, tools do Assessor/MCP e WhatsApp recebam o mesmo envelope v6. O núcleo canônico continuará em `src/lib/engine/*`, sincronizado mecanicamente para `_shared/finance-core/*`; adaptadores não poderão recriar fórmulas.

### 3. Endurecer fórmulas e períodos

No núcleo financeiro:

- consolidar a janela observada como `period.start…min(period.end, as_of)`;
- materializar todos os dias, inclusive sem gasto;
- separar claramente média total líquida, despesa bruta e ritmo típico variável;
- manter comparação com janela anterior do mesmo tamanho;
- impedir projeção quando o período estiver encerrado;
- projetar consumo variável somente a partir da base elegível, sem reprojetar fixas já realizadas;
- incluir entradas e compromissos futuros apenas uma vez;
- expor `reason codes`, confiança e premissas para cada estado parcial/estimado;
- validar invariantes de composição: componentes fecham exatamente o saldo/projeção exibidos.

Os espelhos Edge serão gerados pelo script existente e protegidos pelo teste de paridade.

### 4. Reconstruir a Home conforme a referência

Reorquestrar `Index.tsx` e criar componentes focados, sem alterar landing page, autenticação ou identidade oficial:

1. **Cabeçalho e período** — saudação compacta, olho de privacidade e notificações; período evidente e compartilhado com Relatórios.
2. **Hero “Disponível”** — gradiente oficial profundo/violeta/coral, valor dominante, estado de qualidade dos dados e CTA “Ver composição”. Nada de valor falso quando a fonte estiver incompleta.
3. **Composição** — detalhe acessível em sheet no mobile e painel adaptado no desktop, mostrando saldo, entradas, compromissos, faturas e consumo projetado com a equação fechada.
4. **Ações rápidas** — registrar entrada/saída e acesso ao Assessor sem competir com o Hero; manter o FAB global e evitar sobreposição com a barra inferior.
5. **Orientação do Nino** — um diagnóstico principal, contrapeso quando existir, ação contextual real e evidências expansíveis; sem duplicar metodologia na superfície.
6. **Ritmo** — gráfico responsivo com linha atual sólida, referência comparável tracejada, dias zerados, legendas, tooltip privado e resumo textual factual.
7. **Previsão de fechamento** — novo card com dois blocos legíveis (“Dinheiro livre” e “Consumo”), intervalo/premissas, confiança e estado específico para período encerrado.
8. **Check-in emocional** — manter a função existente, compactar a primeira leitura e preservar edição/associação com gasto.

Aplicar somente na Home a tipografia Manrope/Inter e o grid de 4 px definidos na referência; preservar a DM Sans e os assets oficiais nas demais superfícies. Usar tokens semânticos, Phosphor Icons, contraste AA, foco visível, alvos mínimos de 44 px e `prefers-reduced-motion`.

### 5. Estados de produto completos

Implementar e testar, por bloco e não apenas por página:

- carregamento estável sem mudança de layout;
- vazio inicial com CTA para cadastrar conta ou primeiro lançamento, sem mock data;
- parcial com o dado confiável disponível e aviso localizado;
- fonte crítica indisponível com retry;
- dados desatualizados com horário de atualização;
- valor estimado versus oficial;
- privacidade ligada em textos, eixos, tooltip e acessibilidade;
- período atual, mês anterior, 30/90 dias e personalizado;
- saldos negativos e projeções negativas sem eufemismo visual.

### 6. Testes, auditoria e rollout

Adicionar uma matriz de testes:

- unitários para centavos, dias zerados, virada de mês/ano, timezone, estorno, cartão, recorrências, período fechado e dupla contagem;
- contract tests App ↔ Edge ↔ read model e teste de paridade dos espelhos;
- testes de resiliência para cada fonte crítica/complementar;
- testes de composição garantindo soma exata dos valores exibidos;
- testes de privacidade e acessibilidade;
- integração da Home e Relatórios consumindo o mesmo snapshot;
- Playwright em 375×812, 768×1024 e 1280×1800, incluindo abertura dos detalhes, troca de período, olho, tooltip e FAB;
- comparação visual com a referência anexada e revisão de overflow, contraste e hierarquia.

Rollout:

1. gerar v6 em shadow mode;
2. comparar v5/v6 por usuário e métrica, com tolerância de R$ 0,01 apenas para arredondamento;
3. liberar internamente via feature flag;
4. validar App, Relatórios, Nino, Assessor e WhatsApp;
5. promover a leitura v6;
6. manter rollback pela flag e não remover v5 nesta entrega.

## Arquivos e áreas principais

- Núcleo: `src/lib/engine/{facts,spendingRhythm,metrics,bridges,cardExposure}.ts`
- Dinheiro/proveniência: novos utilitários pequenos em `src/lib/engine/`
- Dados: `src/lib/hooks/useFinancialSnapshot.ts`, query keys e invalidação central
- Espelho multicanal: `scripts/sync-finance-core.mjs`, `_shared/finance-core`, `_shared/engine/metrics.ts` e consumidores Edge
- Home: `src/pages/Index.tsx`, `HeroDisponivelCard`, `RitmoUnificadoCard`, `NinoGuidanceCard`, `AvailableBalanceDetails`, `EmotionalCheckinCard` e novo `PrevisaoFechamentoCard`
- Layout/tokens: escopo Home em `AppLayout`, `src/index.css` e `tailwind.config.ts`
- Backend: uma migration aditiva para contrato/read model/função/flag/grants/RLS
- Testes: suítes financeiras existentes mais testes de contrato, resiliência, composição e E2E

## Critérios de aceite

- O mesmo período devolve os mesmos valores e versões de fórmula em Home, Relatórios, Nino, Assessor e WhatsApp.
- Média e gráfico incluem dias sem gasto; a janela comparável tem o mesmo número de dias.
- Nenhuma soma monetária exibida diverge mais de um centavo de seus componentes.
- Período encerrado nunca aparece como previsão em andamento.
- Fonte ausente nunca é mascarada como zero.
- Fatura, pagamento, parcelas futuras e consumo do cartão não são confundidos nem duplicados.
- Todos os valores desaparecem com o olho de privacidade, inclusive em gráficos e detalhes.
- A Home corresponde à referência em hierarquia, tipografia, paleta, espaçamento e comportamento responsivo.
- Não há dados fictícios, regressão nas rotas existentes nem publicação automática.