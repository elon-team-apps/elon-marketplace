-- =============================================================================
-- Migration 005: Product logo_url + official logo refresh
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Apply official product logos (cache-busted with ?v=2).
-- Matching is title-based so existing category conventions remain unchanged.
UPDATE public.products
SET logo_url = 'https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg?v=2'
WHERE title ILIKE '%netflix%';

UPDATE public.products
SET logo_url = 'https://upload.wikimedia.org/wikipedia/commons/e/e7/Instagram_logo_2016.svg?v=2'
WHERE title ILIKE '%instagram%';

UPDATE public.products
SET logo_url = 'https://upload.wikimedia.org/wikipedia/commons/b/b8/2021_Facebook_icon.svg?v=2'
WHERE title ILIKE '%facebook%';

UPDATE public.products
SET logo_url = 'https://upload.wikimedia.org/wikipedia/commons/8/82/Telegram_logo.svg?v=2'
WHERE title ILIKE '%telegram%';

UPDATE public.products
SET logo_url = 'https://static.wikia.nocookie.net/logopedia/images/4/40/Talkatone_2017.png?v=2'
WHERE title ILIKE '%talkatone%';

UPDATE public.products
SET logo_url = 'https://www.hidemyass.com/en-us/index/assets/img/hma-logo-color.svg'
WHERE title ILIKE '%hma%' OR title ILIKE '%hidemyass%';

UPDATE public.products
SET logo_url = 'https://upload.wikimedia.org/wikipedia/commons/f/f9/NordVPN_Logo.png'
WHERE title ILIKE '%nord%';

UPDATE public.products
SET logo_url = 'https://upload.wikimedia.org/wikipedia/commons/7/7a/ExpressVPN_logo.png'
WHERE title ILIKE '%express%';

-- Legacy non-marketplace products intentionally excluded.
