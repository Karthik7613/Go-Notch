const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, downloadMediaMessage, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { saveMessage, saveContacts, saveChats, updateRealChatName, updateMessageAI, getKeywords, getAllActiveKeywords, getMonitoringScope, resolveLidToPhone, formatPhoneNumber, enrichMessage, db } = require('./database');
const { transcribeAndTranslateAudio } = require('./ai');
const { syncWhatsAppSessionToSupabase } = require('./supabase');

const authFolder = process.env.AUTH_FOLDER || path.join(__dirname, '..', 'auth_info_baileys');
const mediaDir = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'media') : path.join(__dirname, '..', 'data', 'media');

if (!fs.existsSync(authFolder)) {
  fs.mkdirSync(authFolder, { recursive: true });
}

if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}

function loadCachedAuthCredentials() {
  try {
    const credsPath = path.join(authFolder, 'creds.json');
    if (fs.existsSync(credsPath)) {
      const credsRaw = fs.readFileSync(credsPath, 'utf8');
      const creds = JSON.parse(credsRaw);
      if (creds && creds.me && creds.me.id) {
        return {
          id: creds.me.id,
          name: creds.me.name || 'Connected User',
          phone: creds.me.id ? creds.me.id.split(':')[0] : ''
        };
      }
    }
  } catch (e) {
    console.warn('Could not read cached auth credentials:', e.message);
  }
  return null;
}

const initialUser = loadCachedAuthCredentials();
let sock = null;
let currentQr = null;
let connectionStatus = initialUser ? 'connected' : 'disconnected';
let userInfo = initialUser;
let ioInstance = null;
const groupNameCache = new Map();

