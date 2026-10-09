# Hábitos v2 — validação com pessoas e métricas

A tela só é "boa" quando a pessoa **entende, explica e decide**. Código e testes não provam isso.

## 1. Teste moderado com 5 pessoas que não participaram do desenvolvimento

Liberar a v2 para 5 contas (`insert into habits_v2_access(user_id, note) values (...)`) e observar, uma pessoa por vez,
~10 minutos, sem ajuda. Ela abre a tela e fala em voz alta. Perguntas ao final (anotar com as palavras da pessoa):

1. O que o Nino descobriu sobre você? (explique com as suas palavras)
2. Por que ele acha isso? Que dados você viu?
3. O que isso significa para o seu dinheiro?
4. Que decisão você consideraria tomar? (qualquer uma, inclusive "nenhuma")
5. Alguma coisa pareceu uma imposição, um julgamento ou algo que o Nino "inventou"?
6. A pergunta de contexto fez sentido? Respondeu? Por quê?
7. Abriu alguma dimensão da roda? Entendeu a diferença entre "você" e "Nino observa"?

Critério de passagem: ≥ 4 de 5 conseguem explicar (1–3) sem repetir números de cabeça; ≥ 4 de 5 dizem uma decisão
coerente com o insight (4); nenhuma relata imposição/julgamento (5).

## 2. Métricas (tabela `habit_insight_events`)

Eventos: `shown`, `answered`, `skipped`, `limit_opened`, `accepted`, `declined`, `undone`, `useful`, `not_useful`,
`dimension_opened`, `dimension_answered`. Todas as consultas abaixo são por usuário com acesso à v2.

```sql
-- funil por insight (últimos 30 dias)
select insight_id,
       count(*) filter (where event = 'shown')            as exibido,
       count(*) filter (where event = 'answered')         as respondido,
       count(*) filter (where event = 'skipped')          as prefere_nao_responder,
       count(*) filter (where event = 'limit_opened')     as abriu_limite,
       count(*) filter (where event = 'accepted')         as aceitou,
       count(*) filter (where event in ('declined','undone')) as recusou_ou_desfez,
       count(*) filter (where event = 'useful')           as fez_sentido,
       count(*) filter (where event = 'not_useful')       as nao_fez_sentido
from habit_insight_events
where created_at > now() - interval '30 days'
group by 1 order by exibido desc;

-- respostas de contexto (distribuição)
select subject, answer_keys, count(*) from habit_context_answers group by 1, 2 order by 3 desc;

-- resultado dos combinados aceitos (benefício real, não só clique): fechamento de segunda
select status, count(*), round(avg(realized_amount - target_amount), 2) as media_gasto_menos_limite
from weekend_commitments where status in ('kept', 'missed') group by 1;
```

Leitura (não confundir engajamento com benefício):

* **Compreensão**: `fez_sentido / (fez_sentido + nao_fez_sentido)` ≥ 70% e `respondido / exibido` ≥ 30% das vezes em que houve pergunta.
* **Respeito à autonomia**: `aceitou` só após `limit_opened`; `declined`/`undone` não podem gerar nova oferta na mesma semana.
* **Benefício**: `kept` vs `missed` e o gasto realizado frente ao esperado, nas categorias com combinado (`weekend_commitments`).
  Clique ou resposta no WhatsApp não demonstram mudança financeira.
* **Fadiga**: `shown` por pessoa por semana ≤ 2 insights; nenhuma mensagem proativa para categoria com resposta `planned` / `for_others`.

## 3. Regras de decisão para o rollout

* Ampliar para mais pessoas só após o critério do teste moderado.
* Ligar para todos só com a confirmação do produto e depois de 2 semanas sem reclamação de imposição/julgamento.
* Qualquer relato de "o Nino inventou" bloqueia a ampliação até corrigir a lógica de seleção, não o texto.
