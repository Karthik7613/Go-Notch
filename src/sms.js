const https = require('https');

// Keep-alive agent to eliminate repeated TLS handshake latency to Fast2SMS
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 5,
  timeout: 6000
});

/**
 * Fast2SMS Gateway Integration (Ultra-Fast Direct Delivery + Fallback)
 * Docs: https://www.fast2sms.com/dashboard/api-docs
 */

const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY || '';
// Fast2SMS dedicated "otp" route requires website/DLT verification on their dashboard.
// Default to quick transactional route ('q') for instant ~300ms delivery.
let isOtpRouteVerified = false;

/**
 * Send an OTP message via Fast2SMS
 * @param {string} phone - 10-digit Indian mobile number
 * @param {string} otp - 6-digit OTP string
 * @returns {Promise<{success: boolean, message: string, route?: string, request_id?: string}>}
 */
async function sendSMSOtp(phone, otp) {
  const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
  const apiKey = (process.env.FAST2SMS_API_KEY || FAST2SMS_API_KEY).trim();

  if (!apiKey) {
    return {
      success: false,
      message: 'Fast2SMS API key not configured in .env'
    };
  }

  // 1. If OTP route was previously verified, try it first
  if (isOtpRouteVerified) {
    const otpRes = await tryOtpRoute(cleanPhone, otp, apiKey);
    if (otpRes.success) {
      return otpRes;
    }
    if (otpRes.message && (otpRes.message.includes('verification') || otpRes.message.includes('DLT'))) {
      isOtpRouteVerified = false;
    }
  }

  // 2. Direct Ultra-Fast delivery via Quick Route (~300ms)
  const quickResult = await tryQuickRoute(cleanPhone, otp, apiKey);
  if (quickResult.success) {
    return quickResult;
  }

  // 3. Fallback to OTP route if quick route failed and otp route hasn't been checked yet
  if (!isOtpRouteVerified && isOtpRouteVerified !== false) {
    const fallbackOtp = await tryOtpRoute(cleanPhone, otp, apiKey);
    if (fallbackOtp.success) {
      isOtpRouteVerified = true;
      return fallbackOtp;
    }
  }

  return quickResult;
}

/**
 * Fast2SMS Dedicated OTP Route (~₹0.25 rate)
 */
function tryOtpRoute(phone, otp, apiKey) {
  return new Promise((resolve) => {
    try {
      const payload = JSON.stringify({
        route: 'otp',
        variables_values: String(otp),
        numbers: phone
      });

      const options = {
        hostname: 'www.fast2sms.com',
        path: '/dev/bulkV2',
        method: 'POST',
        agent: httpsAgent,
        headers: {
          'authorization': apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 6000
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.return === true || data.status_code === 200 || (Array.isArray(data.message) && data.message[0]?.includes('successfully'))) {
              resolve({
                success: true,
                route: 'otp',
                message: `SMS OTP sent successfully to +91 ${phone}`,
                request_id: data.request_id
              });
            } else {
              const msg = Array.isArray(data.message) ? data.message.join(', ') : (data.message || 'OTP route rejected');
              resolve({ success: false, message: msg });
            }
          } catch (e) {
            resolve({ success: false, message: 'Invalid JSON from OTP route' });
          }
        });
      });

      req.on('error', (e) => resolve({ success: false, message: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false, message: 'Timeout' }); });
      req.write(payload);
      req.end();
    } catch (err) {
      resolve({ success: false, message: err.message });
    }
  });
}

/**
 * Fast2SMS Quick Route Fallback
 */
function tryQuickRoute(phone, otp, apiKey) {
  return new Promise((resolve) => {
    try {
      const query = new URLSearchParams({
        authorization: apiKey,
        route: 'q',
        message: `Your Go-Notch OTP verification code is ${otp}. Valid for 5 minutes.`,
        language: 'english',
        flash: '0',
        numbers: phone
      }).toString();

      const req = https.request({
        hostname: 'www.fast2sms.com',
        path: `/dev/bulkV2?${query}`,
        method: 'GET',
        agent: httpsAgent,
        timeout: 6000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.return === true || data.status_code === 200 || (Array.isArray(data.message) && data.message[0]?.includes('successfully'))) {
              console.log(`✅ [Fast2SMS Quick Route] Sent successfully to +91 ${phone}`);
              resolve({
                success: true,
                route: 'q',
                message: `SMS OTP sent successfully to +91 ${phone}`,
                request_id: data.request_id
              });
            } else {
              const msg = Array.isArray(data.message) ? data.message.join(', ') : (data.message || 'SMS delivery failed');
              resolve({ success: false, message: msg });
            }
          } catch (e) {
            resolve({ success: false, message: 'Parse error' });
          }
        });
      });

      req.on('error', (e) => resolve({ success: false, message: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false, message: 'Timeout' }); });
      req.end();
    } catch (err) {
      resolve({ success: false, message: err.message });
    }
  });
}

module.exports = {
  sendSMSOtp
};
