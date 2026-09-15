const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const {
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
} = require('./supabase');


const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const authFolder = process.env.AUTH_FOLDER || path.join(__dirname, '..', 'auth_info_baileys');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(authFolder)) {
  fs.mkdirSync(authFolder, { recursive: true });
}

const dbPath = path.join(dataDir, 'messages.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT UNIQUE,
      chat_jid TEXT NOT NULL,
      sender_jid TEXT NOT NULL,
      sender_name TEXT,
      chat_name TEXT,
      content TEXT,
      message_type TEXT DEFAULT 'text',
      is_from_me INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL,
      raw_json TEXT,
      ai_transcript TEXT,
      ai_translation TEXT
    );

    CREATE TABLE IF NOT EXISTS contacts (
      jid TEXT PRIMARY KEY,
      name TEXT,
      notify TEXT,
      phone TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      unread_count INTEGER DEFAULT 0,
      conversation_timestamp INTEGER,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      type TEXT DEFAULT 'include',
      user_phone TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      name TEXT,
      gender TEXT,
      passcode TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS otps (
      phone TEXT PRIMARY KEY,
      otp TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_phone TEXT NOT NULL,
      plan_name TEXT DEFAULT 'Monthly Pro',
      plan_price INTEGER DEFAULT 49,
      status TEXT DEFAULT 'active',
      started_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      payment_id TEXT,
      order_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_phone TEXT NOT NULL,
      order_id TEXT UNIQUE NOT NULL,
      payment_id TEXT,
      signature TEXT,
      amount INTEGER NOT NULL,
      currency TEXT DEFAULT 'INR',
      status TEXT DEFAULT 'created',
      method TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Migration for existing tables
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN ai_transcript TEXT;`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN ai_translation TEXT;`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE keywords ADD COLUMN type TEXT DEFAULT 'include';`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN passcode TEXT;`);
  } catch (e) {}
  // Migration for keywords table if it had old column-level UNIQUE constraint
  try {
    const kwTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE name='keywords'").get();
    if (kwTableSql && kwTableSql.sql && kwTableSql.sql.includes('keyword TEXT UNIQUE')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS keywords_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          keyword TEXT NOT NULL,
          type TEXT DEFAULT 'include',
          user_phone TEXT DEFAULT '',
          created_at INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO keywords_new (id, keyword, type, user_phone, created_at)
          SELECT id, keyword, COALESCE(type, 'include'), COALESCE(user_phone, ''), created_at FROM keywords;
        DROP TABLE keywords;
        ALTER TABLE keywords_new RENAME TO keywords;
      `);
    }
  } catch (e) {
    console.error('Migration error for keywords table:', e.message);
  }

  // Drop old global unique index if present and create per-user unique index
  try {
    db.exec(`DROP INDEX IF EXISTS idx_keywords_unique;`);
  } catch (e) {}
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_keywords_user_unique ON keywords(keyword, type, user_phone);`);
  } catch (e) {}

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_jid);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_jid);
    CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);
    CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
    CREATE INDEX IF NOT EXISTS idx_chats_timestamp ON chats(conversation_timestamp DESC);
  `);
}

initDb();

const insertMsgStmt = db.prepare(`
  INSERT OR IGNORE INTO messages (
    message_id, chat_jid, sender_jid, sender_name, chat_name,
    content, message_type, is_from_me, timestamp, raw_json,
    ai_transcript, ai_translation
  ) VALUES (
    @message_id, @chat_jid, @sender_jid, @sender_name, @chat_name,
    @content, @message_type, @is_from_me, @timestamp, @raw_json,
    @ai_transcript, @ai_translation
  )
`);

const upsertContactStmt = db.prepare(`
  INSERT INTO contacts (jid, name, notify, phone, updated_at)
  VALUES (@jid, @name, @notify, @phone, @updated_at)
  ON CONFLICT(jid) DO UPDATE SET
    name = CASE 
      WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name != '' AND EXCLUDED.name NOT LIKE '%@%' THEN EXCLUDED.name 
      ELSE contacts.name 
    END,
    notify = COALESCE(EXCLUDED.notify, contacts.notify),
    updated_at = EXCLUDED.updated_at
`);

const upsertChatStmt = db.prepare(`
  INSERT INTO chats (jid, name, unread_count, conversation_timestamp, updated_at)
  VALUES (@jid, @name, @unread_count, @conversation_timestamp, @updated_at)
  ON CONFLICT(jid) DO UPDATE SET
    name = CASE 
      WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name != '' AND EXCLUDED.name NOT LIKE 'Group (%)' THEN EXCLUDED.name 
      ELSE chats.name 
    END,
    conversation_timestamp = MAX(COALESCE(chats.conversation_timestamp, 0), COALESCE(EXCLUDED.conversation_timestamp, 0)),
    updated_at = EXCLUDED.updated_at
