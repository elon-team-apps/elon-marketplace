import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, anonKey);

async function testRpc() {
  const { data: products } = await supabase.from('products').select('id, title');
  
  for (const p of products) {
    const { data, error } = await supabase.rpc("get_live_stock", { p_product_id: p.id });
    if (data > 0) {
      console.log(`Product: ${p.title} | Live Stock via RPC: ${data}`);
    }
  }
}

testRpc();
