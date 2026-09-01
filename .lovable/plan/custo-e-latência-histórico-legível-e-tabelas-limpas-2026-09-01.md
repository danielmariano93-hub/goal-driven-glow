# Custo e latência: histórico legível e tabelas limpas

Tudo em frontend, na aba **Nino & IA → Custo e latência** (`AiEfficiencyHistoryBoard.tsx`). Sem migration, sem deploy, sem mudança de motor.

## 1. Histórico dia a dia (novo)

Abaixo dos gráficos, uma tabela de histórico usando a série que a RPC já devolve — nada calculado no cliente além de soma/formatação:

| Dia | Conversas | Tokens (entrada / saída / total) | Tokens por conversa | Latência de IA (mediana / P95) | Ponta a ponta (mediana / P95) |

- Ordem do mais recente para o mais antigo, com rolagem e cabeçalho fixo.
- Dia sem métrica mostra "—", nunca zero inventado.
- Alternância **Por dia / Por semana** (agregação simples de tokens e conversas; latência agregada só como média das medianas disponíveis, rotulada como tal).
- Rodapé com o total do recorte, para conferir com os cartões do topo.
- No mobile, cada dia vira um cartão empilhado em vez de tabela horizontal.

## 2. Remover o drill-down de latência

Sai a seção "Drill-down de latência" inteira: cards por run, seleção de dia por clique no gráfico, a consulta extra do dia e os tipos que só ela usava. O gráfico de latência deixa de ser clicável.

## 3. Reorganizar as duas tabelas do print

**Determinístico x IA** e **Modelos efetivamente usados** deixam de ser listas com um texto longo à direita e passam a tabelas com colunas alinhadas:

- Determinístico x IA: Caminho · Conversas · Participação (%) · Tokens/conversa · P50 · P95, com barra discreta de participação e nomes em português (`fast_log` → "Resposta instantânea", `llm` → "Com IA", `deterministic_tool` → "Ferramenta determinística", `deterministic_fallback` → "Ferramenta após falha", `unknown` → "Não classificado"), mantendo o rótulo técnico em legenda.
- Modelos efetivamente usados: Modelo · Faixa · Conversas · Tokens · Tokens/conversa, valores em coluna própria com números tabulares e linhas ordenadas por consumo.
- Cada bloco ganha uma linha de explicação do que responde e estado vazio próprio.
- Faixa de modelo aparece como coluna, não colada ao nome com ponto.

## 4. Detalhes técnicos

- Arquivo único: `src/components/admin/AiEfficiencyHistoryBoard.tsx`; se o histórico crescer, extrair `AiHistoryTable.tsx` no mesmo diretório.
- Reaproveitar `AdminResponsiveList`/`DataTable` do admin quando o formato couber; nada de tabela HTML crua sem tokens do design system.
- Ajustar a suíte focal (`src/test/nino-change-agent-v1.test.ts`) para exigir a tabela de histórico e proibir a volta do drill-down.
- Verificar em desktop e mobile autenticado, e checar build sem erros.
