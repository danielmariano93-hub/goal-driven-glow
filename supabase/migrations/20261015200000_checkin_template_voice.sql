-- Check-in emocional no app: de "ajuda o Nino a entender o contexto das suas decisões" (explica o produto)
-- para um convite curto, humano e fácil de responder.
UPDATE public.communication_templates
   SET body_template = 'Sem julgamento, só para eu entender o seu dia. Posso te perguntar como você está?',
       updated_at = now()
 WHERE kind = 'emotional_checkin_due' AND channel = 'app' AND active = true;