`);

function saveMessage(msg) {
  try {
    const info = insertMsgStmt.run({
      message_id: msg.message_id,
      chat_jid: msg.chat_jid,
      sender_jid: msg.sender_jid,
      sender_name: msg.sender_name || 'Unknown',
      chat_name: msg.chat_name || msg.chat_jid,
      content: msg.content || '',
      message_type: msg.message_type || 'text',
      is_from_me: msg.is_from_me ? 1 : 0,
      timestamp: msg.timestamp,
      raw_json: JSON.stringify(msg.raw_json || {}),
      ai_transcript: msg.ai_transcript || null,
      ai_translation: msg.ai_translation || null
    });

    const now = Math.floor(Date.now() / 1000);

    if (msg.sender_jid) {
      const resolvedPhone = resolveLidToPhone(msg.sender_jid);
      const phone = (resolvedPhone && !/^\d{13,}$/.test(resolvedPhone)) ? resolvedPhone : (msg.sender_jid.includes('@lid') ? '' : msg.sender_jid.split('@')[0]);
      const cleanName = (msg.sender_name && !msg.sender_name.includes('@lid') && !/^\d{13,}$/.test(msg.sender_name)) ? msg.sender_name : (phone ? formatPhoneNumber(phone) : 'Contact');
      upsertContactStmt.run({
        jid: msg.sender_jid,
        name: cleanName,
        notify: msg.sender_name || '',
        phone: phone,
        updated_at: now
      });
    }

    if (msg.chat_jid) {
      upsertChatStmt.run({
        jid: msg.chat_jid,
        name: msg.chat_name || msg.chat_jid,
        unread_count: 0,
        conversation_timestamp: msg.timestamp,
        updated_at: now
      });
    }

    // Sync to Supabase cloud database if configured
    syncMessageToSupabase(msg).catch(() => {});

    return info.changes > 0;
  } catch (err) {
    console.error('Error saving message to SQLite:', err.message);
    return false;
  }
}

function updateMessageAI(messageId, transcript, translation) {
  try {
    db.prepare('UPDATE messages SET ai_transcript = ?, ai_translation = ? WHERE message_id = ?')
      .run(transcript, translation, messageId);

    // Sync AI transcription updates to Supabase
    syncAIUpdateToSupabase(messageId, transcript, translation).catch(() => {});
  } catch (err) {
    console.error('Error updating message AI results:', err.message);
  }
}

function saveContacts(contactsList) {
  if (!Array.isArray(contactsList)) return;
  const now = Math.floor(Date.now() / 1000);
  const transaction = db.transaction((list) => {
    for (const c of list) {
      if (!c.id) continue;
      const phone = c.id.split('@')[0];
      const displayName = c.name || c.verifiedName || c.notify || phone;
      upsertContactStmt.run({
        jid: c.id,
        name: displayName,
        notify: c.notify || '',
        phone: phone,
        updated_at: now
      });

      upsertChatStmt.run({
        jid: c.id,
        name: displayName,
        unread_count: 0,
        conversation_timestamp: now,
        updated_at: now
      });
    }
  });
  try {
    transaction(contactsList);
  } catch (err) {
    console.error('Error saving contacts:', err.message);
  }
}

function saveChats(chatsList) {
  if (!Array.isArray(chatsList)) return;
  const now = Math.floor(Date.now() / 1000);
  const transaction = db.transaction((list) => {
    for (const c of list) {
      if (!c.id) continue;
      let ts = c.conversationTimestamp;
      if (typeof ts === 'object' && ts !== null) ts = ts.low || ts.toNumber?.() || now;
      const displayName = c.name || c.subject || (c.id.includes('@g.us') ? null : c.id.split('@')[0]);
      if (displayName) {
        upsertChatStmt.run({
          jid: c.id,
          name: displayName,
          unread_count: c.unreadCount || 0,
          conversation_timestamp: ts || now,
          updated_at: now
        });
      }
    }
  });
  try {
    transaction(chatsList);
  } catch (err) {
    console.error('Error saving chats:', err.message);
  }
}

function updateRealChatName(chatJid, realName) {
  if (!chatJid || !realName) return;
  try {
    db.prepare('UPDATE chats SET name = ? WHERE jid = ?').run(realName, chatJid);
    db.prepare('UPDATE messages SET chat_name = ? WHERE chat_jid = ?').run(realName, chatJid);
    db.prepare('UPDATE contacts SET name = ? WHERE jid = ?').run(realName, chatJid);
  } catch (err) {
    console.error('Error updating real chat name:', err.message);
  }
}

const lidCache = new Map();

function resolveLidToPhone(jid) {
  if (!jid) return '';
  const cleanJid = jid.split(':')[0];
  if (!cleanJid.includes('@lid')) {
    return cleanJid.split('@')[0];
  }
  const lid = cleanJid.split('@')[0];
  if (lidCache.has(lid)) return lidCache.get(lid);

  // 1. Check Baileys reverse LID mapping file
  const revPath = path.join(authFolder, `lid-mapping-${lid}_reverse.json`);
  if (fs.existsSync(revPath)) {
    try {
      const phone = JSON.parse(fs.readFileSync(revPath, 'utf8'));
      if (phone) {
        lidCache.set(lid, String(phone));
        return String(phone);
      }
    } catch (e) {}
  }

  // 2. Check contacts table for phone
  try {
    const contact = db.prepare('SELECT phone FROM contacts WHERE jid = ? OR jid LIKE ?').get(jid, `${lid}%`);
    if (contact && contact.phone && !contact.phone.includes('@lid') && contact.phone.length >= 7 && contact.phone !== lid) {
      lidCache.set(lid, contact.phone);
      return contact.phone;
    }
  } catch (e) {}

  return '';
}

function formatPhoneNumber(raw) {
  if (!raw) return '';
  const clean = String(raw).replace(/[^0-9]/g, '');
  if (clean === '21968959045662') {
    return '+91 93452 33351';
  }
  // WhatsApp internal LIDs (13-16 digits) are not phone numbers
  if (/^\d{13,16}$/.test(clean)) {
    return '';
  }
  if (clean.length === 12 && clean.startsWith('91')) {
    return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
  } else if (clean.length === 10) {
    return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
  } else if (clean.length > 5 && clean.length <= 12) {
    return `+${clean}`;
  }
  return '';
}

function enrichMessage(m) {
  if (!m) return m;

  let senderPhone = m.sender_phone || '';
  if (!senderPhone && m.sender_jid) {
    senderPhone = resolveLidToPhone(m.sender_jid);
  }
  if (senderPhone && /^\d{13,}$/.test(senderPhone)) {
    senderPhone = '';
  }
  let formattedPhone = senderPhone ? formatPhoneNumber(senderPhone) : '';

  let rawName = (m.sender_name || '').trim();
  const isInternalId = !rawName || 
    rawName.includes('@lid') || 
    rawName.includes('@newsletter') || 
    rawName.startsWith('120363') || 
    /^\d{13,}$/.test(rawName);

  let cleanName = '';
  if (isInternalId) {
    if (m.sender_jid) {
      try {
        const contact = db.prepare('SELECT name FROM contacts WHERE jid = ?').get(m.sender_jid);
        if (contact && contact.name && !contact.name.includes('@lid') && !/^\d{13,}$/.test(contact.name)) {
          cleanName = contact.name.trim();
        }
      } catch (e) {}
    }
  } else {
    cleanName = rawName;
  }

  if (cleanName) {
    cleanName = cleanName.replace(/\s*\(\+?91[\d\s-]+\)\s*$/, '').trim();
  }

  let finalName = '';
  if (m.is_from_me === 1) {
    finalName = 'Me';
  } else if (cleanName && formattedPhone) {
    finalName = `${cleanName} (${formattedPhone})`;
  } else if (cleanName) {
    finalName = cleanName;
  } else if (formattedPhone) {
    finalName = formattedPhone;
  } else {
    finalName = 'WhatsApp Member';
  }

  return {
    ...m,
    sender_phone: senderPhone,
    sender_formatted_phone: formattedPhone,
    sender_name: finalName,
    sender_display: finalName
  };
}

function getChatThreads(query = '') {
  let where = '';
  let params = [];
  if (query && query.trim()) {
    where = 'WHERE (c.name LIKE ? OR c.jid LIKE ? OR m.content LIKE ? OR m.sender_name LIKE ? OR m.ai_transcript LIKE ?)';
    const q = `%${query.trim()}%`;
    params = [q, q, q, q, q];
  }

  const sql = `
    SELECT 
      c.jid,
      COALESCE(NULLIF(c.name, ''), m.chat_name, c.jid) as name,
      c.unread_count,
      COALESCE(m.ai_transcript, m.content) as last_message,
      m.sender_name as last_sender,
      m.message_type as last_type,
      m.is_from_me as last_is_from_me,
      COALESCE(m.timestamp, c.conversation_timestamp, 0) as last_timestamp
    FROM (
      SELECT jid, name, unread_count, conversation_timestamp, updated_at FROM chats
      UNION
      SELECT jid, name, 0 as unread_count, 0 as conversation_timestamp, updated_at FROM contacts
      UNION
      SELECT DISTINCT chat_jid as jid, chat_name as name, 0 as unread_count, MAX(timestamp) as conversation_timestamp, MAX(timestamp) as updated_at FROM messages GROUP BY chat_jid
    ) c
    LEFT JOIN messages m ON m.id = (
      SELECT id FROM messages 
      WHERE chat_jid = c.jid 
      ORDER BY timestamp DESC, id DESC 
      LIMIT 1
    )
    ${where}
    GROUP BY c.jid
    ORDER BY (m.timestamp IS NOT NULL) DESC, last_timestamp DESC
    LIMIT 500
  `;

  const rows = db.prepare(sql).all(...params);
  return rows.map(t => {
    const isGroup = t.jid.endsWith('@g.us');
    const isNewsletter = t.jid.endsWith('@newsletter');
    let phone = '';
    let displayPhone = '';
    if (!isGroup && !isNewsletter) {
      phone = resolveLidToPhone(t.jid);
      displayPhone = formatPhoneNumber(phone);
    }
    let displayName = t.name;
    if (isNewsletter && (displayName.startsWith('120363') || displayName.includes('@newsletter'))) {
      displayName = 'WhatsApp Channel';
    } else if (/^\d{13,}$/.test(displayName) || displayName.includes('@lid')) {
      displayName = displayPhone || displayName;
    }
    return {
      ...t,
      name: displayName,
      phone,
      display_phone: displayPhone
    };
  });
}

function getThreadMessages(chatJid, limit = 500) {
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT * FROM messages 
      WHERE chat_jid = ? 
      ORDER BY timestamp DESC, id DESC 
      LIMIT ?
    ) ORDER BY timestamp ASC, id ASC
  `).all(chatJid, Number(limit));

  return rows.map(enrichMessage);
}

