process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err.stack || err.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason?.stack || reason?.message || reason);
});

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { 
  getChatThreads,
  getThreadMessages,
  getMessages, 
  getContacts, 
  getStats,
  addKeyword,
  removeKeyword,
  getKeywords,
  getMonitoringScope,
  setMonitoringScope,
  getKeywordAlerts,
  clearKeywordAlerts
} = require('./database');
const { 
  setSocketIO, 
  connectToWhatsApp, 
  downloadMessageMedia,
  sendWhatsAppMessage,
  logoutWhatsApp, 
  getStatus 
} = require('./whatsapp');
const { transcribeAndTranslateAudio } = require('./ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

setSocketIO(io);

io.on('connection', (socket) => {
  console.log('⚡ Client connected to Socket.io dashboard:', socket.id);
  socket.emit('status_update', getStatus());
});

// API Routes
app.get('/api/status', (req, res) => {
  res.json(getStatus());
});

app.get('/api/threads', (req, res) => {
  try {
    const threads = getChatThreads(req.query.q);
    res.json(threads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/threads/:jid/messages', (req, res) => {
  try {
    const messages = getThreadMessages(req.params.jid, req.query.limit);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stream audio media for voice notes
app.get('/api/media/:messageId', async (req, res) => {
  const { messageId } = req.params;
  try {
    const filePath = await downloadMessageMedia(messageId);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Audio media file not found.');
    }
    res.setHeader('Content-Type', 'audio/ogg');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('Error fetching audio media:', err.message);
    res.status(500).send('Error downloading audio media');
  }
});

// AI Audio Speech-to-Text Transcription & Translation Endpoint
app.post('/api/media/:messageId/transcribe', async (req, res) => {
  const { messageId } = req.params;
  try {
    const filePath = await downloadMessageMedia(messageId);
    const result = await transcribeAndTranslateAudio(filePath);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('AI Transcription Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages/send', async (req, res) => {
  const { jid, text } = req.body;
  if (!jid || !text || !text.trim()) {
    return res.status(400).json({ error: 'jid and text are required.' });
  }

  try {
    const sentMsg = await sendWhatsAppMessage(jid, text.trim());
    res.json({ success: true, message: sentMsg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages', (req, res) => {
  try {
    const result = getMessages(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/contacts', (req, res) => {
  try {
    const contacts = getContacts(req.query.q);
    res.json(contacts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    const stats = getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Keyword Monitoring & Alerts API Routes
app.get('/api/keywords', (req, res) => {
  try {
    const kw = getKeywords();
    const scopeData = getMonitoringScope();
    res.json({ ...kw, ...scopeData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/keywords/scope', (req, res) => {
  try {
    res.json(getMonitoringScope());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/keywords/scope', (req, res) => {
  try {
    const { scope } = req.body;
    if (!scope || (scope !== 'upcoming' && scope !== 'all')) {
      return res.status(400).json({ error: 'scope must be "upcoming" or "all"' });
    }
    const result = setMonitoringScope(scope);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/keywords', (req, res) => {
  try {
    const { keyword, type } = req.body;
    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ error: 'keyword parameter is required' });
    }
    const added = addKeyword(keyword, type || 'include');
    res.json({ success: added, keywords: getKeywords() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/keywords/:keyword', (req, res) => {
  try {
    const kwType = req.query.type || 'include';
    const removed = removeKeyword(req.params.keyword, kwType);
    res.json({ success: removed, keywords: getKeywords() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/keywords/alerts', (req, res) => {
  try {
    const alerts = getKeywordAlerts(req.query.limit || 100);
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/keywords/alerts', (req, res) => {
  try {
    const success = clearKeywordAlerts();
    res.json({ success, alerts: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/export', (req, res) => {
  try {
    const format = (req.query.format || 'json').toLowerCase();
    const { messages } = getMessages({ ...req.query, limit: 5000, offset: 0 });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="whatsapp_messages.csv"');

      const headers = ['ID', 'WhatsApp Msg ID', 'Date & Time', 'Chat', 'Sender', 'Sender Number', 'Content', 'Type', 'Is From Me'];
      const csvRows = [headers.join(',')];

      for (const m of messages) {
        const dateStr = new Date(m.timestamp * 1000).toLocaleString();
        const cleanContent = `"${(m.content || '').replace(/"/g, '""')}"`;
        const cleanSender = `"${(m.sender_name || '').replace(/"/g, '""')}"`;
        const cleanChat = `"${(m.chat_name || '').replace(/"/g, '""')}"`;

        csvRows.push([
          m.id,
          m.message_id,
          `"${dateStr}"`,
          cleanChat,
          cleanSender,
          m.sender_jid,
          cleanContent,
          m.message_type,
          m.is_from_me ? 'Yes' : 'No'
        ].join(','));
      }

      return res.send(csvRows.join('\n'));
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="whatsapp_messages.json"');
      return res.json(messages);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    await logoutWhatsApp();
    res.json({ success: true, message: 'Logged out and WhatsApp session cleared.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, async () => {
  console.log(`\n🚀 WhatsApp Message Monitor Server running at http://${HOST}:${PORT}`);
  console.log('📱 Connecting to WhatsApp Web client...\n');
  try {
    await connectToWhatsApp();
  } catch (e) {
    console.error('Error connecting to WhatsApp on startup:', e.message);
  }
});
