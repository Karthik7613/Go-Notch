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
const crypto = require('crypto');
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
  clearKeywordAlerts,
  findUserByPhone,
  createUser,
  updateUserProfile,
  saveOtp,
  verifyOtp,
  getUserSubscription,
  createOrUpdateSubscription,
  recordPayment,
  getPaymentHistory
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

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_GoNotchTrip49';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'secret_test_key_GoNotch49';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check endpoint for Railway and cloud monitoring
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

app.get('/api/status', (req, res) => {
  res.json(getStatus());
});

setSocketIO(io);

io.on('connection', (socket) => {
  console.log('⚡ Client connected to Socket.io dashboard:', socket.id);
  socket.emit('status_update', getStatus());
});

// Authentication API Routes (Mobile Number + OTP + Profile Setup)
app.post('/api/auth/send-otp', (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Mobile number is required' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
    }

    const existingUser = findUserByPhone(cleanPhone);
    const isNewUser = !existingUser;
    
    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    saveOtp(cleanPhone, otp, 600); // 10 mins expiry

    console.log(`🔑 OTP generated for ${cleanPhone}: ${otp} (isNewUser: ${isNewUser})`);

    res.json({
      success: true,
      phone: cleanPhone,
      isNewUser,
      otp, // Provided for easy preview and automated testing
      message: isNewUser ? 'OTP sent for registration' : 'OTP sent for login'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/verify-otp', (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ error: 'Mobile number and OTP are required' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    const isValid = verifyOtp(cleanPhone, otp);
    
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid or expired OTP. Please try again or use 1234.' });
    }

    const existingUser = findUserByPhone(cleanPhone);
    if (existingUser) {
      const token = `tok_${cleanPhone}_${Date.now()}`;
      return res.json({
        success: true,
        isNewUser: false,
        user: existingUser,
        token
      });
    } else {
      return res.json({
        success: true,
        isNewUser: true,
        phone: cleanPhone,
        message: 'OTP verified. Please complete your profile.'
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/complete-profile', (req, res) => {
  try {
    const { phone, name, gender } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Username / Full Name is required' });
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    const user = createUser(cleanPhone, name.trim(), gender || 'Male');
    const token = `tok_${cleanPhone}_${Date.now()}`;

    res.json({
      success: true,
      user,
      token
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', (req, res) => {
  try {
    const phone = req.query.phone || req.headers['x-user-phone'];
    if (!phone) {
      return res.status(400).json({ error: 'Phone identifier required' });
    }
    const user = findUserByPhone(phone);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/update-profile', (req, res) => {
  try {
    const { phone, name, gender } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone identifier required' });
    }
    const updated = updateUserProfile(phone, name, gender);
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Subscription & Razorpay Payment API Routes (₹49/month Plan)
app.get('/api/subscription/status', (req, res) => {
  try {
    const phone = req.query.phone || req.headers['x-user-phone'];
    if (!phone) {
      return res.status(400).json({ error: 'User phone is required' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    const subscription = getUserSubscription(cleanPhone);
    res.json({
      success: true,
      phone: cleanPhone,
      subscription,
      key_id: RAZORPAY_KEY_ID
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/subscription/create-order', async (req, res) => {
  try {
    const { phone, planName = 'Monthly Pro', amount = 49 } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'User phone is required to create subscription order' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    const amountInPaise = Math.round(Number(amount) * 100) || 4900;
    const orderId = `order_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

    // Record initial order state
    recordPayment({
      userPhone: cleanPhone,
      orderId,
      amount: amountInPaise,
      currency: 'INR',
      status: 'created',
      method: 'razorpay'
    });

    res.json({
      success: true,
      order: {
        id: orderId,
        amount: amountInPaise,
        currency: 'INR',
        receipt: `rcpt_${cleanPhone}_${Date.now()}`,
        plan_name: planName
      },
      key_id: RAZORPAY_KEY_ID
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/subscription/verify', (req, res) => {
  try {
    const { phone, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!phone || !razorpay_order_id || !razorpay_payment_id) {
      return res.status(400).json({ error: 'Missing payment verification parameters' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');

    // Signature verification with Razorpay Secret
    let isValidSignature = true;
    if (razorpay_signature && RAZORPAY_KEY_SECRET && !RAZORPAY_KEY_SECRET.startsWith('secret_test_key')) {
      const generatedSignature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');
      isValidSignature = (generatedSignature === razorpay_signature);
    }

    if (!isValidSignature) {
      return res.status(400).json({ error: 'Invalid payment signature. Verification failed.' });
    }

    // Record captured payment
    recordPayment({
      userPhone: cleanPhone,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature || 'verified_test',
      amount: 4900,
      status: 'captured',
      method: 'razorpay'
    });

    // Activate 30-Day Subscription
    const subscription = createOrUpdateSubscription(cleanPhone, {
      planName: 'Monthly Pro',
      planPrice: 49,
      days: 30,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id
    });

    res.json({
      success: true,
      message: 'Subscription successfully activated for 30 days!',
      subscription
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/subscription/activate-test', (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    const dummyPaymentId = `pay_test_${Date.now()}`;
    const dummyOrderId = `ord_test_${Date.now()}`;

    recordPayment({
      userPhone: cleanPhone,
      orderId: dummyOrderId,
      paymentId: dummyPaymentId,
      signature: 'test_instant_bypass',
      amount: 4900,
      status: 'captured',
      method: 'razorpay_test'
    });

    const subscription = createOrUpdateSubscription(cleanPhone, {
      planName: 'Monthly Pro (Test Mode)',
      planPrice: 49,
      days: 30,
      paymentId: dummyPaymentId,
      orderId: dummyOrderId
    });

    res.json({
      success: true,
      message: 'Test subscription activated for 30 days!',
      subscription
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/subscription/payments', (req, res) => {
  try {
    const phone = req.query.phone || req.headers['x-user-phone'];
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    const payments = getPaymentHistory(phone);
    res.json({ success: true, payments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// WhatsApp & Dashboard API Routes

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
    const phone = req.query.phone || req.headers['x-user-phone'] || '';
    const kw = getKeywords(phone);
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
    io.emit('keywords_updated', getKeywords());
    io.emit('keyword_alert');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/keywords', (req, res) => {
  try {
    const { keyword, type } = req.body;
    const phone = req.body.phone || req.headers['x-user-phone'] || '';
    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ error: 'keyword parameter is required' });
    }
    const added = addKeyword(keyword, type || 'include', phone);
    const allKw = getKeywords(phone);
    io.emit('keywords_updated', allKw);
    io.emit('keyword_alert');
    res.json({ success: added, keywords: allKw });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/keywords/:keyword', (req, res) => {
  try {
    const kwType = req.query.type || 'include';
    const phone = req.query.phone || req.headers['x-user-phone'] || '';
    const removed = removeKeyword(req.params.keyword, kwType, phone);
    const allKw = getKeywords(phone);
    io.emit('keywords_updated', allKw);
    io.emit('keyword_alert');
    res.json({ success: removed, keywords: allKw });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/keywords/alerts', (req, res) => {
  try {
    const phone = req.query.phone || req.headers['x-user-phone'] || '';
    const alerts = getKeywordAlerts(req.query.limit || 100, phone);
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/keywords/alerts', (req, res) => {
  try {
    const success = clearKeywordAlerts();
    io.emit('keyword_alert');
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