function getMessages({ q, chat, sender, startDate, endDate, type, limit = 50, offset = 0 }) {
  let where = ['1=1'];
  let params = {};

  if (q && q.trim()) {
    where.push('(content LIKE @q OR sender_name LIKE @q OR chat_name LIKE @q OR ai_transcript LIKE @q)');
    params.q = `%${q.trim()}%`;
  }

  if (chat && chat.trim()) {
    where.push('chat_jid = @chat');
    params.chat = chat.trim();
  }

  if (sender && sender.trim()) {
    where.push('sender_jid = @sender');
    params.sender = sender.trim();
  }

  if (startDate) {
    const startMs = new Date(startDate).getTime();
    if (!isNaN(startMs)) {
      where.push('timestamp >= @startDate');
      params.startDate = Math.floor(startMs / 1000);
    }
  }

  if (endDate) {
    const endMs = new Date(endDate).getTime();
    if (!isNaN(endMs)) {
      where.push('timestamp <= @endDate');
      params.endDate = Math.floor(endMs / 1000) + 86400;
    }
  }

  if (type && type !== 'all') {
    where.push('message_type = @type');
    params.type = type;
  }

  const whereClause = where.join(' AND ');

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM messages WHERE ${whereClause}`);
  const total = countStmt.get(params).total;

  const dataStmt = db.prepare(`
    SELECT * FROM messages 
    WHERE ${whereClause} 
    ORDER BY timestamp DESC 
    LIMIT @limit OFFSET @offset
  `);

  params.limit = Number(limit);
  params.offset = Number(offset);

  const messages = dataStmt.all(params).map(enrichMessage);

  return {
    total,
    messages,
    limit: params.limit,
    offset: params.offset
  };
}

function getContacts(query = '') {
  if (query && query.trim()) {
    const q = `%${query.trim()}%`;
    return db.prepare(`
      SELECT * FROM contacts 
      WHERE name LIKE ? OR phone LIKE ? OR jid LIKE ? 
      ORDER BY name ASC 
      LIMIT 500
    `).all(q, q, q);
  }
  return db.prepare('SELECT * FROM contacts ORDER BY name ASC LIMIT 500').all();
}

function getStats() {
  const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const todayMessages = db.prepare('SELECT COUNT(*) as count FROM messages WHERE timestamp >= ?').get(startOfDay).count;
  const totalChats = db.prepare('SELECT COUNT(DISTINCT jid) as count FROM (SELECT jid FROM chats UNION SELECT jid FROM contacts UNION SELECT chat_jid as jid FROM messages)').get().count;
  const totalContacts = db.prepare('SELECT COUNT(DISTINCT jid) as count FROM (SELECT jid FROM contacts UNION SELECT sender_jid as jid FROM messages WHERE is_from_me = 0)').get().count;

  return {
    totalMessages,
    todayMessages,
    totalChats,
    totalSenders: totalContacts
  };
}

const DEFAULT_INCLUDE_KEYWORDS = ['chennai', 'airport', 'drop', 'pickup', 'trip', 'outstation', 'cab', 'urgent', 'bangalore', 'pondicherry'];
const DEFAULT_EXCLUDE_KEYWORDS = ['vacant', 'going', 'reaching', 'free', 'waiting'];

function ensureUserHasKeywords(userPhone) {
  if (!userPhone) return;
  const cleanPhone = String(userPhone).replace(/\D/g, '');
  if (!cleanPhone) return;

  try {
    const initSetting = db.prepare("SELECT value FROM settings WHERE key = ?").get(`kw_init_${cleanPhone}`);
    if (initSetting) return;

    const countRow = db.prepare("SELECT COUNT(*) as cnt FROM keywords WHERE user_phone = ?").get(cleanPhone);
    if (countRow && countRow.cnt > 0) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')").run(`kw_init_${cleanPhone}`);
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const insertStmt = db.prepare("INSERT OR IGNORE INTO keywords (keyword, type, user_phone, created_at) VALUES (?, ?, ?, ?)");

    for (const kw of DEFAULT_INCLUDE_KEYWORDS) {
      if (kw && kw.trim()) {
        const clean = kw.trim().toLowerCase();
        insertStmt.run(clean, 'include', cleanPhone, now);
        syncKeywordToSupabase(clean, 'include', cleanPhone).catch(() => {});
      }
    }
    for (const kw of DEFAULT_EXCLUDE_KEYWORDS) {
      if (kw && kw.trim()) {
        const clean = kw.trim().toLowerCase();
        insertStmt.run(clean, 'exclude', cleanPhone, now);
        syncKeywordToSupabase(clean, 'exclude', cleanPhone).catch(() => {});
      }
    }

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')").run(`kw_init_${cleanPhone}`);
  } catch (e) {
    console.error('ensureUserHasKeywords error:', e.message);
  }
}

function addKeyword(keyword, type = 'include', userPhone = '') {
  if (!keyword || !keyword.trim()) return false;
  const kwType = type === 'exclude' ? 'exclude' : 'include';
  const cleanPhone = userPhone ? String(userPhone).replace(/\D/g, '') : '';
  
  if (cleanPhone) {
    ensureUserHasKeywords(cleanPhone);
  }

  // Support comma, semicolon, newline or slash separated tokens
  const parts = keyword.split(/[,;\n]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return false;

  let anyAdded = false;
  const insertStmt = db.prepare('INSERT OR IGNORE INTO keywords (keyword, type, user_phone, created_at) VALUES (?, ?, ?, ?)');
  const now = Math.floor(Date.now() / 1000);

  for (const clean of parts) {
    try {
      const info = insertStmt.run(clean, kwType, cleanPhone, now);
      if (info.changes > 0) {
        anyAdded = true;
        // Asynchronously sync to Supabase
        syncKeywordToSupabase(clean, kwType, cleanPhone).catch(() => {});
      }
    } catch (e) {
      console.error('addKeyword token error:', clean, e.message);
    }
  }
  return true;
}

function removeKeyword(keyword, type = 'include', userPhone = '') {
  if (!keyword) return false;
  const clean = keyword.trim().toLowerCase();
  const kwType = type === 'exclude' ? 'exclude' : 'include';
  const cleanPhone = userPhone ? String(userPhone).replace(/\D/g, '') : '';
  
  if (cleanPhone) {
    try {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')").run(`kw_init_${cleanPhone}`);
    } catch (e) {}
  }

  try {
    if (cleanPhone) {
      db.prepare("DELETE FROM keywords WHERE LOWER(keyword) = ? AND COALESCE(type, 'include') = ? AND user_phone = ?").run(clean, kwType, cleanPhone);
    } else {
      db.prepare("DELETE FROM keywords WHERE LOWER(keyword) = ? AND COALESCE(type, 'include') = ? AND (user_phone = '' OR user_phone IS NULL)").run(clean, kwType);
    }
    // Asynchronously remove from Supabase
    removeKeywordFromSupabase(clean, kwType, cleanPhone).catch(() => {});
    return true;
  } catch (e) {
    console.error('removeKeyword error:', e.message);
    return false;
  }
}

function getAllActiveKeywords() {
  try {
    const rows = db.prepare("SELECT DISTINCT LOWER(keyword) as keyword, COALESCE(type, 'include') as type FROM keywords ORDER BY id ASC").all();
    const include = [...new Set(rows.filter(r => r.type === 'include').map(r => r.keyword.trim()))];
    const exclude = [...new Set(rows.filter(r => r.type === 'exclude').map(r => r.keyword.trim()))];
    return { include, exclude };
  } catch (e) {
    console.error('getAllActiveKeywords error:', e.message);
    return { include: [], exclude: [] };
  }
}

function getKeywords(userPhone = '') {
  const cleanPhone = userPhone ? String(userPhone).replace(/\D/g, '') : '';
  try {
    if (cleanPhone) {
      ensureUserHasKeywords(cleanPhone);
    }

    let rows = [];
    if (cleanPhone) {
      rows = db.prepare("SELECT DISTINCT LOWER(keyword) as keyword, COALESCE(type, 'include') as type FROM keywords WHERE user_phone = ? ORDER BY id ASC").all(cleanPhone);
    } else {
      rows = db.prepare("SELECT DISTINCT LOWER(keyword) as keyword, COALESCE(type, 'include') as type FROM keywords WHERE user_phone = '' OR user_phone IS NULL ORDER BY id ASC").all();
    }
    const include = [...new Set(rows.filter(r => r.type === 'include').map(r => r.keyword.trim()))];
    const exclude = [...new Set(rows.filter(r => r.type === 'exclude').map(r => r.keyword.trim()))];
    return { include, exclude };
  } catch (e) {
    console.error('getKeywords error:', e.message);
    return { include: [], exclude: [] };
  }
}

function clearKeywordAlerts() {
  const now = Math.floor(Date.now() / 1000);
  try {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('cleared_matching_timestamp', ?)`).run(String(now));
    return true;
  } catch (e) {
    console.error('Error clearing keyword alerts:', e.message);
    return false;
  }
}

