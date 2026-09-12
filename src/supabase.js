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

module.exports = {
  supabase,
  isSupabaseConfigured,
  syncMessageToSupabase,
  syncAIUpdateToSupabase,
  syncContactToSupabase,
  syncChatToSupabase
};
