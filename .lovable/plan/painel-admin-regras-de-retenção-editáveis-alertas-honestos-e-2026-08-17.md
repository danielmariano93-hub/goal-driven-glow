# Painel admin: regras de retenção editáveis, alertas honestos e funis de verdade

## O que está errado hoje (verificado no banco)

1. **Alerta "45.0% das mensagens falharam nos últimos 7 dias" é falso.** A conta do cockpit usa a janela `início do período selecionado − 6 dias` até o fim. Com o filtro em 30 dias, ela varre ~36 dias e captura as falhas antigas de julho. Nos últimos 7 dias reais: **127 entregues, 0 falhas**. As falhas se concentram em 22/07–03/08 (legado, já resolvido).
2. **"Atenção: falhas no envio de mensagens — indicador em 220"** vem do mesmo cálculo e da mesma janela errada; é o mesmo fato contado duas vezes, em dois cards gigantes.
3. **Retidas por regra**: nos últimos 30 dias, 111 candidatas retidas. Motivos reais: limite semanal (49), canal não pronto (24, legado), limite diário (13), canal desligado no catálogo (10), cooldown de 24h (6), materialidade (4), severidade abaixo do mínimo para WhatsApp (3), opt-out (1), duplicada (1).
4. As regras existem em dois lugares e só um é editável: o **catálogo por tipo de comunicação** (canais, cooldown, máximo por dia) já é editável em Comunicações › Fluxos; os **limites por cliente** (1 por dia, 3 por semana) vivem nas preferências de cada cliente e hoje não têm nenhuma tela — é exatamente o limite que mais retém.
5. **"Funil das experiências"** e **"Serviços e rotinas"** são listas de pares rótulo/valor empilhados (um card por linha no mobile), sem noção de etapa, queda ou prioridade.

## O que vou entregar

### 1. Regras de convivência: visíveis e ajustáveis
- Nova aba **Regras** em Comunicações, com um cartão por regra explicando em linguagem simples: o que ela faz, quantas retenções causou no período e onde é ajustada.
- Limites globais (máximo por dia e por semana por cliente) passam a ser editáveis ali, com aplicação a todos os clientes e registro em auditoria.
- Cada motivo da tabela de retenção ganha um link "ajustar esta regra" que leva ao controle correspondente (catálogo do tipo, limite global ou preferência do cliente).
- Motivos legados (`canal não pronto`, sem ocorrência desde 12/08) ficam agrupados como "histórico" e fora da leitura atual.

### 2. Alertas da visão geral: compactos e verdadeiros
- Cálculo de falhas corrigido para uma janela real de 7 dias, independente do filtro de período; o rótulo passa a dizer a janela usada.
- Deduplicação: taxa de falha e contagem de falhas viram um único incidente.
- Novo formato: faixa horizontal com cartões pequenos (título curto + severidade + ação), com rolagem lateral no mobile e grade no desktop. Detalhe completo abre em painel lateral, não na tela inteira.
- Quando não há nada crítico, uma linha única: "Nada exige ação agora."

### 3. Funil que parece funil
- **Funil das experiências** vira barras horizontais por experiência, com etapas na ordem (iniciou → concluiu → recebeu valor), largura proporcional e queda percentual entre etapas.
- Eventos deixam de competir com usuários: usuários são a medida principal, eventos aparecem como detalhe secundário.
- Amostra pequena sinalizada explicitamente, para não ler tendência em 1 usuário.

### 4. Serviços e rotinas legíveis
- Uma linha compacta por serviço: nome, pastilha de estado, tempo desde a última execução, processados/falhas. Sem cards de 6 linhas no mobile.
- Ordenação por gravidade (parados e com falha primeiro) e agrupamento "Exigem atenção" / "Saudáveis" recolhível.

## Detalhes técnicos

- `admin_v2_cockpit`: corrigir a janela de `messaging_failure_rate_7d` para `now() - 7 dias` e remover o item `messaging_failures` de `attention` (redundante); manter contrato/nome das chaves.
- Migração: tabela de configuração única para limites proativos globais + RPC de leitura/escrita com `_require_perm('messaging.write')` e auditoria; `communicationPolicy.ts` passa a ler o limite global como piso quando o cliente não personalizou.
- Novo agregado por `reason` já disponível em `communication_deliveries`; a aba Regras consome isso mais `communication_catalog`.
- UI: novo `IncidentStrip` (scroll-snap horizontal no mobile) reaproveitando `SidePanel` para detalhe; `FunnelBars` e `ServiceRow` no kit admin (`src/components/admin/kit/`).
- Arquivos afetados: `src/lib/admin/incidents.tsx`, `src/components/admin/AttentionCard.tsx`, `src/pages/admin/Cockpit.tsx`, `src/pages/admin/Crescimento.tsx`, `src/pages/admin/operacao/Saude.tsx`, `src/pages/admin/ComunicacaoProativa.tsx`, `src/components/admin/messaging/`.
- Sem mudanças no app do cliente, na autenticação ou no motor financeiro.
