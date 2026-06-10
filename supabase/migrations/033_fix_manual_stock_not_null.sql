-- Fix manual_stock not null constraint issue
ALTER TABLE public.products
ALTER COLUMN manual_stock DROP NOT NULL,
ALTER COLUMN manual_stock SET DEFAULT 0;