function getClearedMatchingTimestamp() {
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'cleared_matching_timestamp'`).get();
    if (!row) return 0;
    let val = Number(row.value);
    if (val > 10000000000) {
      val = Math.floor(val / 1000);
    }
    return val;
  } catch (e) {
    return 0;
  }
}

function getMonitoringScope() {
  try {
    const scopeRow = db.prepare(`SELECT value FROM settings WHERE key = 'monitoring_scope'`).get();
    const sinceRow = db.prepare(`SELECT value FROM settings WHERE key = 'monitoring_upcoming_since'`).get();
    const scope = (scopeRow && scopeRow.value === 'all') ? 'all' : 'upcoming';
    let since = sinceRow ? Number(sinceRow.value) : 0;
    if (scope === 'upcoming' && since === 0) {
      since = Math.floor(Date.now() / 1000);
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('monitoring_upcoming_since', ?)`).run(String(since));
    }
    return { scope, since };
  } catch (e) {
    return { scope: 'upcoming', since: 0 };
  }
}

function setMonitoringScope(scope) {
  const cleanScope = scope === 'all' ? 'all' : 'upcoming';
  const now = Math.floor(Date.now() / 1000);
  try {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('monitoring_scope', ?)`).run(cleanScope);
    if (cleanScope === 'upcoming') {
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('monitoring_upcoming_since', ?)`).run(String(now));
      return { scope: cleanScope, since: now };
    } else {
      return { scope: cleanScope, since: 0 };
    }
  } catch (e) {
    console.error('Error setting monitoring scope:', e.message);
    return { scope: cleanScope, since: 0 };
  }
}

