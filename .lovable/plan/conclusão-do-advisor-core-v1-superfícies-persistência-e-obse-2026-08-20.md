# Conclusão do advisor_core.v1 — superfícies, persistência e observabilidade

As rodadas anteriores entregaram os motores (`financial_comparison.v1`, `financial_performance.v1`, `advisor_relevance.v1`), as tools do assessor e as tabelas de aprendizado/persistência. O que confirmei que ainda falta:

| Item | Estado atual verificado |
| --- | --- |
| `financial_performance_snapshots` | Tabela criada na migration de 20/08, sem nenhum leitor ou gravador no código |
| Home consumindo highlights | Nenhum componente em `src/components/home` referencia performance/advisor |
| Relatórios acionáveis + gráficos premium | `src/lib/reports/intelligent` ainda não usa os novos motores |
| Admin — observabilidade do consultor | Não existe painel; `src/components/admin` não tem nada de advisor |
| Espelho edge de `financialComparison` | Está na lista do sync mas o arquivo não aparece em `_shared/finance-core` — revalidar e regerar |

## O que será entregue

### 1. Persistência e invalidação dos highlights
- `src/lib/nino/performanceSnapshots.ts`: gravação/leitura de `financial_performance_snapshots` (highlight, `logical_topic_key`, payload, confiança, comparabilidade, `valid_until`, versão dos dados).
- Cálculo só acontece quando o snapshot está ausente, expirado ou marcado como sujo; caso contrário reusa o payload salvo.
- Invalidação por evento reaproveitando `invalidateFinancialQueries` e os gatilhos financeiros já existentes (transação, importação, estorno, fatura, pagamento, meta, dívida, recorrência, investimento).

### 2. Home — acompanhamento discreto
- Novo `src/components/home/AcompanhamentoCard.tsx`: no máximo 2–4 highlights vindos do advisor (headline, número, explicação curta, período comparado e CTA "Entender").
- Hook `useFinancialPerformance` consome snapshot + `computeAdvisorDecision`; a UI não calcula nada.
- Distinção explícita entre efeito de calendário/timing e melhora real, com estado vazio amigável quando não há comparabilidade.

### 3. Relatórios acionáveis com gráficos premium
- Relatório inteligente passa a consumir `financial_performance.v1` e `financial_comparison.v1`: resumo executivo, o que mudou, drivers com residual, o que ainda vem, projeção, oportunidades e comportamento.
- Gráficos suaves (curvas com gradiente discreto, período anterior atenuado, tooltip útil, mobile-first) usando o Recharts já presente no projeto.

### 4. Admin — observabilidade do consultor
- Nova seção "Consultor" no admin: contexto temporal do usuário, metodologia e cobertura da comparação, decomposição timing vs comportamento, ranking do advisor com afinidade e motivo de supressão.
- **Dry Run** "como o Nino avaliaria este usuário hoje", sem gravar nem enviar mensagem.

### 5. WhatsApp / proatividade
- Highlights entram como candidatos no pipeline proativo existente (Advisor → situações → materialidade → attention budget → quiet hours → dedupe). Highlight nunca vira mensagem automática por conta própria.

### 6. Testes
- Snapshot: cálculo, reuso, expiração e invalidação por evento.
- Advisor: ordenação por peso financeiro, supressão por afinidade e risco crítico nunca suprimido.
- Home/relatório: highlight com timing não é apresentado como melhora real.
- Paridade app × edge (`finance-core-parity`) verde após regenerar os espelhos.

## Notas técnicas
- Nenhuma fórmula nova em componente ou página: tudo sai dos motores em `src/lib/engine/`.
- Persistência e leitura respeitam RLS por `auth.uid()` já definida na tabela.
- Espelhos das edge functions regerados por `scripts/sync-finance-core.mjs`; deploy das functions do assessor ao final.
- Relatório final em tabela (requisito, status antes, implementação, arquivo, teste, evidência).