function checkAndEmitKeywordAlert(msgData) {
  if (!ioInstance || !msgData) return;

  const fullText = `${msgData.content || ''} ${msgData.ai_transcript || ''} ${msgData.ai_translation || ''} ${msgData.chat_name || ''} ${msgData.sender_name || ''}`.toLowerCase();

  try {
    // Find all distinct users who have keywords in DB
    const userRows = db.prepare("SELECT DISTINCT user_phone FROM keywords WHERE user_phone != '' AND user_phone IS NOT NULL").all();
    const allPhones = [...new Set(userRows.map(r => r.user_phone).filter(Boolean))];

    for (const phone of allPhones) {
      const { scope, since } = getMonitoringScope(phone);
      if (scope === 'upcoming' && since > 0 && Number(msgData.timestamp) < since) {
        continue;
      }

      const { include, exclude } = getKeywords(phone);
      if (!include || include.length === 0) continue;

      const hasExclude = exclude.some(kw => kw && fullText.includes(kw.toLowerCase().trim()));
      if (hasExclude) continue;

      const matched = include.filter(kw => kw && fullText.includes(kw.toLowerCase().trim()));
      if (matched.length > 0) {
        // Emit targeted alert ONLY to this specific user's socket room
        ioInstance.to(`user_${phone}`).emit('keyword_alert', {
          ...msgData,
          matched_keywords: matched
        });
      }
    }

    // Also check global/unassigned keywords if any
    const { scope: globalScope, since: globalSince } = getMonitoringScope('');
    if (!(globalScope === 'upcoming' && globalSince > 0 && Number(msgData.timestamp) < globalSince)) {
      const globalKw = getKeywords('');
      if (globalKw && globalKw.include && globalKw.include.length > 0) {
        const hasExcludeGlobal = globalKw.exclude.some(kw => kw && fullText.includes(kw.toLowerCase().trim()));
        if (!hasExcludeGlobal) {
          const matchedGlobal = globalKw.include.filter(kw => kw && fullText.includes(kw.toLowerCase().trim()));
          if (matchedGlobal.length > 0) {
            ioInstance.to('user_').emit('keyword_alert', {
              ...msgData,
              matched_keywords: matchedGlobal
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('checkAndEmitKeywordAlert error:', e.message);
  }
}

function setSocketIO(io) {
  ioInstance = io;
}

function emitStatus() {
  if (ioInstance) {
    ioInstance.emit('status_update', {
      status: connectionStatus,
      qr: currentQr,
      user: userInfo
    });
  }
}

async function fetchRealGroupSubject(groupJid) {
  if (!sock || !groupJid || !groupJid.endsWith('@g.us')) return null;

  if (groupNameCache.has(groupJid)) {
    return groupNameCache.get(groupJid);
  }

  try {
    const meta = await sock.groupMetadata(groupJid);
    if (meta && meta.subject) {
      groupNameCache.set(groupJid, meta.subject);
      updateRealChatName(groupJid, meta.subject);
      if (ioInstance) ioInstance.emit('chats_updated');
      return meta.subject;
    }
  } catch (err) {
    // Ignore rate limits
  }
  return null;
}

async function resolveAllGroupNames() {
  if (!sock) return;
  try {
    const { getChatThreads } = require('./database');
    const threads = getChatThreads();
    for (const t of threads) {
      if (t.jid && t.jid.endsWith('@g.us') && (t.name.startsWith('Group (') || !t.name || t.name === t.jid)) {
        await fetchRealGroupSubject(t.jid);
        await new Promise(r => setTimeout(r, 200));
      }
    }
  } catch (e) {
    console.error('Error resolving group names:', e.message);
  }
}

const audioQueue = [];
let isProcessingAudio = false;

async function processAudioQueue() {
  if (isProcessingAudio || audioQueue.length === 0) return;
  isProcessingAudio = true;
  const item = audioQueue.shift();
  if (item) {
    try {
      const audioPath = await downloadMessageMedia(item.msgObj);
      const aiResult = await transcribeAndTranslateAudio(audioPath);
      if (aiResult) {
        item.parsedData.ai_transcript = aiResult.transcript;
        item.parsedData.ai_translation = aiResult.translation;
        updateMessageAI(item.parsedData.message_id, aiResult.transcript, aiResult.translation);
        if (ioInstance) {
          ioInstance.emit('new_message', item.parsedData);
          ioInstance.emit('chats_updated');
        }
      }
    } catch (err) {
      // Audio transcribe error ignored to prevent blocking
    }
  }
  isProcessingAudio = false;
  if (audioQueue.length > 0) {
    setTimeout(processAudioQueue, 300);
  }
}

function autoProcessAIMessage(msgObj, parsedData) {
  if (parsedData && parsedData.message_type === 'audio') {
    audioQueue.push({ msgObj, parsedData });
    processAudioQueue();
  }
}

let isConnecting = false;
let reconnectTimer = null;

async function connectToWhatsApp() {
  if (isConnecting) return;
  isConnecting = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Properly close and cleanup previous socket if existing
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      if (sock.ws) sock.ws.close();
    } catch (e) {}
    sock = null;
  }

  connectionStatus = 'connecting';
  emitStatus();

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers.macOS('Chrome'),
      syncFullHistory: false,
      markOnlineOnConnect: true,
      keepAliveIntervalMs: 25000,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      generateHighQualityLinkPreview: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('contacts.set', ({ contacts }) => {
      saveContacts(contacts);
      if (ioInstance) ioInstance.emit('contacts_updated');
    });

    sock.ev.on('contacts.upsert', (contacts) => {
      saveContacts(contacts);
      if (ioInstance) ioInstance.emit('contacts_updated');
    });

    sock.ev.on('chats.set', ({ chats }) => {
      saveChats(chats);
      if (ioInstance) ioInstance.emit('chats_updated');
      setTimeout(resolveAllGroupNames, 2000);
    });

    sock.ev.on('chats.upsert', (chats) => {
      saveChats(chats);
      if (ioInstance) ioInstance.emit('chats_updated');
      setTimeout(resolveAllGroupNames, 2000);
    });

    sock.ev.on('messaging-history.set', ({ contacts, chats, messages }) => {
      if (contacts) saveContacts(contacts);
      if (chats) saveChats(chats);

      if (messages && Array.isArray(messages) && messages.length > 0) {
        console.log(`📦 Syncing ${messages.length} historical WhatsApp messages...`);
        let savedCount = 0;
        for (const msg of messages) {
          if (!msg || !msg.key || msg.key.remoteJid === 'status@broadcast') continue;
          const parsed = parseWhatsAppMessage(msg);
          if (parsed) {
            if (saveMessage(parsed)) savedCount++;
          }
        }
        console.log(`✅ Saved ${savedCount} historical messages into SQLite!`);
      }

      if (ioInstance) {
        ioInstance.emit('contacts_updated');
        ioInstance.emit('chats_updated');
      }
      setTimeout(resolveAllGroupNames, 2000);
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQr = await QRCode.toDataURL(qr);
        connectionStatus = 'qr_ready';
        console.log('🔗 New QR code generated. Waiting for scan...');
        emitStatus();
      } else if (connection === 'connecting') {
        if (!currentQr) {
          connectionStatus = 'connecting';
          emitStatus();
        }
      } else if (connection === 'open') {
        connectionStatus = 'connected';
        currentQr = null;
        userInfo = {
          id: sock.user?.id || '',
          name: sock.user?.name || sock.user?.pushName || 'Connected User',
          phone: sock.user?.id ? sock.user.id.split(':')[0] : ''
        };
        console.log('✅ WhatsApp connected as:', userInfo.name, userInfo.phone);
        if (userInfo.phone) {
          syncWhatsAppSessionToSupabase(userInfo.phone, {
            jid: userInfo.id,
            name: userInfo.name,
            phone: userInfo.phone,
            status: 'connected'
          }).catch(() => {});
        }
        emitStatus();
        setTimeout(resolveAllGroupNames, 2000);
      } else if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errMsg = lastDisconnect?.error?.message || '';
        const isConflict = errMsg.includes('conflict') || statusCode === DisconnectReason.connectionReplaced;
        console.log('⚠️ WhatsApp socket closed:', errMsg || 'Unknown reason', '| Code:', statusCode, '| Conflict:', isConflict);

        // ALWAYS preserve cached user credentials so session is never lost on window close or network drops
        if (!userInfo) {
          userInfo = loadCachedAuthCredentials();
        }

        // Keep UI in connected/stable state if credentials exist
        connectionStatus = userInfo ? 'connected' : 'connecting';
        emitStatus();

        if (reconnectTimer) clearTimeout(reconnectTimer);
        const delay = isConflict ? 6000 : 3500;
        reconnectTimer = setTimeout(() => {
          connectToWhatsApp();
        }, delay);
      }
    });

  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (!m.messages || !m.messages.length) return;

      for (const msg of m.messages) {
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const messageData = parseWhatsAppMessage(msg);
        if (messageData) {
          if (messageData.chat_jid.endsWith('@g.us')) {
            const cachedName = groupNameCache.get(messageData.chat_jid);
            if (cachedName) {
              messageData.chat_name = cachedName;
            } else {
              fetchRealGroupSubject(messageData.chat_jid);
            }
          }

          saveMessage(messageData);

          if (ioInstance) {
            ioInstance.emit('new_message', messageData);
            ioInstance.emit('chats_updated');
            checkAndEmitKeywordAlert(messageData);
          }

          if (messageData.message_type === 'audio') {
            autoProcessAIMessage(msg, messageData);
          }
        }
      }
    } catch (err) {
      console.error('Error handling upsert message:', err.message);
    }
  });
  } catch (err) {
    console.error('Connection initialization error:', err.message);
  } finally {
    isConnecting = false;
  }

  return sock;
}

