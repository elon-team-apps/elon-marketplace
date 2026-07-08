import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, anonKey);

async function testRpc() {
  const productId = 'c548679b-46ec-4139-b4b5-1b9472786815'; // USA Instagram
  const { data, error } = await supabase.rpc("get_live_stock", { p_product_id: productId });
  console.log('RPC Error:', error);
  console.log('RPC Data:', data);
}

testRpc();
