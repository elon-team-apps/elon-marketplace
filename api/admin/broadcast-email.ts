import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const resend = new Resend(process.env.RESEND_API_KEY);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Create a Supabase client with the service role key to bypass RLS and get all profiles
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 1. Authenticate the request (Ensure the caller is an admin)
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Check if the user is an admin by querying their profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role, is_admin')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return res.status(403).json({ error: 'Profile not found' });
    }

    const isAdmin = profile.is_admin === true || (profile.role || '').toLowerCase() === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    // 2. Parse request body
    const { subject, htmlBody } = req.body;
    if (!subject || !htmlBody) {
      return res.status(400).json({ error: 'Missing subject or htmlBody' });
    }

    // 3. Fetch all user emails from the profiles table
    const { data: users, error: usersError } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .not('email', 'is', null);

    if (usersError) {
      throw new Error(`Failed to fetch users: ${usersError.message}`);
    }

    if (!users || users.length === 0) {
      return res.status(400).json({ error: 'No users found to send email to.' });
    }

    const emails = users.map((u: any) => u.email).filter((email: string) => email && email.includes('@'));

    if (emails.length === 0) {
      return res.status(400).json({ error: 'No valid email addresses found.' });
    }

    // 4. Chunk emails into batches of 50 (Resend batch limit)
    const CHUNK_SIZE = 50;
    const emailBatches = [];
    
    // Prepare the unified payload for Resend Batch API
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

    // 5. Send batches
    let successCount = 0;
    let failCount = 0;

    for (const batch of emailBatches) {
      try {
        const { data, error } = await resend.batch.send(batch);
        if (error) {
          console.error('Resend batch error:', error);
          failCount += batch.length;
        } else {
          successCount += batch.length;
        }
      } catch (err) {
        console.error('Batch send exception:', err);
        failCount += batch.length;
      }
    }

    return res.status(200).json({
      success: true,
      message: `Broadcast complete.`,
      stats: {
        totalAttempted: emails.length,
        successCount,
        failCount
      }
    });

  } catch (error: any) {
    console.error('Broadcast Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