async function downloadMessageMedia(msgOrMessageId) {
  let messageObj = null;

  if (typeof msgOrMessageId === 'string') {
    const row = db.prepare('SELECT raw_json FROM messages WHERE message_id = ?').get(msgOrMessageId);
    if (row && row.raw_json) {
      try {
        messageObj = JSON.parse(row.raw_json);
      } catch (e) {}
    }
    const existingFile = path.join(mediaDir, `${msgOrMessageId}.ogg`);
    if (fs.existsSync(existingFile)) return existingFile;
  } else {
    messageObj = msgOrMessageId;
  }

  if (!messageObj || !messageObj.key) {
    throw new Error('Message payload not found for media download.');
  }

  const msgId = messageObj.key.id;
  const targetPath = path.join(mediaDir, `${msgId}.ogg`);

  if (fs.existsSync(targetPath)) {
    return targetPath;
  }

  const buffer = await downloadMediaMessage(
    messageObj,
    'buffer',
    {},
    {
      logger: pino({ level: 'silent' }),
      reconnectMode: 'on-demand'
    }
  );

  fs.writeFileSync(targetPath, buffer);
  return targetPath;
}

async function sendWhatsAppMessage(jid, text) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp client is not connected.');
  }

  const sent = await sock.sendMessage(jid, { text });
  const parsed = parseWhatsAppMessage(sent);
  if (parsed) {
    parsed.content = text;
    parsed.is_from_me = 1;
    saveMessage(parsed);
    if (ioInstance) {
      ioInstance.emit('new_message', parsed);
      ioInstance.emit('chats_updated');
    }
  }
  return parsed;
}