function getKeywordAlerts(limit = 100, userPhone = '') {
  const { include, exclude } = getKeywords(userPhone);
  if (!include || include.length === 0) return [];

  const clearedTime = getClearedMatchingTimestamp();
  const { scope, since } = getMonitoringScope();

  const includeClauses = [];
  const excludeClauses = [];
  const params = {};

  include.forEach((kw, idx) => {
    const paramKey = `inc_${idx}`;
    includeClauses.push(`(
      LOWER(COALESCE(content, '')) LIKE @${paramKey} OR 
      LOWER(COALESCE(ai_transcript, '')) LIKE @${paramKey} OR 
      LOWER(COALESCE(ai_translation, '')) LIKE @${paramKey} OR
      LOWER(COALESCE(chat_name, '')) LIKE @${paramKey} OR
      LOWER(COALESCE(sender_name, '')) LIKE @${paramKey}
    )`);
    params[paramKey] = `%${kw.toLowerCase().trim()}%`;
  });

  exclude.forEach((kw, idx) => {
    const paramKey = `exc_${idx}`;
    excludeClauses.push(`(
      LOWER(COALESCE(content, '')) LIKE @${paramKey} OR 
      LOWER(COALESCE(ai_transcript, '')) LIKE @${paramKey} OR 
      LOWER(COALESCE(ai_translation, '')) LIKE @${paramKey}
    )`);
    params[paramKey] = `%${kw.toLowerCase().trim()}%`;
  });

  const includeSql = `(${includeClauses.join(' OR ')})`;
  const excludeSql = excludeClauses.length > 0 ? ` AND NOT (${excludeClauses.join(' OR ')})` : '';

  let minTimestamp = 0;
  if (scope === 'upcoming') {
    minTimestamp = Math.max(clearedTime, (since ? since - 120 : 0));
  } else {
    minTimestamp = clearedTime;
  }

  const timeSql = minTimestamp > 0 ? ` AND timestamp >= @minTimestamp` : '';
  if (minTimestamp > 0) params.minTimestamp = minTimestamp;

  const sql = `
    SELECT * FROM messages 
    WHERE ${includeSql}${excludeSql}${timeSql} 
    ORDER BY timestamp DESC 
    LIMIT @limit
  `;

  params.limit = Number(limit);

  try {
    const rows = db.prepare(sql).all(params);
    return rows.filter(msg => {
      const fullText = `${msg.content || ''} ${msg.ai_transcript || ''} ${msg.ai_translation || ''} ${msg.chat_name || ''} ${msg.sender_name || ''}`.toLowerCase();
      const hasExclude = exclude.some(kw => kw && fullText.includes(kw.toLowerCase().trim()));
      return !hasExclude;
    }).map(msg => {
      const fullText = `${msg.content || ''} ${msg.ai_transcript || ''} ${msg.ai_translation || ''} ${msg.chat_name || ''} ${msg.sender_name || ''}`.toLowerCase();
      const matchedKeywords = include.filter(kw => kw && fullText.includes(kw.toLowerCase().trim()));
      return {
        ...enrichMessage(msg),
        matched_keywords: matchedKeywords
      };
    });
  } catch (e) {
    console.error('Error fetching keyword alerts:', e.message);
    return [];
  }
}

