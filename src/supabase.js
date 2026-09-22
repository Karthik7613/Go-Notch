const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

let rawUrl = process.env.SUPABASE_URL;
if (rawUrl && rawUrl.includes('/project/')) {
  const match = rawUrl.match(/project\/([a-z0-9]+)/i);
  if (match && match[1]) {
    rawUrl = `https://${match[1]}.supabase.co`;
  }
}
const supabaseUrl = rawUrl;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey && supabaseUrl !== 'https://your-project-id.supabase.co') {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log(`⚡ Supabase client connected successfully to: ${supabaseUrl}`);
  } catch (err) {
    console.error('❌ Failed to initialize Supabase client:', err.message);
  }
} else {
  console.log('⚠️ Supabase credentials missing or unconfigured in .env file. Running with local SQLite only.');
}

function isSupabaseConfigured() {
  return supabase !== null;
}

/**
 * Sync a message to Supabase messages table
 */
async function syncMessageToSupabase(msg) {
  if (!supabase) return false;
  try {
    const payload = {
      message_id: msg.message_id,
      chat_jid: msg.chat_jid,
      sender_jid: msg.sender_jid,
      sender_name: msg.sender_name || 'Unknown',
      chat_name: msg.chat_name || msg.chat_jid,
      content: msg.content || '',
      message_type: msg.message_type || 'text',
      is_from_me: msg.is_from_me ? true : false,
      timestamp: msg.timestamp,
      raw_json: typeof msg.raw_json === 'string' ? msg.raw_json : JSON.stringify(msg.raw_json || {}),
      ai_transcript: msg.ai_transcript || null,
      ai_translation: msg.ai_translation || null
    };

    const { error } = await supabase
      .from('messages')
      .upsert(payload, { onConflict: 'message_id' });

    if (error) {
      console.error('⚠️ Supabase syncMessage error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('⚠️ Supabase syncMessage exception:', err.message);
    return false;
  }
}

/**
 * Sync AI transcription/translation updates to Supabase
 */
async function syncAIUpdateToSupabase(messageId, transcript, translation) {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('messages')
      .update({ ai_transcript: transcript, ai_translation: translation })
      .eq('message_id', messageId);

    if (error) {
      console.error('⚠️ Supabase syncAIUpdate error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('⚠️ Supabase syncAIUpdate exception:', err.message);
    return false;
  }
}

/**
 * Sync contact to Supabase contacts table
 */
async function syncContactToSupabase(contact) {
  if (!supabase) return false;
  try {
    const payload = {
      jid: contact.jid,
      name: contact.name || '',
      notify: contact.notify || '',
      phone: contact.phone || '',
      updated_at: contact.updated_at || Math.floor(Date.now() / 1000)
    };

    const { error } = await supabase
      .from('contacts')
      .upsert(payload, { onConflict: 'jid' });

    if (error) {
      console.error('⚠️ Supabase syncContact error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('⚠️ Supabase syncContact exception:', err.message);
    return false;
  }
}

/**
 * Sync chat thread to Supabase chats table
 */
async function syncChatToSupabase(chat) {
  if (!supabase) return false;
  try {
    const payload = {
      jid: chat.jid,
      name: chat.name || '',
      unread_count: chat.unread_count || 0,
      conversation_timestamp: chat.conversation_timestamp || 0,
      updated_at: chat.updated_at || Math.floor(Date.now() / 1000)
    };

    const { error } = await supabase
      .from('chats')
      .upsert(payload, { onConflict: 'jid' });

    if (error) {
      console.error('⚠️ Supabase syncChat error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('⚠️ Supabase syncChat exception:', err.message);
    return false;
  }
}

/**
 * Sync user profile to Supabase users table
 */
async function syncUserToSupabase(user) {
  if (!supabase || !user || !user.phone) return false;
  try {
    const cleanPhone = String(user.phone).replace(/\D/g, '');
    const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      phone: p10,
      name: user.name || 'User',
      gender: user.gender || 'Male',
      passcode: user.passcode ? String(user.passcode).trim() : null,
      created_at: user.created_at || now,
      updated_at: user.updated_at || now
    };

    const { error } = await supabase
      .from('users')
      .upsert(payload, { onConflict: 'phone' });

    if (error) {
      console.warn('⚠️ Supabase syncUser error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('⚠️ Supabase syncUser exception:', err.message);
    return false;
  }
}

/**
 * Helper to enforce strict timeout on cloud database lookups
 */
function withTimeout(promise, ms = 1200) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase request timeout')), ms))
  ]);
}

/**
 * Fetch user profile from Supabase by phone
 */
async function fetchUserFromSupabase(phone) {
  if (!supabase || !phone) return null;
  try {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
    const query = supabase
      .from('users')
      .select('*')
      .or(`phone.eq.${p10},phone.eq.${cleanPhone},phone.eq.91${p10}`)
      .limit(1)
      .maybeSingle();

    const { data, error } = await withTimeout(query, 1200);

    if (error || !data) return null;
    return data;
  } catch (err) {
    return null;
  }
}

/**
 * Sync subscription to Supabase subscriptions table
 */
async function syncSubscriptionToSupabase(sub) {
  if (!supabase || !sub || !sub.user_phone) return false;
  try {
    const cleanPhone = String(sub.user_phone).replace(/\D/g, '');
    const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      user_phone: p10,
      plan_name: sub.plan_name || 'Monthly Pro',
      plan_price: sub.plan_price || 2,
      status: sub.status || 'active',
      started_at: sub.started_at || now,
      expires_at: sub.expires_at || (now + 30 * 86400),
      payment_id: sub.payment_id || '',
      order_id: sub.order_id || '',
      created_at: sub.created_at || now,
      updated_at: now
    };

    const { error } = await supabase
      .from('subscriptions')
      .insert(payload);

    if (error) {
      console.warn('⚠️ Supabase syncSubscription error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('⚠️ Supabase syncSubscription exception:', err.message);
    return false;
  }
}

/**
 * Fetch active subscription from Supabase
 */
async function fetchSubscriptionFromSupabase(phone) {
  if (!supabase || !phone) return null;
  try {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
    const query = supabase
      .from('subscriptions')
      .select('*')
      .or(`user_phone.eq.${p10},user_phone.eq.${cleanPhone}`)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await withTimeout(query, 1200);

    if (error || !data) return null;
    return data;
  } catch (err) {
    return null;
  }
}

/**
 * Sync payment record to Supabase payments table
 */
async function syncPaymentToSupabase(payment) {
  if (!supabase || !payment || !payment.orderId) return false;
  try {
    const cleanPhone = String(payment.userPhone || '').replace(/\D/g, '');
    const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      user_phone: p10,
      order_id: payment.orderId,
      payment_id: payment.paymentId || '',
      signature: payment.signature || '',
      amount: payment.amount || 200,
      currency: payment.currency || 'INR',
      status: payment.status || 'created',
      method: payment.method || 'razorpay',
      created_at: now,
      updated_at: now
    };

    const { error } = await supabase
      .from('payments')
      .upsert(payload, { onConflict: 'order_id' });

    if (error) {
      console.warn('⚠️ Supabase syncPayment error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('⚠️ Supabase syncPayment exception:', err.message);
    return false;
  }
}

/**
 * Sync single keyword to Supabase keywords table
 */
async function syncKeywordToSupabase(keyword, type = 'include', userPhone = '') {
  if (!supabase || !keyword) return false;
  try {
    const clean = String(keyword).trim().toLowerCase();
    const kwType = type === 'exclude' ? 'exclude' : 'include';
    const cleanPhone = userPhone ? String(userPhone).replace(/\D/g, '') : '';
    const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
    const now = Math.floor(Date.now() / 1000);

    const { error } = await supabase
      .from('keywords')
      .insert({
        keyword: clean,
        type: kwType,
        user_phone: p10,
        created_at: now
      });

    if (error) {
      console.warn('⚠️ Supabase syncKeyword error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('⚠️ Supabase syncKeyword exception:', err.message);
    return false;
  }
}

/**
 * Remove keyword from Supabase keywords table
 */
async function removeKeywordFromSupabase(keyword, type = 'include', userPhone = '') {
  if (!supabase || !keyword) return false;
  try {
    const clean = String(keyword).trim().toLowerCase();
    const kwType = type === 'exclude' ? 'exclude' : 'include';
    const cleanPhone = userPhone ? String(userPhone).replace(/\D/g, '') : '';
    const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;

    let query = supabase
      .from('keywords')
      .delete()
      .eq('keyword', clean)
      .eq('type', kwType);

    if (p10) {
      query = query.or(`user_phone.eq.${p10},user_phone.eq.''`);
    }

    const { error } = await query;
    if (error) {
      console.warn('⚠️ Supabase removeKeyword error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('⚠️ Supabase removeKeyword exception:', err.message);
    return false;
  }
}

/**
 * Fetch all keywords for a user from Supabase
 */
async function fetchKeywordsFromSupabase(userPhone = '') {
  if (!supabase) return null;
  try {
    const cleanPhone = userPhone ? String(userPhone).replace(/\D/g, '') : '';
    const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;

    let query = supabase.from('keywords').select('*');
    if (p10) {
      query = query.or(`user_phone.eq.${p10},user_phone.eq.''`);
    }

    const { data, error } = await query;
    if (error || !data) return null;
    return data;
  } catch (err) {
    console.warn('⚠️ Supabase fetchKeywords exception:', err.message);
    return null;
  }
}

/**
 * Sync connected WhatsApp session state to Supabase
 */
async function syncWhatsAppSessionToSupabase(userPhone, sessionData = {}) {
  if (!supabase || !userPhone) return false;
  try {
    const cleanPhone = String(userPhone).replace(/\D/g, '');
    const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      user_phone: p10,
      connected_jid: sessionData.jid || '',
      connected_name: sessionData.name || '',
      connected_phone: sessionData.phone || '',
      status: sessionData.status || 'connected',
      last_active: now
    };

    const { error } = await supabase
      .from('whatsapp_sessions')
      .upsert(payload, { onConflict: 'user_phone' });

    if (error) {
      console.warn('⚠️ Supabase syncWhatsAppSession error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('⚠️ Supabase syncWhatsAppSession exception:', err.message);
    return false;
  }
}

module.exports = {
  supabase,
  isSupabaseConfigured,
  syncMessageToSupabase,
  syncAIUpdateToSupabase,
  syncContactToSupabase,
  syncChatToSupabase,
  syncUserToSupabase,
  fetchUserFromSupabase,
  syncSubscriptionToSupabase,
  fetchSubscriptionFromSupabase,
  syncPaymentToSupabase,
  syncKeywordToSupabase,
  removeKeywordFromSupabase,
  fetchKeywordsFromSupabase,
  syncWhatsAppSessionToSupabase
};
