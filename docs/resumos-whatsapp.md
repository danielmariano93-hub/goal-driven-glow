# Nino Insights — resumos financeiros em PDF pelo WhatsApp (26/11/2026)

Dois PDFs de uma página (semanal e mensal), enviados pelo WhatsApp no horário combinado ou quando a pessoa pede. Sem nova rota, sem nova tela, sem link obrigatório. **Tudo desligado por padrão**: nada é enviado até a flag `use_whatsapp_pdf_summaries` ser ligada para um usuário.

## 1. Inventário: o que já existia e o que foi reaproveitado

| Peça | Existia | Uso nos resumos |
|---|---|---|
| Consumo canônico (estornos, cartão, transferências próprias, principal × juros) | `toLedger` + `classifyLedger` (report_v2) | Linhas de consumo por **data da compra**; parcela antiga carregada não conta na semana |
| Números do mês (receitas, consumo, resultado, categorias, compromissos, recebíveis, patrimônio) | `loadReportV2` (o mesmo de "Meu mês") | Resumo mensal sem recalcular nada |
| Saldo disponível de hoje | retrato do dia (o mesmo da Home) | Saldo em uma data passada = saldo de hoje − movimentos de conta depois da data |
| Metas de gasto | status canônico (aba Metas) e `category_spending_goal_cycles` | Mês aberto: status de hoje; mês fechado: ciclos gravados daquele mês |
| Preferências | `notification_preferences` (semanal/mensal ligado, canal, fuso) | Reaproveitado; acrescentados opt-in por tipo (data e origem) e `summary_hour` |
| Fila do WhatsApp | `outbound_messages` + `whatsapp-send` (texto e imagem) | Novo envio de **documento** (`sendFile` do WAHA) |
| Webhook | gancho determinístico de Hábitos | Mesmo padrão para pedidos e comandos de resumo |
| PDF | `pdf-lib` já usado em documentos | Mesmo pacote, com fonte DM Sans embutida |

## 2. Lacunas encontradas e como foram tratadas

- **Sem envio de documento**: o provedor só mandava texto e imagem → `sendFile` (PDF por link assinado de 15 min, com nome do arquivo).
- **Sem saldo histórico confiável**: `account_balance_snapshots` para em 07/10 → saldo em data passada derivado do saldo de hoje e dos movimentos de conta (transferências próprias se anulam). Sem retrato do dia, o saldo sai "não disponível" (nunca zero).
- **Sem "saldo mínimo diário" publicado pelo motor**: o risco de caixa usa o saldo previsto do fim do mês (negativo = risco). Ver limitação L2.
- **DM Sans não tem números tabulares** (nem na versão atual do Google Fonts): os algarismos são desenhados com os contornos da própria fonte em célula fixa, com o texto real numa camada invisível por cima. Resultado: números alinhados, texto selecionável e extraído corretamente ("R$ 1.337,52", sem espaços falsos).
- **Texto semanal/mensal atual**: com a flag ligada, o PDF substitui o texto no WhatsApp (o relatório do app continua sendo gravado). Sem a flag, nada muda.

## 3. O que foi feito

| Passo da especificação | Entrega |
|---|---|
| 2. DTO + reconciliação | `_shared/summaries/{types,format,compare,editorial,weekly,monthly}.ts` — puros, centavos inteiros, nulo ≠ zero |
| 3. Templates + PDFs | `_shared/summaries/render.ts` (A4, uma página, vetor, fontes embutidas, ~60–75 KB) + 5 cenários de prévia |
| 4. Pedido sob demanda + transporte | `intents.ts`, `whatsappReply.ts` (webhook), `sendFile` no WAHA, ramo PDF no `whatsapp-send` |
| 5. Agendamento, preferências, observabilidade | `financial-summaries-dispatch` (cron de hora em hora, segunda e dia 2 no horário da pessoa), migração com entregas, estados, deduplicação, retenção de 30 dias, heartbeat e logs |
| 6. Piloto | **Aguardando aprovação** (seção 7) |

### Layout (v2, pensado para o celular)

Revisão pedida pelo dono do produto depois do piloto: página na **largura de uma tela de celular (390 pt)**, com altura do tamanho do conteúdo (uma página só). Abre no WhatsApp sem precisar dar zoom. **Diverge da especificação original (A4)** por decisão do dono do produto.

Segue o design system do app (tokens de `src/index.css`): fundo #F5F4FA, cartões brancos com borda #E8E6EF e raio 18, destaque com o mesmo degradê e raio 24 do "Disponível hoje", rótulos 11/semibold em roxo (#6D2EFF), títulos 15/20, corpo 13/18, DM Sans.

Ordem: cabeçalho → destaque (consumo da semana ou resultado do mês; embaixo, **acumulado do mês** e **saldo em conta hoje** — no mensal, receitas e consumo) → **semana a semana** (blocos de 7 dias do mês contra os mesmos dias do mês anterior; no semanal, as barras somam exatamente o acumulado do mês) → onde mais gastou → sua evolução (mensal) → o que mais chamou atenção → olhando para frente (grade 2×2) → seu próximo passo → rodapé.

**Saldo:** o resumo mostra o mesmo "Disponível hoje" da tela inicial, com a data escrita. Antes mostrava um saldo calculado para o último dia da semana, sem dizer a data, o que confundia.

### Regras de comparação