function normalizePhoneDigits(phone) {
  if (!phone) return '';
  const clean = String(phone).replace(/\D/g, '');
  return clean.length >= 10 ? clean.slice(-10) : clean;
}

function findUserByPhone(phone) {
  if (!phone) return null;
  const rawStr = String(phone).trim();
  const cleanPhone = rawStr.replace(/\D/g, '');
  if (!cleanPhone) return null;
  const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
  const p12 = `91${p10}`;

  try {
    const user = db.prepare(`
      SELECT * FROM users 
      WHERE phone = ? OR phone = ? OR phone = ? OR phone = ? OR phone = ? OR phone = ?
         OR phone LIKE ? OR phone LIKE ?
      ORDER BY id DESC LIMIT 1
    `).get(cleanPhone, p10, p12, `+${p12}`, `+${p10}`, rawStr, `%${p10}`, `%${cleanPhone}`);
    return user || null;
  } catch (e) {
    console.error('findUserByPhone error:', e.message);
    return null;
  }
}

async function findUserByPhoneAsync(phone) {
  let user = findUserByPhone(phone);
  if (user) return user;

  // Fallback check in Supabase if user is not in local SQLite cache
  try {
    const sbUser = await fetchUserFromSupabase(phone);
    if (sbUser) {
      const cleanPhone = String(sbUser.phone || phone).replace(/\D/g, '');
      const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
      const now = Math.floor(Date.now() / 1000);

      db.prepare(`
        INSERT OR REPLACE INTO users (phone, name, gender, passcode, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        p10,
        sbUser.name || 'User',
        sbUser.gender || 'Male',
        sbUser.passcode ? String(sbUser.passcode).trim() : null,
        sbUser.created_at || now,
        sbUser.updated_at || now
      );
      ensureUserHasKeywords(p10);
      return findUserByPhone(p10);
    }
  } catch (e) {
    console.warn('findUserByPhoneAsync Supabase lookup exception:', e.message);
  }

  return null;
}

function createUser(phone, name, gender = 'Male', passcode = '') {
  if (!phone) return null;
  const rawStr = String(phone).trim();
  const cleanPhone = rawStr.replace(/\D/g, '');
  const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
  const cleanPasscode = passcode ? String(passcode).trim() : null;
  const now = Math.floor(Date.now() / 1000);
  try {
    const existing = findUserByPhone(cleanPhone);
    let finalUser = null;
    if (existing) {
      db.prepare('UPDATE users SET name = COALESCE(?, name), gender = COALESCE(?, gender), passcode = COALESCE(?, passcode), updated_at = ? WHERE id = ?')
        .run(name || null, gender || null, cleanPasscode, now, existing.id);
      ensureUserHasKeywords(existing.phone || p10);
      finalUser = findUserByPhone(existing.phone || p10);
    } else {
      const info = db.prepare('INSERT INTO users (phone, name, gender, passcode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(p10, name || 'User', gender || 'Male', cleanPasscode, now, now);
      ensureUserHasKeywords(p10);
      finalUser = findUserByPhone(p10);
    }
    if (finalUser) {
      syncUserToSupabase(finalUser).catch(() => {});
    }
    return finalUser;
  } catch (e) {
    console.error('createUser error:', e.message);
    return null;
  }
}

function updateUserPasscode(phone, passcode) {
  if (!phone || !passcode) return false;
  const cleanPhone = String(phone).replace(/\D/g, '');
  const cleanPasscode = String(passcode).trim();
  const now = Math.floor(Date.now() / 1000);
  try {
    const existing = findUserByPhone(cleanPhone);
    if (!existing) return false;
    db.prepare('UPDATE users SET passcode = ?, updated_at = ? WHERE id = ?')
      .run(cleanPasscode, now, existing.id);
    const updated = findUserByPhone(cleanPhone);
    if (updated) {
      syncUserToSupabase(updated).catch(() => {});
    }
    return true;
  } catch (e) {
    console.error('updateUserPasscode error:', e.message);
    return false;
  }
}

function verifyUserPasscode(phone, passcode) {
  if (!phone || !passcode) return false;
  const user = findUserByPhone(phone);
  if (!user || !user.passcode) return false;
  return String(user.passcode).trim() === String(passcode).trim();
}

function updateUserProfile(phone, name, gender, passcode) {
  if (!phone) return null;
  const rawStr = String(phone).trim();
  const cleanPhone = rawStr.replace(/\D/g, '');
  const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
  const now = Math.floor(Date.now() / 1000);
  const cleanPasscode = passcode ? String(passcode).trim() : null;
  try {
    const existing = findUserByPhone(cleanPhone);
    let finalUser = null;
    if (existing) {
      db.prepare('UPDATE users SET name = COALESCE(?, name), gender = COALESCE(?, gender), passcode = COALESCE(?, passcode), updated_at = ? WHERE id = ?')
        .run(name || null, gender || null, cleanPasscode, now, existing.id);
      finalUser = findUserByPhone(existing.phone || p10);
    } else {
      finalUser = createUser(p10, name, gender, passcode);
    }
    if (finalUser) {
      syncUserToSupabase(finalUser).catch(() => {});
    }
    return finalUser;
  } catch (e) {
    console.error('updateUserProfile error:', e.message);
    return null;
  }
}

function saveOtp(phone, otp, ttlSeconds = 600) {
  if (!phone || !otp) return false;
  const cleanPhone = String(phone).replace(/\D/g, '');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttlSeconds;
  try {
    db.prepare('INSERT OR REPLACE INTO otps (phone, otp, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(cleanPhone, String(otp).trim(), expiresAt, now);
    return true;
  } catch (e) {
    console.error('saveOtp error:', e.message);
    return false;
  }
}

function verifyOtp(phone, otp) {
  if (!phone || !otp) return false;
  const cleanPhone = String(phone).replace(/\D/g, '');
  const cleanOtp = String(otp).trim();
  const now = Math.floor(Date.now() / 1000);

  try {
    const row = db.prepare('SELECT * FROM otps WHERE phone = ? AND expires_at >= ?').get(cleanPhone, now);
    if (row && row.otp === cleanOtp) {
      // Consume OTP
      db.prepare('DELETE FROM otps WHERE phone = ?').run(cleanPhone);
      return true;
    }
    return false;
  } catch (e) {
    console.error('verifyOtp error:', e.message);
    return false;
  }
}

function getUserSubscription(phone) {
  if (!phone) return { is_subscribed: false, status: 'inactive' };
  const cleanPhone = String(phone).replace(/\D/g, '');
  const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
  const now = Math.floor(Date.now() / 1000);

  try {
    const row = db.prepare(`
      SELECT * FROM subscriptions 
      WHERE user_phone = ? OR user_phone = ? OR user_phone = ? OR user_phone LIKE ?
      ORDER BY expires_at DESC, id DESC 
      LIMIT 1
    `).get(cleanPhone, p10, `91${p10}`, `%${p10}`);

    if (!row) {
      return {
        is_subscribed: false,
        status: 'inactive',
        plan_name: 'Free Trial / None',
        plan_price: 0,
        days_left: 0,
        expires_at: 0
      };
    }

    const isActive = row.status === 'active' && row.expires_at > now;
    const secondsLeft = Math.max(0, row.expires_at - now);
    const daysLeft = Math.ceil(secondsLeft / 86400);

    return {
      is_subscribed: isActive,
      id: row.id,
      user_phone: row.user_phone,
      plan_name: row.plan_name || 'Monthly Pro',
      plan_price: row.plan_price || 2,
      status: isActive ? 'active' : 'expired',
      started_at: row.started_at,
      expires_at: row.expires_at,
      days_left: daysLeft,
      payment_id: row.payment_id || '',
      order_id: row.order_id || ''
    };
  } catch (e) {
    console.error('getUserSubscription error:', e.message);
    return { is_subscribed: false, status: 'error', error: e.message };
  }
}

async function getUserSubscriptionAsync(phone) {
  const sub = getUserSubscription(phone);
  if (sub && sub.is_subscribed) return sub;

  try {
    const sbSub = await fetchSubscriptionFromSupabase(phone);
    if (sbSub) {
      const cleanPhone = String(sbSub.user_phone || phone).replace(/\D/g, '');
      const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
      const now = Math.floor(Date.now() / 1000);

      db.prepare(`
        INSERT OR REPLACE INTO subscriptions (user_phone, plan_name, plan_price, status, started_at, expires_at, payment_id, order_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        p10,
        sbSub.plan_name || 'Monthly Pro',
        sbSub.plan_price || 2,
        sbSub.status || 'active',
        sbSub.started_at || now,
        sbSub.expires_at || (now + 30 * 86400),
        sbSub.payment_id || '',
        sbSub.order_id || '',
        sbSub.created_at || now,
        sbSub.updated_at || now
      );
      return getUserSubscription(p10);
    }
  } catch (e) {
    console.warn('getUserSubscriptionAsync Supabase lookup exception:', e.message);
  }

  return sub;
}

function createOrUpdateSubscription(phone, { planName = 'Monthly Pro', planPrice = 2, days = 30, paymentId = '', orderId = '' } = {}) {
  const rawPhone = String(phone).replace(/\D/g, '');
  const cleanPhone = rawPhone.length >= 10 ? rawPhone.slice(-10) : rawPhone;
  if (!cleanPhone) throw new Error('Phone number is required for subscription');

  const now = Math.floor(Date.now() / 1000);
  const current = getUserSubscription(cleanPhone);

  let startedAt = now;
  let expiresAt = now + (days * 86400);

  // If already active, extend from current expiry date
  if (current && current.is_subscribed && current.expires_at > now) {
    startedAt = current.started_at;
    expiresAt = current.expires_at + (days * 86400);
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO subscriptions (user_phone, plan_name, plan_price, status, started_at, expires_at, payment_id, order_id, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(cleanPhone, planName, planPrice, startedAt, expiresAt, paymentId, orderId, now, now);

    const updatedSub = getUserSubscription(cleanPhone);
    if (updatedSub) {
      syncSubscriptionToSupabase(updatedSub).catch(() => {});
    }
    return updatedSub;
  } catch (e) {
    console.error('createOrUpdateSubscription error:', e.message);
    throw e;
  }
}

function recordPayment({ userPhone, orderId, paymentId = '', signature = '', amount = 200, currency = 'INR', status = 'created', method = 'razorpay' }) {
  const rawPhone = String(userPhone).replace(/\D/g, '');
  const cleanPhone = rawPhone.length >= 10 ? rawPhone.slice(-10) : cleanPhone;
  const now = Math.floor(Date.now() / 1000);

  try {
    const stmt = db.prepare(`
      INSERT INTO payments (user_phone, order_id, payment_id, signature, amount, currency, status, method, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET
        payment_id = COALESCE(excluded.payment_id, payments.payment_id),
        signature = COALESCE(excluded.signature, payments.signature),
        status = excluded.status,
        updated_at = excluded.updated_at
    `);
    stmt.run(cleanPhone, orderId, paymentId, signature, amount, currency, status, method, now, now);
    
    // Sync payment to Supabase
    syncPaymentToSupabase({
      userPhone: cleanPhone,
      orderId,
      paymentId,
      signature,
      amount,
      currency,
      status,
      method
    }).catch(() => {});

    return true;
  } catch (e) {
    console.error('recordPayment error:', e.message);
    return false;
  }
}

function getPaymentHistory(phone) {
  if (!phone) return [];
  const cleanPhone = String(phone).replace(/\D/g, '');
  const p10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
  try {
    return db.prepare(`
      SELECT * FROM payments 
      WHERE user_phone = ? OR user_phone = ? OR user_phone = ? OR user_phone LIKE ?
      ORDER BY created_at DESC LIMIT 50
    `).all(cleanPhone, p10, `91${p10}`, `%${p10}`);
  } catch (e) {
    console.error('getPaymentHistory error:', e.message);
    return [];
  }
}

module.exports = {
  db,
  saveMessage,
  updateMessageAI,
  saveContacts,
  saveChats,
  updateRealChatName,
  getChatThreads,
  getThreadMessages,
  getMessages,
  getContacts,
  getStats,
  addKeyword,
  removeKeyword,
  getKeywords,
  getAllActiveKeywords,
  getMonitoringScope,
  setMonitoringScope,
  getKeywordAlerts,
  clearKeywordAlerts,
  resolveLidToPhone,
  formatPhoneNumber,
  enrichMessage,
  findUserByPhone,
  findUserByPhoneAsync,
  createUser,
  updateUserProfile,
  updateUserPasscode,
  verifyUserPasscode,
  saveOtp,
  verifyOtp,
  getUserSubscription,
  getUserSubscriptionAsync,
  createOrUpdateSubscription,
  recordPayment,
  getPaymentHistory
};
