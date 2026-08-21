CREATE OR REPLACE FUNCTION public.investment_position_reconciliation()
RETURNS TABLE (
  investment_id uuid,
  name text,
  anchor_value numeric,
  anchor_date date,
  applications_after_anchor numeric,
  redemptions_after_anchor numeric,
  incorporated_movements integer,
  pending_movements integer,
  expected_position numeric,
  registered_position numeric,
  difference numeric,
  confidence text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mv AS (
    SELECT m.investment_id,
           SUM(CASE WHEN m.accounting_state = 'applied_to_position' AND m.kind = 'application' THEN m.amount ELSE 0 END) AS apps,
           SUM(CASE WHEN m.accounting_state = 'applied_to_position' AND m.kind = 'redemption' THEN m.amount ELSE 0 END) AS reds,
           COUNT(*) FILTER (WHERE m.accounting_state = 'incorporated_in_anchor') AS incorporated,
           COUNT(*) FILTER (WHERE m.accounting_state = 'pending_reconciliation') AS pending
      FROM public.investment_movements m
     WHERE m.user_id = auth.uid()
     GROUP BY m.investment_id
  ), base AS (
    SELECT i.id,
           i.name,
           i.current_value AS registered,
           i.reference_date,
           COALESCE(mv.apps, 0) AS apps,
           COALESCE(mv.reds, 0) AS reds,
           COALESCE(mv.incorporated, 0)::integer AS incorporated,
           COALESCE(mv.pending, 0)::integer AS pending
      FROM public.investments i
      LEFT JOIN mv ON mv.investment_id = i.id
     WHERE i.user_id = auth.uid()
  )
  SELECT b.id,
         b.name,
         -- Posição implícita na âncora: desfaz os movimentos aplicados depois dela.
         round(b.registered - b.apps + b.reds, 2),
         b.reference_date,
         b.apps,
         b.reds,
         b.incorporated,
         b.pending,
         round((b.registered - b.apps + b.reds) + b.apps - b.reds, 2),
         round(b.registered, 2),
         round(b.registered - ((b.registered - b.apps + b.reds) + b.apps - b.reds), 2),
         CASE
           WHEN b.pending > 0 THEN 'low'
           WHEN b.incorporated > 0 THEN 'medium'
           ELSE 'high'
         END
    FROM base b;
$$;