-- O título fixo "Isso parece acontecer todo mês" apagava o assunto ("“Claro” parece se repetir todo mês").
-- O texto do motor já nomeia o item e termina com a pergunta; o rodapé fixo só repetia o pedido.
UPDATE public.communication_templates
   SET title_template = '{{title}}',
       body_template = '{{body}}',
       updated_at = now()
 WHERE kind = 'recurring_pattern' AND channel = 'app' AND active = true;
