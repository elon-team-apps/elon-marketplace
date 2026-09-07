import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';


const resend = new Resend('re_9Sru366d_CPecHQirpccCpQ8YXMzT97Bm');
const supabaseUrl = 'https://mofhewplrepcitbwbexh.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vZmhld3BscmVwY2l0YndiZXhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDgwMzYyOCwiZXhwIjoyMDkwMzc5NjI4fQ.KZ6EWLObT8dml7xtf3APR1Vxoc232KfHb7KyK6ieOO4';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function sendBroadcast() {
  console.log('Starting broadcast...');
  
  const subject = 'ELON MARKETPLACE PUBLIC ANNOUNCEMENT 📣';
  const htmlBody = `
    <p>🚨 IMPORTANT NOTICE</p>
    <p>Our former domain, elonmarketplace.com.ng, was recently hacked and is no longer our official website.</p>
    <p>Kindly access our new official domain: <a href="https://www.elonmarketplace.com">https://www.elonmarketplace.com</a> and log in using your previous account details.</p>
    <p>Please do not enter your login information on the old website. Thank you for your understanding and continued support. 🙏</p>
  `;

  try {
    const { data: users, error: usersError } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .not('email', 'is', null);

    if (usersError) {
      throw new Error(`Failed to fetch users: ${usersError.message}`);
    }

    if (!users || users.length === 0) {
      console.log('No users found.');
      return;
    }

    const emails = users.map(u => u.email).filter(email => email && email.includes('@'));
    console.log(`Found ${emails.length} valid email addresses.`);

    const CHUNK_SIZE = 50;
    const emailBatches = [];

    for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
      const wrappedHtmlBody = `
      <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
        <div style="background-color: #0f172a; padding: 24px; text-align: center;">
          <h2 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold; letter-spacing: -0.5px;">Elon Marketplace</h2>
        </div>
        <div style="padding: 32px; color: #1e293b; line-height: 1.6; font-size: 16px;">
          ${htmlBody}
        </div>
        <div style="background-color: #f8fafc; padding: 24px; text-align: center; font-size: 13px; color: #64748b; border-top: 1px solid #e2e8f0;">
          <p style="margin: 0 0 8px 0;">You received this email because you are a registered user.</p>
          <p style="margin: 0;">&copy; ${new Date().getFullYear()} Elon Marketplace. All rights reserved.</p>
        </div>
      </div>
      `;

      const chunk = emails.slice(i, i + CHUNK_SIZE);
      const batchPayload = chunk.map(email => ({
        from: 'Elon Marketplace <noreply@elonmarketplace.com>',
        to: [email],
        subject: subject,
        html: wrappedHtmlBody,
      }));
      emailBatches.push(batchPayload);
    }

    let successCount = 0;
    let failCount = 0;

    for (const batch of emailBatches) {
      const { data, error } = await resend.batch.send(batch);
      if (error) {
        console.error('Resend batch error:', error);
        failCount += batch.length;
      } else {
        successCount += batch.length;
      }
    }

    console.log(`Broadcast complete. Success: ${successCount}, Failed: ${failCount}`);

  } catch (err) {
    console.error('Error in sendBroadcast:', err);
  }
}

sendBroadcast();