Δ% só com base positiva; base zero → "novo gasto"; os dois zero → "sem variação"; sem base → "sem comparação"; troca de sinal ou base negativa → só a diferença em reais; resultado mensal sempre em reais. Comparação não pinta número: verde só melhora sustentada, vermelho risco, âmbar atenção.

### Insight e ação (sem IA)

Prioridade fixa: risco de caixa → qualidade dos dados → pressão de compromissos → mudança material de consumo (≥15% e ≥ R$ 50) → meta em risco → melhora sustentada → oportunidade → resumo neutro. Desempate: severidade, prazo, impacto absoluto, evidência, ID. Frases de uma biblioteca fechada com lacunas nomeadas (lacuna sem valor quebra o teste). Limites: título 65, insight 180, ação 120, ressalva 150. Limiares em `SUMMARY_THRESHOLDS` (a aprovar).

### WhatsApp

- Automático: semanal toda segunda e mensal todo dia 2, às 8h no fuso da pessoa (ou o horário escolhido), só com opt-in registrado (data e origem).
- Pedidos: "me manda meu resumo financeiro" (mês até hoje), "resumo da semana" (semana até hoje), "última semana", "fechamento de outubro", "resumo do mês passado", "reenvie". Ambíguo ("resumo") → uma pergunta.
- Comandos: "pare de enviar resumos", "desative semanal", "ative mensal", "mude para 9h" (6h a 22h).
- Mensagem que acompanha o PDF, sem números e sem link: "Seu resumo financeiro de 16 a 22/11 está pronto. Segue o PDF."
- Perguntas analíticas ("quanto gastei", "relatório de gastos com mercado") continuam com o agente.

### Entrega e estados

`financial_summary_deliveries`: chave `usuário:tipo:período[@corte]:canal`; estados queued → generating → validated → sending → accepted → delivered, ou failed_retryable / failed_final / unknown / cancelled (gatilho acompanha a fila do WhatsApp). PDF validado antes de sair (1 página, < 1 MB, nenhum texto cortado) — se falhar, não envia. Até 3 tentativas com espera exponencial e variação aleatória. Armazenamento privado (`financial-summaries`), link assinado de 15 min gerado na hora do envio, arquivo apagado após 30 dias.

## 4. Testes

- `src/test/whatsapp-summaries.test.ts` (33): comparações, semana que cruza mês e ano, fevereiro, consumo semanal = soma das linhas (com estorno), mês até a data × mesmos dias, top 3 categorias, pequenos gastos, saldo, vencimentos de 7 dias, risco de caixa dominando o destaque, semana parcial, sem lançamentos, base zero, saldo ausente (nulo), resultado com troca de sinal, renda não recebida, importação pendente, prioridade e desempate, cinco PDFs (uma página, < 1 MB, nada cortado).
- `src/test/whatsapp-summaries-transport.test.ts` (15): pedidos e comandos, não intercepta conversa comum, **envio por WAHA de teste** (rota `/api/sendFile`, chatId, tipo, nome do arquivo, legenda sem valores), legendas, chave de deduplicação, períodos padrão.

## 5. Limitações

- **L1** No semanal o saldo é o de hoje (igual à tela inicial). No mensal, o saldo do fim do mês é calculado: saldo de hoje menos os movimentos depois do fim do mês (confere com a ponte do caixa da Home).
- **L2** O motor não publica o menor saldo diário previsto; o risco de caixa usa o saldo do fim do mês. Um aperto no meio do mês que se resolve até o dia 30 não aparece como risco.
- **L3** "Próximo mês" usa a soma de cartões, parcelas e recorrências do motor; fatura estimada sem data entra marcada como estimativa.
- **L4** Metas de mês fechado só existem quando há ciclo gravado (`category_spending_goal_cycles`); sem ciclo, a linha mostra "sem metas de gasto".
- **L5** A pergunta para pedido ambíguo pede que a pessoa responda com a frase completa ("resumo da semana" / "resumo do mês"); não há memória de "pergunta pendente".
- **L6** Logotipo em texto (DM Sans 24, cor primária); o arquivo vetorial do logotipo não está no repositório.
- **L7** Não há prévia do PDF dentro do app (fora do escopo: sem nova rota).

## 6. Como ativar (depois da aprovação)

1. Aplicar a migração `20261126090000_resumos_whatsapp_pdf.sql` e publicar `financial-summaries-dispatch`, `whatsapp-send`, `whatsapp-webhook` e `financial-reports-generate`.
2. Piloto (conta autorizada): `update financial_feature_flags set use_whatsapp_pdf_summaries = true where user_id = …` e registrar o opt-in (`weekly_summary_opt_in_at`, `monthly_summary_opt_in_at`, origem `pilot`).
3. Prévia sem envio: `financial-summaries-dispatch` com `{"mode":"preview","user_id":…,"summary_type":"weekly"}` devolve o link assinado do PDF gerado com os dados reais.
4. Envio real: pedir "resumo da semana" no WhatsApp; conferir `financial_summary_deliveries` (sending → accepted → delivered).
5. Desligar: flag `false` (volta o texto semanal/mensal de antes).

## 7. Aprovações pendentes

- Envio real (piloto na conta autorizada) e depois produção.
- Limiares de `SUMMARY_THRESHOLDS` (15% e R$ 50; 50% da renda; 85% da meta; 20% sem categoria).
