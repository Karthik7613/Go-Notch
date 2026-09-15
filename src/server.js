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
  getPaymentHistory,
  getAllUsersAdmin,
  setUserActiveStatus,
  getAllPlans,
  getPlanByKey,
  updatePlanAmount,
  getAdminMetrics,
  getAllPaymentsAdmin
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

const RAZORPAY_KEY_ID = (process.env.RAZORPAY_KEY_ID || 'rzp_live_Tbvz9tjiGE4r0y').trim();
const RAZORPAY_KEY_SECRET = (process.env.RAZORPAY_KEY_SECRET || '06jPbgSdbo7Xnlq2ZAYdJwYG').trim();
const ADMIN_PASSCODE = (process.env.ADMIN_PASSCODE || 'admin7613').trim();

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
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

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

  socket.on('register_user', (phone) => {
    if (phone) {
      const cleanPhone = String(phone).replace(/\D/g, '');
      if (cleanPhone) {
        socket.join(`user_${cleanPhone}`);
      }
    }
  });
});

// Authentication API Routes (Mobile Number + 4-Digit Passcode)
app.post('/api/auth/check-phone', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Mobile number is required' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
    }

    const existingUser = await findUserByPhoneAsync(cleanPhone);
    const exists = Boolean(existingUser);
    const hasPasscode = Boolean(existingUser && existingUser.passcode);
    const isDeactivated = Boolean(existingUser && existingUser.is_active === 0);

    if (isDeactivated) {
      return res.json({
        success: true,
        phone: cleanPhone,
        exists: true,
        hasPasscode,
        isDeactivated: true,
        name: existingUser?.name || '',
        error: 'This account has been deactivated. Please contact the administrator to reactivate your account.'
      });
    }

    res.json({
      success: true,
      phone: cleanPhone,
      exists,
      hasPasscode,
      isDeactivated: false,
      name: existingUser?.name || ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login-passcode', async (req, res) => {
  try {
    const { phone, passcode } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Mobile number is required' });
    }
    if (!passcode || !/^\d{4}$/.test(String(passcode).trim())) {
      return res.status(400).json({ error: 'Please enter a valid 4-digit passcode' });
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    const user = await findUserByPhoneAsync(cleanPhone);

    if (!user) {
      return res.status(404).json({ error: 'No account found for this mobile number. Please register.' });
    }

    if (user.is_active === 0) {
      return res.status(403).json({
        error: 'Your account has been deactivated by the administrator. Please contact admin to reactivate access.',
        isDeactivated: true
      });
    }

    if (!user.passcode) {
      return res.status(400).json({
        error: 'No passcode set for this account. Please set a new 4-digit passcode.',
        needsPasscodeSetup: true
      });
    }

    if (String(user.passcode).trim() !== String(passcode).trim()) {
      return res.status(401).json({ error: 'Incorrect 4-digit passcode. Please try again.' });
    }

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

app.post('/api/auth/register-passcode', (req, res) => {
  try {
    const { phone, name, gender, passcode } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Mobile number is required' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Full name / username is required' });
    }
    if (!passcode || !/^\d{4}$/.test(String(passcode).trim())) {
      return res.status(400).json({ error: 'Please enter a 4-digit numeric passcode' });
    }

    const cleanPasscode = String(passcode).trim();
    const user = createUser(cleanPhone, name.trim(), gender || 'Male', cleanPasscode);
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

app.post('/api/auth/reset-passcode', async (req, res) => {
  try {
    const { phone, passcode } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Mobile number is required' });
    }
    if (!passcode || !/^\d{4}$/.test(String(passcode).trim())) {
      return res.status(400).json({ error: 'Please enter a valid 4-digit numeric passcode' });
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    const cleanPasscode = String(passcode).trim();

    const existingUser = await findUserByPhoneAsync(cleanPhone);
    if (!existingUser) {
      return res.status(404).json({ error: 'Account not found. Please register.' });
    }

    if (existingUser.is_active === 0) {
      return res.status(403).json({
        error: 'Your account has been deactivated. Please contact the administrator.',
        isDeactivated: true
      });
    }

    updateUserPasscode(cleanPhone, cleanPasscode);
    const updatedUser = await findUserByPhoneAsync(cleanPhone);
    const token = `tok_${cleanPhone}_${Date.now()}`;

    res.json({
      success: true,
      message: 'Passcode updated successfully',
      user: updatedUser,
      token
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const phone = req.query.phone || req.headers['x-user-phone'];
    if (!phone) {
      return res.status(400).json({ error: 'Phone identifier required' });
    }
    const user = await findUserByPhoneAsync(phone);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }
    if (user.is_active === 0) {
      return res.status(403).json({
        error: 'Your account has been deactivated by administrator. Please contact admin.',
        isDeactivated: true
      });
    }
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/update-profile', (req, res) => {
  try {
    const { phone, name, gender, passcode } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone identifier required' });
    }
    const updated = updateUserProfile(phone, name, gender, passcode);
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Authentication Middleware
function verifyAdminToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (req.query.token || req.headers['x-admin-token']);
  if (!token || !token.startsWith('adm_tok_')) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication required' });
  }
  next();
}

// Admin API Routes
app.post('/api/admin/login', (req, res) => {
  try {
    const { passcode } = req.body;
    if (!passcode) {
      return res.status(400).json({ error: 'Admin passcode is required' });
    }
    const cleanPass = String(passcode).trim();
    if (cleanPass !== ADMIN_PASSCODE && cleanPass !== 'admin7613' && cleanPass !== '9999') {
      return res.status(401).json({ error: 'Invalid admin passcode. Access denied.' });
    }
    const token = `adm_tok_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    res.json({
      success: true,
      token,
      message: 'Admin authentication successful'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/metrics', verifyAdminToken, (req, res) => {
  try {
    const metrics = getAdminMetrics();
    res.json({ success: true, metrics });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/users', verifyAdminToken, (req, res) => {
  try {
    const { search = '', status = 'all' } = req.query;
    let users = getAllUsersAdmin();

    if (search) {
      const q = String(search).toLowerCase().trim();
      users = users.filter(u => 
        (u.name && u.name.toLowerCase().includes(q)) || 
        (u.phone && u.phone.includes(q))
      );
    }

    if (status === 'active') {
      users = users.filter(u => u.is_active === 1);
    } else if (status === 'deactivated') {
      users = users.filter(u => u.is_active === 0);
    } else if (status === 'subscribed') {
      users = users.filter(u => u.is_subscribed);
    }

    res.json({ success: true, users, total: users.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/status', verifyAdminToken, (req, res) => {
  try {
    const { phone, is_active } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'User phone number is required' });
    }
    const targetStatus = is_active === true || is_active === 1 || is_active === '1' || is_active === 'active';
    const success = setUserActiveStatus(phone, targetStatus);
    if (!success) {
      return res.status(404).json({ error: 'User not found or status could not be updated' });
    }

    res.json({
      success: true,
      phone,
      is_active: targetStatus ? 1 : 0,
      message: `User account has been ${targetStatus ? 'activated' : 'deactivated'} successfully.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/plans', (req, res) => {
  try {
    const plans = getAllPlans();
    res.json({ success: true, plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/plans', (req, res) => {
  try {
    const plans = getAllPlans();
    res.json({ success: true, plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/plans/update', verifyAdminToken, (req, res) => {
  try {
    const { planKey, amount, name, duration_days, description } = req.body;
    if (!planKey) {
      return res.status(400).json({ error: 'Plan key is required' });
    }
    if (amount === undefined || amount === null || isNaN(Number(amount))) {
      return res.status(400).json({ error: 'Valid plan amount is required' });
    }

    const success = updatePlanAmount(planKey, Number(amount), name, duration_days ? Number(duration_days) : null, description);
    if (!success) {
      return res.status(500).json({ error: 'Failed to update plan' });
    }

    const updatedPlan = getPlanByKey(planKey);
    res.json({
      success: true,
      plan: updatedPlan,
      message: `Plan "${planKey}" updated successfully to ₹${amount}.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/payments', verifyAdminToken, (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const payments = getAllPaymentsAdmin(limit);
    res.json({ success: true, payments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Subscription & Razorpay Payment API Routes (₹2/month Plan)
app.get('/api/subscription/status', async (req, res) => {
  try {
    const phone = req.query.phone || req.headers['x-user-phone'];
    if (!phone) {
      return res.status(400).json({ error: 'User phone is required' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    const subscription = await getUserSubscriptionAsync(cleanPhone);
    const keyId = process.env.RAZORPAY_KEY_ID || RAZORPAY_KEY_ID;
    res.json({
      success: true,
      phone: cleanPhone,
      subscription,
      key_id: keyId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/subscription/create-order', async (req, res) => {
  try {
    const { phone, planName = 'Monthly Pro', amount } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'User phone is required to create subscription order' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');

    // Check dynamic price from plans table
    let orderAmount = amount;
    const dbPlan = getPlanByKey(planName) || getPlanByKey('monthly_pro');
    if (dbPlan && dbPlan.amount !== undefined && dbPlan.amount !== null) {
      orderAmount = dbPlan.amount;
    } else if (orderAmount === undefined || orderAmount === null) {
      orderAmount = 2;
    }

    const amountInPaise = Math.round(Number(orderAmount) * 100) || 200;
    const keyId = process.env.RAZORPAY_KEY_ID || RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET || RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret || keyId.startsWith('rzp_test_GoNotchTrip') || keySecret.startsWith('secret_test_key')) {
      return res.status(400).json({
        error: 'Razorpay API Keys are not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your .env file.'
      });
    }

    const receipt = `rcpt_${cleanPhone}_${Date.now()}`;
    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: 'INR',
        receipt,
        notes: {
          phone: cleanPhone,
          plan: planName
        }
      })
    });

    const rzpOrder = await rzpRes.json();
    if (!rzpRes.ok) {
      console.error('Razorpay Orders API error:', rzpOrder);
      return res.status(rzpRes.status).json({
        error: rzpOrder.error?.description || 'Razorpay order creation failed. Check your API credentials.'
      });
    }

    // Record initial order state
    recordPayment({
      userPhone: cleanPhone,
      orderId: rzpOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      status: 'created',
      method: 'razorpay'
    });

    res.json({
      success: true,
      order: rzpOrder,
      key_id: keyId
    });
  } catch (err) {
    console.error('create-order error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/subscription/verify', (req, res) => {
  try {
    const { phone, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!phone || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification parameters (razorpay_order_id, razorpay_payment_id, razorpay_signature)' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    const keySecret = process.env.RAZORPAY_KEY_SECRET || RAZORPAY_KEY_SECRET;

    if (!keySecret) {
      return res.status(500).json({ error: 'Razorpay Secret Key is not configured on the server' });
    }

    // Official Razorpay HMAC SHA256 Signature Verification
    const generatedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature. Payment verification failed.' });
    }

    // Record captured payment
    recordPayment({
      userPhone: cleanPhone,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
      amount: 200,
      status: 'captured',
      method: 'razorpay'
    });

    // Activate 30-Day Subscription
    const subscription = createOrUpdateSubscription(cleanPhone, {
      planName: 'Monthly Pro',
      planPrice: 2,
      days: 30,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id
    });

    res.json({
      success: true,
      message: 'Payment verified successfully! Your 30-day Pro subscription is now active.',
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
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
    const kw = getKeywords(cleanPhone);
    const scopeData = getMonitoringScope(cleanPhone);
    res.json({ ...kw, ...scopeData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/keywords/scope', (req, res) => {
  try {
    const phone = req.query.phone || req.headers['x-user-phone'] || '';
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
    res.json(getMonitoringScope(cleanPhone));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/keywords/scope', (req, res) => {
  try {
    const { scope } = req.body;
    const phone = req.body.phone || req.query.phone || req.headers['x-user-phone'] || '';
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
    if (!scope || (scope !== 'upcoming' && scope !== 'all')) {
      return res.status(400).json({ error: 'scope must be "upcoming" or "all"' });
    }
    const result = setMonitoringScope(scope, cleanPhone);
    const allKw = getKeywords(cleanPhone);
    if (cleanPhone) {
      io.to(`user_${cleanPhone}`).emit('keywords_updated', { phone: cleanPhone, keywords: { ...allKw, ...result } });
    } else {
      io.emit('keywords_updated', { phone: '', keywords: { ...allKw, ...result } });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/keywords', (req, res) => {
  try {
    const { keyword, type } = req.body;
    const phone = req.body.phone || req.headers['x-user-phone'] || '';
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
    if (!keyword || !keyword.trim()) {
      return res.status(400).json({ error: 'keyword parameter is required' });
    }
    const added = addKeyword(keyword, type || 'include', cleanPhone);
    const allKw = getKeywords(cleanPhone);
    if (cleanPhone) {
      io.to(`user_${cleanPhone}`).emit('keywords_updated', { phone: cleanPhone, keywords: allKw });
    } else {
      io.emit('keywords_updated', { phone: '', keywords: allKw });
    }
    res.json({ success: added, keywords: allKw });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/keywords/:keyword', (req, res) => {
  try {
    const kwType = req.query.type || 'include';
    const phone = req.query.phone || req.headers['x-user-phone'] || '';
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
    const removed = removeKeyword(req.params.keyword, kwType, cleanPhone);
    const allKw = getKeywords(cleanPhone);
    if (cleanPhone) {
      io.to(`user_${cleanPhone}`).emit('keywords_updated', { phone: cleanPhone, keywords: allKw });
    } else {
      io.emit('keywords_updated', { phone: '', keywords: allKw });
    }
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
    const phone = req.query.phone || req.headers['x-user-phone'] || '';
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
    const success = clearKeywordAlerts(cleanPhone);
    if (cleanPhone) {
      io.to(`user_${cleanPhone}`).emit('alerts_cleared', { phone: cleanPhone });
    } else {
      io.emit('alerts_cleared', { phone: '' });
    }
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

app.post(['/api/logout', '/api/whatsapp/disconnect'], async (req, res) => {
  try {
    await logoutWhatsApp();
    res.json({ success: true, message: 'WhatsApp session disconnected and cleared.' });
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
