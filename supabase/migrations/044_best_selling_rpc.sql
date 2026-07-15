-- Migration: 044_best_selling_rpc.sql
-- Description: Create an RPC function to get best-selling products by counting delivered log items.

CREATE OR REPLACE FUNCTION public.get_best_selling_products(limit_val INT)
RETURNS TABLE (
  product_id UUID,
  sales_count BIGINT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT l.product_id, COUNT(*) AS sales_count
  FROM public.log_items l
  WHERE l.is_delivered = TRUE OR l.status IN ('sold', 'delivered')
  GROUP BY l.product_id
  ORDER BY sales_count DESC
  LIMIT limit_val;
END;
$$;
