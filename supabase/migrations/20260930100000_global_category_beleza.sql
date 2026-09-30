-- Categoria global "Beleza" (salão, barbearia, estética, massagem, piercing).
-- Quem já tem uma "Beleza" pessoal continua vendo só a dela: o app esconde a
-- global quando existe pessoal ativa com o mesmo nome e tipo.
INSERT INTO public.categories (user_id, slug, name, type, color, icon)
SELECT NULL, 'beleza', 'Beleza', 'expense', '#F472B6', 'sparkles'
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories WHERE user_id IS NULL AND slug = 'beleza'
);