function unwrapMessageContent(m) {
  if (!m) return { content: '', type: 'text' };

  if (m.viewOnceMessage?.message) return unwrapMessageContent(m.viewOnceMessage.message);
  if (m.viewOnceMessageV2?.message) return unwrapMessageContent(m.viewOnceMessageV2.message);
  if (m.viewOnceMessageV2Extension?.message) return unwrapMessageContent(m.viewOnceMessageV2Extension.message);
  if (m.ephemeralMessage?.message) return unwrapMessageContent(m.ephemeralMessage.message);
  if (m.documentWithCaptionMessage?.message) return unwrapMessageContent(m.documentWithCaptionMessage.message);
  if (m.editedMessage?.message?.protocolMessage?.editedMessage) {
    return unwrapMessageContent(m.editedMessage.message.protocolMessage.editedMessage);
  }

  if (m.conversation) return { content: m.conversation, type: 'text' };

  if (m.extendedTextMessage) {
    let mainText = m.extendedTextMessage.text || '';
    const quoted = m.extendedTextMessage.contextInfo?.quotedMessage;
    if (quoted) {
      const quotedContent = unwrapMessageContent(quoted).content;
      if (quotedContent && quotedContent !== '[Message]') {
        mainText = `${mainText}\n[Quoted: ${quotedContent}]`.trim();
      }
    }
    return { content: mainText, type: 'text' };
  }

  if (m.imageMessage) return { content: m.imageMessage.caption || '[Photo]', type: 'image' };
  if (m.videoMessage) return { content: m.videoMessage.caption || '[Video]', type: 'video' };
  if (m.audioMessage) return { content: m.audioMessage.ptt ? '[Voice Note]' : '[Audio Record]', type: 'audio' };
  if (m.documentMessage) return { content: m.documentMessage.caption || m.documentMessage.fileName || m.documentMessage.title || '[Document]', type: 'document' };
  if (m.stickerMessage) return { content: '[Sticker]', type: 'sticker' };

  if (m.reactionMessage) {
    return { content: `Reaction: ${m.reactionMessage.text || '👍'}`, type: 'reaction' };
  }
  if (m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3) {
    const poll = m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3;
    const name = poll.name || 'Poll';
    const opts = poll.options ? poll.options.map(o => o.optionName).join(', ') : '';
    return { content: `📊 Poll: "${name}" ${opts ? `(${opts})` : ''}`, type: 'poll' };
  }
  if (m.templateButtonReplyMessage) {
    return { content: m.templateButtonReplyMessage.selectedDisplayText || '[Button Reply]', type: 'text' };
  }
  if (m.buttonsResponseMessage) {
    return { content: m.buttonsResponseMessage.selectedDisplayText || '[Button Reply]', type: 'text' };
  }
  if (m.listResponseMessage) {
    return { content: m.listResponseMessage.title || m.listResponseMessage.singleSelectReply?.selectedRowId || '[List Selection]', type: 'text' };
  }
  if (m.interactiveResponseMessage?.body?.text) {
    return { content: m.interactiveResponseMessage.body.text, type: 'text' };
  }
  if (m.locationMessage || m.liveLocationMessage) {
    const loc = m.locationMessage || m.liveLocationMessage;
    return { content: `📍 Location: (${loc.degreesLatitude?.toFixed(4)}, ${loc.degreesLongitude?.toFixed(4)})`, type: 'location' };
  }
  if (m.contactMessage) {
    return { content: `👤 Contact: ${m.contactMessage.displayName || 'Contact Card'}`, type: 'contact' };
  }
  if (m.contactsArrayMessage) {
    return { content: `👥 Contacts: ${m.contactsArrayMessage.displayName || 'Multiple Contacts'}`, type: 'contact' };
  }
  if (m.groupInviteMessage) {
    return { content: `✉️ Group Invite: ${m.groupInviteMessage.groupName || 'Group'}`, type: 'invite' };
  }
  if (m.protocolMessage) {
    const pm = m.protocolMessage;
    if (pm.type === 0) return { content: '🗑️ [Message Revoked/Deleted]', type: 'protocol' };
    return { content: '', type: 'protocol_internal' };
  }
  if (m.senderKeyDistributionMessage || m.fastRatchetKeyDistributionMessage || m.peerDataOperationRequestMessage || m.peerDataOperationRequestResponseMessage) {
    return { content: '', type: 'protocol_internal' };
  }

  const keys = Object.keys(m).filter(k => k !== 'messageContextInfo');
  if (keys.length > 0) {
    return { content: `[${keys[0].replace(/Message$/, '')}]`, type: 'other' };
  }

  return { content: '[Message]', type: 'other' };
}

