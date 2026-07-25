INSERT INTO public.product_event_types (event_name, category, requires_value_bucket, description)
VALUES ('user_registered', 'onboarding', false, 'Novo usuário cadastrado (evento de ciclo de vida)')
ON CONFLICT (event_name) DO NOTHING;