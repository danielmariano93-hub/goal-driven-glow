# Novo Painel Admin — menos números, mais decisão

## Diagnóstico do que existe hoje

- **Excesso sem hierarquia:** a Visão geral empilha 6 KPIs em cartões idênticos, um bloco de integridade, um bloco de incidentes e uma série diária — tudo com o mesmo peso visual. Nada diz "olhe aqui primeiro".
- **Abas dentro de abas:** Operações usa `?secao=` e, dentro dela, Nino usa `?aba=` com mais três abas. Chega-se a três níveis de navegação para achar o simulador.
- **Mensageria partida em três lugares:** Comunicações (visão geral, jornadas, mensagens, entregas e regras), WhatsApp dentro de Operações e Configurações dentro de Administração. Configurar um fluxo exige transitar entre eles.
- **Monitoramento por mensagem existe no backend e não tem tela:** as funções `admin_message_activity`, `admin_message_metrics`, `admin_message_timeline` e `admin_message_reprocess` já estão implementadas e o helper de frontend (`src/lib/admin/messageCenter.ts`) não é usado por nenhuma tela. Hoje não há como olhar uma mensagem específica de um cliente e ver o que aconteceu com ela.
- **Editor de templates ilegível:** o formulário de templates está numa única linha gigante de JSX dentro de um painel de 500 linhas, misturado com fila, motor, eficácia e catálogo.
- **Fora do design system:** boa parte do admin usa `bg-white`, `text-neutral-*`, `text-white`, `bg-amber-50` e hex fixos em vez dos tokens semânticos. Quebra tema e consistência.
- **Poucos gráficos:** praticamente tudo é número em cartão. Só a evolução diária tem série temporal.

## O que vamos construir

### 1. Nova arquitetura de informação (5 destinos, sem aba dentro de aba)

```text
Visão geral   → o que exige ação agora + 4 números-chave + tendência
Clientes      → lista, busca, ficha do cliente (com timeline de mensagens dele)
Mensageria    → Fluxos | Mensagens (monitor) | Canais
Nino & IA     → Qualidade | Custo/eficiência | Documentos | Simulador
Administração → Acessos | Auditoria | Configurações
```

"Produto" e "Operações" deixam de ser destinos próprios: os indicadores de produto que sobrevivem entram na Visão geral, e o conteúdo operacional vira o painel de incidentes da Visão geral + a aba Canais da Mensageria. Todas as rotas antigas continuam funcionando via redirecionamento.

### 2. Visão geral que responde três perguntas

1. **Algo está quebrado?** faixa de incidentes no topo, agrupada por severidade, cada item com ação direta (ex.: "reconectar WhatsApp", "reprocessar 12 mensagens").
2. **O negócio está crescendo?** 4 números apenas — clientes ativos, novos no período, uso semanal, custo do assessor — cada um com sparkline e variação vs. período anterior.
3. **Para onde está indo?** um gráfico grande de evolução (clientes x ativação) e um gráfico de entrega de mensagens.

Todo indicador secundário sai dos cartões e passa a viver em "Detalhes técnicos" recolhido no fim da página.

### 3. Mensageria reconstruída (configurar e acompanhar)

**Aba Fluxos** — cada tipo de comunicação como um cartão de fluxo, não linha de tabela: nome em linguagem de negócio, interruptor de ativo, canais (app/WhatsApp) como chips clicáveis, intervalo mínimo e teto diário em campos com passo, e um selo de saúde ("124 enviadas, 92% entregues, 18% geraram ação"). Editar template abre um painel lateral com editor + prévia lado a lado no balão de WhatsApp e validação de variáveis.

**Aba Mensagens** — o monitor que falta: filtro por período, status, canal, fluxo e cliente; lista responsiva (tabela no desktop, cartões no mobile); clique abre a timeline da mensagem (enfileirada → enviada → entregue → lida/falha) com o erro do provedor traduzido e botão de reprocessar. Usa as RPCs já existentes.

**Aba Canais** — estado do WhatsApp (sessão, pareamento, latência, última atividade), fila de saída com fila/falhas, e os jobs de envio com último ciclo e próximo ciclo. Sai a linguagem interna de job e entra "Envio de mensagens", "Vigilância de confirmação" etc.

### 4. Nino & IA

Consolida qualidade das respostas, custo por modelo, eficácia dos insights, documentos/OCR e simulador em quatro abas do mesmo destino, com gráfico de custo diário e de taxa de ação por tipo de insight.

### 5. Camada visual consistente

Um pequeno kit reaproveitado por todas as telas: `MetricTile` (número + variação + sparkline), `TrendChart`, `HealthPill`, `FlowCard`, `SidePanel`, `Timeline`. Todos escritos com tokens semânticos — remoção dos `bg-white`/`text-neutral-*`/hex fixos do admin. Mobile-first: um número por linha no celular, grade de 4 no desktop.

## Detalhes técnicos

- Reuso das RPCs atuais (`admin_v2_cockpit`, `admin_v2_daily_evolution`, `admin_v2_proactive_summary`, `admin_v2_messaging_activity`, `admin_v2_whatsapp_monitor`, `admin_platform_status`, `admin_message_*`, `admin_communication_*`).
- Novas agregações só onde faltar dado: uma RPC de série diária de mensageria (enviadas/entregues/falhas/ação por dia) e uma de comparação com período anterior para as variações dos cartões. Ambas seguem o padrão de envelope e `_require_perm` já usado, com `GRANT` para os papéis de plataforma.
- `AdminTabs` ganha suporte a contadores/selos de saúde por aba; nenhuma tela usará dois níveis de aba.
- `ProactiveEnginePanelV2` (504 linhas) é quebrado em `FlowsBoard`, `TemplateEditor`, `QueueBoard` e `EffectivenessBoard`.
- `src/lib/admin/messageCenter.ts` passa a ser consumido pela aba Mensagens.
- Permissões preservadas: cada destino mantém sua `action` (`cockpit.read`, `clients.read`, `messaging.read`, `operations.read`, `security.read`) e o filtro por `usePlatformPermissions`.
- Nenhuma mudança em app autenticado do cliente, autenticação ou motor do Nino. Sem publicação em produção.

## Ordem de entrega

1. Kit visual + tokens + `AdminTabs` com selos.
2. Nova Visão geral (incidentes, 4 números com tendência, 2 gráficos).
3. Mensageria: Fluxos, Mensagens (monitor + timeline + reprocessar), Canais.
4. Nino & IA consolidado com gráficos de custo e eficácia.
5. Clientes/ficha com timeline de mensagens do cliente.
6. Administração (acessos, auditoria, configurações) revisada visualmente.
7. Rotas antigas redirecionadas + varredura de cores fora do design system.
