# Nino inspirador, sem aviso indevido e com áudio no WhatsApp

O print mostra três coisas, e as duas primeiras estão confirmadas no código:

1. **Aviso indevido continua**: "Nino, me fala um pouco mais sobre você e seu propósito" não bate com nenhum padrão de identidade em `Conversational.ts`, não tem sinal financeiro e não é reconhecida como pergunta (não termina com "?" nem começa com "qual/quem/o que"). Cai em `unclassified`, e `shouldAcknowledge` só suprime o aviso quando a mensagem é classificada — logo o "Só um instante" dispara.
2. **Layout ruim**: a resposta veio com "Eu faço: •" na mesma linha do texto e depois bullets soltos. Hoje o `ReplyHumanizer` normaliza bullets que já começam a linha, mas não separa lista colada no meio do parágrafo.
3. **Tom pouco inspiracional**: as respostas determinísticas de identidade/propósito são corretas mas frias, listando limitações ("não movimento dinheiro, não pago contas") antes de gerar desejo.

## O que vou entregar

### 1. Nunca mais aviso em conversa
- Classificador ganha as formas naturais de pedido sobre si mesmo: "me fala sobre você", "seu propósito", "por que você existe", "qual sua missão", "me conta mais de você", "sobre o que é o Meu Nino" — com e sem "?".
- Inverter a regra do aviso: em vez de "avisa quando não classificou", passa a "avisa **somente** quando o turno é comprovadamente analítico" (sinal financeiro, pedido de gráfico/relatório, período, valor, ou mensagem longa com verbo de análise). Mensagem curta sem sinal financeiro nunca gera aviso — só "digitando…".
- Piso de tempo do aviso mantido e cancelamento imediato quando a resposta chega antes.

### 2. Nino inspiracional (identidade e propósito)
- Card canônico ganha `purpose` e `promise`: o Nino existe para tirar o peso do dinheiro das costas da pessoa — clareza, tranquilidade e decisão, não planilha.
- Respostas determinísticas reescritas em três blocos curtos: **quem sou → o que muda na sua vida → convite concreto** ("me conta um gasto agora e eu te mostro"). Limites deixam de abrir a conversa: só aparecem quando a pessoa pergunta o que ele não faz, ou em uma linha discreta no fim.
- Persona reforçada: linguagem de benefício ("você para de descobrir o problema no fim do mês"), zero tom de manual, 1 emoji no máximo, nunca cita fornecedor de IA.

### 3. Layout impecável no WhatsApp
- `ReplyHumanizer` passa a quebrar linha quando um bullet aparece colado no meio de um parágrafo ("Eu faço: • Registrar…"), a garantir linha em branco antes da lista, bullets consistentes (`•`) e no máximo uma linha em branco entre blocos.
- Guarda final de sanidade estendida: detecta bullet inline, bullet vazio, dupla pontuação e preposição órfã, e repara antes de enviar.

### 4. Nino entende áudio
Sim, é viável — e será entregue nesta mesma implementação:
- O webhook hoje ignora áudio (`mediaFallback` retorna `false` para `audio/*`), então a mensagem chega vazia e o Nino não responde nada útil.
- Novo passo de transcrição: áudio inbound do WhatsApp é baixado pelo pipeline de mídia existente e transcrito pela IA da Lovable; o texto resultante entra no fluxo normal do agente, exatamente como se a pessoa tivesse digitado.
- WhatsApp envia OGG/Opus; a transcrição será feita pelo caminho que aceita esse formato (modelo multimodal do gateway), sem depender de conversão de áudio no servidor.
- Confirmação leve antes de agir: quando o áudio vira lançamento, o Nino repete em uma linha o que entendeu ("Entendi: R$ 32 no mercado hoje — confirmo?"), evitando registro errado por transcrição imperfeita.
- Falhas tratadas com honestidade: áudio muito longo, silencioso ou ilegível recebe resposta curta pedindo para repetir por texto — nunca silêncio.
- Limites: áudio acima de ~2 minutos é recusado com explicação (custo/latência), e o áudio original não é armazenado além do necessário para processar.

### 5. Testes
Regressão: "me fala sobre você e seu propósito" classifica como identidade/propósito e **não** gera aviso; pergunta financeira continua gerando aviso e passando pelo validador de verdade; nenhuma resposta sai com bullet inline ou frase quebrada; áudio transcrito entra no pipeline textual e áudio inválido produz resposta de erro amigável.

## Notas técnicas

- Arquivos: `_shared/agent/core/Conversational.ts` (padrões, purpose, respostas), `_shared/agent/core/ReplyHumanizer.ts` (bullet inline + sanidade), `_shared/agent/prompt.ts` (persona inspiracional), `whatsapp-webhook/index.ts` (aviso condicional + rota de áudio), `_shared/messaging/mediaFallback.ts` (áudio deixa de ser ignorado), novo `_shared/messaging/audioTranscription.ts`.
- Sem migrations novas obrigatórias; sem alteração em motores financeiros, ledger, verdade de caixa ou autenticação. Nenhum número passa a ser gerado pela LLM.
- Deploy de `whatsapp-webhook`, `agent-chat` e `agent-run`.

## Entrega
Relatório com IMPLEMENTADO / TESTADO / NÃO IMPLEMENTADO (+motivo) / ARQUIVOS / TESTES.
