import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, anonKey);

async function check() {
  const { data, error } = await supabase.from('products').select('id, title, stock, manual_stock, stock_count, status');
  console.log('Error:', error);
  console.log('Products:', data);
}

check();