function parseWhatsAppMessage(msg) {
  if (!msg || !msg.message) return null;

  const key = msg.key;
  if (!key || !key.remoteJid || key.remoteJid === 'status@broadcast') return null;
  const chatJid = key.remoteJid;

  const { content, type } = unwrapMessageContent(msg.message);
  // Completely ignore internal protocol synchronization packets
  if (type === 'protocol_internal' || (!content && type === 'other')) {
    return null;
  }
  const isFromMe = key.fromMe ? 1 : 0;
  const senderJid = key.participant || key.remoteJid;

  const senderPhone = senderJid ? resolveLidToPhone(senderJid) : '';
  const formattedPhone = senderPhone ? formatPhoneNumber(senderPhone) : '';

  const rawName = (msg.pushName || '').trim();
  let baseSenderName = '';
  if (isFromMe) {
    baseSenderName = 'Me';
  } else if (rawName && !rawName.includes('@lid') && !/^\d{13,}$/.test(rawName)) {
    baseSenderName = rawName;
  } else if (formattedPhone) {
    baseSenderName = formattedPhone;
  } else {
    baseSenderName = 'WhatsApp Member';
  }

  let chatName = groupNameCache.get(chatJid) || (chatJid.includes('@g.us') ? `Group (${chatJid.split('@')[0]})` : baseSenderName);

  let timestamp = msg.messageTimestamp;
  if (typeof timestamp === 'object' && timestamp !== null) {
    timestamp = timestamp.low || timestamp.toNumber?.() || Math.floor(Date.now() / 1000);
  }
  if (!timestamp) {
    timestamp = Math.floor(Date.now() / 1000);
  }

  const rawObj = {
    message_id: key.id,
    chat_jid: chatJid,
    sender_jid: senderJid,
    sender_name: baseSenderName,
    sender_phone: senderPhone,
    sender_formatted_phone: formattedPhone,
    chat_name: chatName,
    content: content,
    message_type: type,
    is_from_me: isFromMe,
    timestamp: timestamp,
    raw_json: {
      key: key,
      pushName: msg.pushName,
      message: msg.message
    }
  };

  return enrichMessage(rawObj);
}

async function logoutWhatsApp() {
  try {
    if (sock) {
      sock.ev.removeAllListeners();
      if (sock.ws) sock.ws.close();
      await Promise.race([
        sock.logout().catch(() => {}),
        new Promise(r => setTimeout(r, 1000))
      ]);
    }
  } catch (e) {
    console.log('Error during logout:', e.message);
  }
  sock = null;

  if (fs.existsSync(authFolder)) {
    try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch (e) {}
  }
  if (!fs.existsSync(authFolder)) {
    try { fs.mkdirSync(authFolder, { recursive: true }); } catch (e) {}
  }

  connectionStatus = 'disconnected';
  currentQr = null;
  userInfo = null;
  groupNameCache.clear();
  emitStatus();

  setTimeout(() => {
    connectToWhatsApp();
  }, 500);
}

const os = require('os');

function getLocalIp() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch (e) {}
  return 'localhost';
}

function getStatus() {
  if (!userInfo) {
    userInfo = loadCachedAuthCredentials();
  }
  const isCurrentlyConnected = connectionStatus === 'connected' || Boolean(userInfo && userInfo.phone);
  return {
    status: isCurrentlyConnected ? 'connected' : connectionStatus,
    qr: isCurrentlyConnected ? null : currentQr,
    user: userInfo,
    serverIp: getLocalIp()
  };
}

module.exports = {
  setSocketIO,
  connectToWhatsApp,
  downloadMessageMedia,
  sendWhatsAppMessage,
  logoutWhatsApp,
  getStatus
};
