document.addEventListener('DOMContentLoaded', () => {
  function safeCreateIcons() {
    if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') {
      try {
        lucide.createIcons();
      } catch (e) {
        console.warn('lucide createIcons warning:', e);
      }
    }
  }

  // Execute icon creation immediately
  safeCreateIcons();
  setTimeout(safeCreateIcons, 200);
  setTimeout(safeCreateIcons, 1000);

  // Dynamic Server Host IP / URL Connection logic (Critical for Mobile APK)
  function getStoredServerUrl() {
    if (window.location.origin && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
      return window.location.origin.replace(/\/$/, '');
    }
    let saved = localStorage.getItem('server_url');
    if (!saved || saved.includes('192.0.0.2') || saved.includes('10.40.172.183')) {
      saved = 'http://localhost:3000';
    }
    return saved.replace(/\/$/, '');
  }

  let serverUrl = getStoredServerUrl();
  let socket = null;

  // User Authentication State - Persistent Storage (localStorage + Cookies)
  function getStoredUser() {
    try {
      const stored = localStorage.getItem('auth_user');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.phone) return parsed;
      }
    } catch (e) {}

    // Cookie fallback
    try {
      const match = document.cookie.match(/(?:^|;\s*)auth_user=([^;]+)/);
      if (match && match[1]) {
        const parsed = JSON.parse(decodeURIComponent(match[1]));
        if (parsed && parsed.phone) return parsed;
      }
    } catch (e) {}

    return null;
  }

  function setStoredUser(user, token) {
    if (!user) return;
    currentUser = user;
    try {
      localStorage.removeItem('user_logged_out');
      localStorage.setItem('auth_user', JSON.stringify(user));
      if (token) localStorage.setItem('auth_token', token);
      if (user.phone) localStorage.setItem('auth_phone', user.phone);

      const exp = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
      document.cookie = `auth_user=${encodeURIComponent(JSON.stringify(user))}; expires=${exp}; path=/; SameSite=Lax`;
      if (token) document.cookie = `auth_token=${encodeURIComponent(token)}; expires=${exp}; path=/; SameSite=Lax`;
      if (user.phone) document.cookie = `auth_phone=${encodeURIComponent(user.phone)}; expires=${exp}; path=/; SameSite=Lax`;
    } catch (e) {}

    if (logoutBtn) logoutBtn.classList.remove('hidden');
    renderUserProfile(user);
  }

  function clearStoredUser() {
    currentUser = null;
    try {
      localStorage.setItem('user_logged_out', 'true');
      localStorage.removeItem('auth_user');
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_phone');

      document.cookie = 'auth_user=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax';
      document.cookie = 'auth_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax';
      document.cookie = 'auth_phone=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax';
    } catch (e) {}

    apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    if (logoutBtn) logoutBtn.classList.add('hidden');
  }

  let currentUser = getStoredUser();
  let pendingAuthPhone = '';

  function apiFetch(urlPath, options = {}) {
    let targetUrl = urlPath;
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
      if (!urlPath.startsWith('http://') && !urlPath.startsWith('https://')) {
        targetUrl = `${serverUrl}${urlPath.startsWith('/') ? '' : '/'}${urlPath}`;
      }
    }
    const token = localStorage.getItem('auth_token');
    const headers = { ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (currentUser && currentUser.phone) headers['x-user-phone'] = currentUser.phone;

    return fetch(targetUrl, { ...options, headers });
  }

  // WhatsApp Connection Persistent Cache
  function getStoredWA() {
    try {
      const raw = localStorage.getItem('wa_status');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setStoredWA(statusData) {
    try {
      if (statusData && (statusData.status === 'connected' || statusData.user)) {
        localStorage.setItem('wa_status', JSON.stringify(statusData));
      } else if (statusData && statusData.status === 'disconnected' && !statusData.user) {
        localStorage.removeItem('wa_status');
      }
    } catch (e) {}
  }

  // Pre-load WhatsApp status from persistent cache
  const cachedWA = getStoredWA();
  let activeChatJid = null;
  let activeChatName = '';
  let threadsData = [];
  let currentFilter = 'all';
  let isConnected = Boolean(cachedWA && (cachedWA.status === 'connected' || cachedWA.user));
  let waAccountName = (cachedWA && cachedWA.user && cachedWA.user.name) ? cachedWA.user.name : '';
  let waAccountPhone = (cachedWA && cachedWA.user && cachedWA.user.phone) ? cachedWA.user.phone : '';

  let searchTimeout = null;

  // DOM Elements - Theme
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const themeIcon = document.getElementById('themeIcon');

  function initTheme() {
    if (localStorage.getItem('white_theme_default_applied') !== 'true') {
      localStorage.setItem('theme', 'light');
      localStorage.setItem('white_theme_default_applied', 'true');
    }
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
  }

  function setTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      if (themeIcon) {
        themeIcon.setAttribute('data-lucide', 'sun');
        themeIcon.className = 'w-5 h-5 text-white';
      }
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      if (themeIcon) {
        themeIcon.setAttribute('data-lucide', 'moon');
        themeIcon.className = 'w-5 h-5 text-white';
      }
      localStorage.setItem('theme', 'light');
    }
    safeCreateIcons();
  }

  themeToggleBtn.addEventListener('click', () => {
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'light' : 'dark');
  });

  initTheme();

  // Filter Pills (iOS WhatsApp Style: All, Groups, Unread, Channels)
  const sidebarSearchInput = document.getElementById('sidebarSearchInput');
  const chatThreadsContainer = document.getElementById('chatThreadsContainer');
  const sidebarTotalCount = document.getElementById('sidebarTotalCount');
  const refreshThreadsBtn = document.getElementById('refreshThreadsBtn');

  const filterAllBtn = document.getElementById('filterAllBtn');
  const filterGroupsBtn = document.getElementById('filterGroupsBtn');
  const filterUnreadBtn = document.getElementById('filterUnreadBtn');
  const filterChannelsBtn = document.getElementById('filterChannelsBtn');
  const filterUnreadBadge = document.getElementById('filterUnreadBadge');
  const headerPlusBtn = document.getElementById('headerPlusBtn');
  const openCameraBtn = document.getElementById('openCameraBtn');

  function setFilter(filter) {
    currentFilter = filter;

    [filterAllBtn, filterGroupsBtn, filterUnreadBtn, filterChannelsBtn].forEach(btn => {
      if (btn) btn.classList.remove('active');
    });

    if (filter === 'all' && filterAllBtn) filterAllBtn.classList.add('active');
    if (filter === 'groups' && filterGroupsBtn) filterGroupsBtn.classList.add('active');
    if (filter === 'unread' && filterUnreadBtn) filterUnreadBtn.classList.add('active');
    if (filter === 'channels' && filterChannelsBtn) filterChannelsBtn.classList.add('active');

    renderSidebarThreads(threadsData, sidebarSearchInput ? sidebarSearchInput.value.trim() : '');
  }

  if (filterAllBtn) filterAllBtn.addEventListener('click', () => setFilter('all'));
  if (filterGroupsBtn) filterGroupsBtn.addEventListener('click', () => setFilter('groups'));
  if (filterUnreadBtn) filterUnreadBtn.addEventListener('click', () => setFilter('unread'));
  if (filterChannelsBtn) filterChannelsBtn.addEventListener('click', () => setFilter('channels'));

  let currentQrData = null;

  function showQrModal(force = false) {
    if (!currentUser) {
      showAuthStep('phone');
      return;
    }
    if (!userSubscription || !userSubscription.is_subscribed) {
      if (paywallModal) {
        paywallModal.classList.remove('hidden');
        paywallModal.style.display = 'flex';
      }
      safeCreateIcons();
      return;
    }
    // If already connected and user did not explicitly request scanning a new QR, do not open
    if (isConnected && !force) {
      return;
    }
    if (qrModal) {
      qrModal.classList.remove('hidden');
      qrModal.style.display = 'flex';
      if (isConnected) {
        if (alreadyConnectedBanner) alreadyConnectedBanner.classList.remove('hidden');
        if (qrContainer) qrContainer.classList.add('hidden');
      } else {
        if (alreadyConnectedBanner) alreadyConnectedBanner.classList.add('hidden');
        if (qrContainer) qrContainer.classList.remove('hidden');
        if (currentQrData) {
          if (qrFrame) qrFrame.classList.remove('hidden');
          if (qrImage) qrImage.src = currentQrData;
          if (qrLoading) qrLoading.classList.add('hidden');
        } else {
          if (qrFrame) qrFrame.classList.add('hidden');
          if (qrLoading) qrLoading.classList.remove('hidden');
          fetchStatusFallback();
        }
      }
      safeCreateIcons();
    }
  }

  if (headerPlusBtn) {
    headerPlusBtn.addEventListener('click', () => {
      showQrModal();
    });
  }
  if (openCameraBtn) {
    openCameraBtn.addEventListener('click', () => {
      showQrModal();
    });
  }

  // DOM Elements - Account & QR
  const qrModal = document.getElementById('qrModal');
  const qrFrame = document.getElementById('qrFrame');
  const qrImage = document.getElementById('qrImage');
  const qrLoading = document.getElementById('qrLoading');
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const logoutBtn = document.getElementById('logoutBtn');
  const qrConnectServerBtn = document.getElementById('qrConnectServerBtn');
  const qrServerUrlInput = document.getElementById('qrServerUrlInput');
  const qrServerStatus = document.getElementById('qrServerStatus');
  const toggleAdvancedServerBtn = document.getElementById('toggleAdvancedServerBtn');
  const advancedServerBox = document.getElementById('advancedServerBox');

  if (toggleAdvancedServerBtn && advancedServerBox) {
    toggleAdvancedServerBtn.addEventListener('click', () => {
      advancedServerBox.classList.toggle('hidden');
    });
  }

  // Socket.io Connection Handler
  function initSocketConnection(url) {
    if (socket) {
      try { socket.disconnect(); } catch (e) {}
    }

    serverUrl = url.replace(/\/$/, '');
    localStorage.setItem('server_url', serverUrl);

    if (qrServerUrlInput) qrServerUrlInput.value = serverUrl;
    if (qrServerStatus) {
      qrServerStatus.textContent = 'Connecting...';
      qrServerStatus.className = 'font-bold text-blue-500 animate-pulse';
    }

    if (typeof io !== 'undefined') {
      socket = io(serverUrl, {
        transports: ['polling', 'websocket'],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000
      });

      socket.on('connect', () => {
        if (qrServerStatus) {
          qrServerStatus.textContent = 'Server Online';
          qrServerStatus.className = 'font-bold text-emerald-500';
        }
        if (currentUser && currentUser.phone) {
          socket.emit('register_user', currentUser.phone);
        }
        loadStats();
        loadThreads();
        loadKeywords();
        loadKeywordAlerts();
      });

      socket.on('connect_error', () => {
        if (qrServerStatus) {
          qrServerStatus.textContent = 'Server Reconnecting...';
          qrServerStatus.className = 'font-bold text-amber-500';
        }
      });

      socket.on('status_update', (data) => {
        updateConnectionStatus(data);
      });

      socket.on('new_message', (msg) => {
        loadStats();
        loadThreads();

        if (activeChatJid && msg.chat_jid === activeChatJid) {
          appendOrUpdateBubbleInCanvas(msg);
          scrollToCanvasBottom();
        }
      });

      socket.on('keyword_alert', (msg) => {
        loadKeywordAlerts();
        if (msg) {
          triggerMatchAlert(msg);
        }
      });

      socket.on('keywords_updated', (data) => {
        if (data && data.keywords) {
          const targetPhone = data.phone ? String(data.phone).replace(/\D/g, '') : '';
          const myPhone = currentUser && currentUser.phone ? String(currentUser.phone).replace(/\D/g, '') : '';
          if (!targetPhone || targetPhone === myPhone) {
            activeKeywords = data.keywords;
            renderKeywordTags();
          }
        } else if (data && (data.include || data.exclude)) {
          activeKeywords = data;
          renderKeywordTags();
        }
        loadKeywordAlerts();
      });

      socket.on('alerts_cleared', () => {
        cachedAlertsData = [];
        knownAlertIds.clear();
        renderKeywordAlerts([]);
        loadKeywordAlerts();
      });

      socket.on('contacts_updated', () => loadThreads());
      socket.on('chats_updated', () => loadThreads());
    }
  }

  // Resilient background sync interval (keeps threads and keyword alerts fresh with 0-lag)
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadStats();
      loadKeywordAlerts();
    }
  }, 3500);

  if (qrConnectServerBtn && qrServerUrlInput) {
    qrConnectServerBtn.addEventListener('click', () => {
      const inputUrl = qrServerUrlInput.value.trim();
      if (inputUrl) {
        initSocketConnection(inputUrl);
        loadStats();
        loadThreads();
        loadKeywords();
        loadKeywordAlerts();
      }
    });
  }

  initSocketConnection(serverUrl);

  // DOM Elements - Keyword Alert Sidebar
  const toggleKeywordSidebarBtn = document.getElementById('toggleKeywordSidebarBtn');
  const closeKeywordSidebarBtn = document.getElementById('closeKeywordSidebarBtn');
  const keywordAlertSidebar = document.getElementById('keywordAlertSidebar');
  
  const addIncludeKeywordForm = document.getElementById('addIncludeKeywordForm');
  const includeKeywordInput = document.getElementById('includeKeywordInput');
  const activeIncludeKeywordTags = document.getElementById('activeIncludeKeywordTags');

  const addExcludeKeywordForm = document.getElementById('addExcludeKeywordForm');
  const excludeKeywordInput = document.getElementById('excludeKeywordInput');
  const activeExcludeKeywordTags = document.getElementById('activeExcludeKeywordTags');

  const keywordAlertsList = document.getElementById('keywordAlertsList');
  const keywordBadgeCount = document.getElementById('keywordBadgeCount');
  const alertsCountBadge = document.getElementById('alertsCountBadge');

  let activeKeywords = { include: [], exclude: [] };

  // DOM Elements - 6 Main Page Views (Dashboard, WhatsApp, Matching, Keywords, Profile, Plan Details)
  const pageViewDashboard = document.getElementById('pageViewDashboard');
  const pageViewWhatsApp = document.getElementById('pageViewWhatsApp');
  const pageViewMatching = document.getElementById('pageViewMatching');
  const pageViewKeywords = document.getElementById('pageViewKeywords');
  const pageViewProfile = document.getElementById('pageViewProfile');
  const pageViewPlanDetails = document.getElementById('pageViewPlanDetails');

  // DOM Elements - Plan Details Page Specific
  const planDetailsBackBtn = document.getElementById('planDetailsBackBtn');
  const planDetailsRefreshBtn = document.getElementById('planDetailsRefreshBtn');
  const planDetailsStatusBadge = document.getElementById('planDetailsStatusBadge');
  const planDetailsStatusBadgeText = document.getElementById('planDetailsStatusBadgeText');
  const planDetailsDaysBadge = document.getElementById('planDetailsDaysBadge');
  const planDetailsDaysRemaining = document.getElementById('planDetailsDaysRemaining');
  const planDetailsTitle = document.getElementById('planDetailsTitle');
  const planDetailsProgressPercent = document.getElementById('planDetailsProgressPercent');
  const planDetailsProgressBar = document.getElementById('planDetailsProgressBar');
  const planDetailsStartedAt = document.getElementById('planDetailsStartedAt');
  const planDetailsExpiresAt = document.getElementById('planDetailsExpiresAt');
  const planDetailsStatusText = document.getElementById('planDetailsStatusText');
  const planDetailsPaymentId = document.getElementById('planDetailsPaymentId');
  const planDetailsOrderId = document.getElementById('planDetailsOrderId');
  const planDetailsPhone = document.getElementById('planDetailsPhone');
  const copyPaymentIdBtn = document.getElementById('copyPaymentIdBtn');
  const copyOrderIdBtn = document.getElementById('copyOrderIdBtn');
  const planDetailsRenewBtn = document.getElementById('planDetailsRenewBtn');
  const planDetailsRenewBtnText = document.getElementById('planDetailsRenewBtnText');
  const planDetailsPaymentsBadgeCount = document.getElementById('planDetailsPaymentsBadgeCount');
  const planDetailsPaymentsList = document.getElementById('planDetailsPaymentsList');

  // DOM Elements - Matching Page Specific
  const pageMatchingAlertsGrid = document.getElementById('pageMatchingAlertsGrid');
  const pageMatchingBadge = document.getElementById('pageMatchingBadge');
  const pageMatchingSearchInput = document.getElementById('pageMatchingSearchInput');
  const clearMatchingMsgsBtn = document.getElementById('clearMatchingMsgsBtn');
  const matchingTabBtn = document.getElementById('matchingTabBtn');
  const savedTabBtn = document.getElementById('savedTabBtn');
  const matchingTabCount = document.getElementById('matchingTabCount');
  const savedTabCount = document.getElementById('savedTabCount');

  let currentMatchingSubTab = 'matching'; // 'matching' or 'saved'

  function setMatchingSubTab(tab) {
    currentMatchingSubTab = tab;
    if (matchingTabBtn && savedTabBtn) {
      if (tab === 'matching') {
        matchingTabBtn.className = 'filter-chip active px-3.5 py-1.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300 flex-shrink-0 transition flex items-center gap-1.5 cursor-pointer';
        savedTabBtn.className = 'filter-chip px-3.5 py-1.5 rounded-full text-xs font-medium bg-[#f0f2f5] dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition flex items-center gap-1.5 cursor-pointer';
      } else {
        savedTabBtn.className = 'filter-chip active px-3.5 py-1.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300 flex-shrink-0 transition flex items-center gap-1.5 cursor-pointer';
        matchingTabBtn.className = 'filter-chip px-3.5 py-1.5 rounded-full text-xs font-medium bg-[#f0f2f5] dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition flex items-center gap-1.5 cursor-pointer';
      }
    }
    renderKeywordAlerts(cachedAlertsData);
  }

  if (matchingTabBtn) matchingTabBtn.addEventListener('click', () => setMatchingSubTab('matching'));
  if (savedTabBtn) savedTabBtn.addEventListener('click', () => setMatchingSubTab('saved'));

  if (clearMatchingMsgsBtn) {
    clearMatchingMsgsBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        // Immediate optimistic UI clear of Matching list only (Saved trips remain 100% intact!)
        cachedAlertsData = [];
        knownAlertIds.clear();
        renderKeywordAlerts([]);
        
        // Visual indicator on button
        const origHtml = clearMatchingMsgsBtn.innerHTML;
        clearMatchingMsgsBtn.innerHTML = `<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-500"></i><span class="text-emerald-500">Cleared</span>`;
        safeCreateIcons();
        setTimeout(() => {
          clearMatchingMsgsBtn.innerHTML = origHtml;
          safeCreateIcons();
        }, 1500);

        // Call backend API to record cleared timestamp for matching list
        const userPhone = currentUser && currentUser.phone ? encodeURIComponent(currentUser.phone) : '';
        const phoneParam = userPhone ? `?phone=${userPhone}` : '';
        await apiFetch(`/api/keywords/alerts${phoneParam}`, { method: 'DELETE' });
        await loadKeywordAlerts();
      } catch (err) {
        console.error('Error clearing matched alerts:', err);
      }
    });
  }

  // DOM Elements - Keywords Page Specific
  const pageAddIncludeKeywordForm = document.getElementById('pageAddIncludeKeywordForm');
  const pageIncludeKeywordInput = document.getElementById('pageIncludeKeywordInput');
  const pageActiveIncludeKeywordTags = document.getElementById('pageActiveIncludeKeywordTags');
  const pageAddExcludeKeywordForm = document.getElementById('pageAddExcludeKeywordForm');
  const pageExcludeKeywordInput = document.getElementById('pageExcludeKeywordInput');
  const pageActiveExcludeKeywordTags = document.getElementById('pageActiveExcludeKeywordTags');

  // DOM Elements - Keywords Modal Specific
  const modalAddIncludeKeywordForm = document.getElementById('modalAddIncludeKeywordForm');
  const modalIncludeKeywordInput = document.getElementById('modalIncludeKeywordInput');
  const modalActiveIncludeKeywordTags = document.getElementById('modalActiveIncludeKeywordTags');
  const modalAddExcludeKeywordForm = document.getElementById('modalAddExcludeKeywordForm');
  const modalExcludeKeywordInput = document.getElementById('modalExcludeKeywordInput');
  const modalActiveExcludeKeywordTags = document.getElementById('modalActiveExcludeKeywordTags');


  // DOM Elements - User Authentication & Fast2SMS OTP Verification
  const authModal = document.getElementById('authModal');
  const authModalTitle = document.getElementById('authModalTitle');
  const authModalSubtitle = document.getElementById('authModalSubtitle');

  const authPhoneForm = document.getElementById('authPhoneForm');
  const authPhoneInput = document.getElementById('authPhoneInput');
  const authPhoneSubmitBtn = document.getElementById('authPhoneSubmitBtn');

  const authOtpVerifyForm = document.getElementById('authOtpVerifyForm');
  const authOtpDisplayPhone = document.getElementById('authOtpDisplayPhone');
  const authOtpChangePhoneBtn = document.getElementById('authOtpChangePhoneBtn');
  const authOtpInput = document.getElementById('authOtpInput');
  const authNewUserFields = document.getElementById('authNewUserFields');
  const authNewUserNameInput = document.getElementById('authNewUserNameInput');
  const authOtpSubmitBtn = document.getElementById('authOtpSubmitBtn');
  const authResendOtpBtn = document.getElementById('authResendOtpBtn');
  const authResendCountdown = document.getElementById('authResendCountdown');

  let resendTimerInterval = null;

  function startResendCountdown(seconds = 30) {
    if (resendTimerInterval) clearInterval(resendTimerInterval);
    if (!authResendOtpBtn || !authResendCountdown) return;

    let remaining = seconds;
    authResendOtpBtn.disabled = true;
    authResendOtpBtn.innerHTML = `Resend OTP in <span id="authResendCountdown">${remaining}</span>s`;

    resendTimerInterval = setInterval(() => {
      remaining--;
      const span = document.getElementById('authResendCountdown');
      if (remaining <= 0) {
        clearInterval(resendTimerInterval);
        authResendOtpBtn.disabled = false;
        authResendOtpBtn.innerHTML = 'Resend OTP';
      } else if (span) {
        span.textContent = remaining;
      }
    }, 1000);
  }

  // Edit Profile Modal Elements
  const editProfileModal = document.getElementById('editProfileModal');
  const closeEditProfileModalBtn = document.getElementById('closeEditProfileModalBtn');
  const editProfileForm = document.getElementById('editProfileForm');
  const editProfilePhone = document.getElementById('editProfilePhone');
  const editProfileNameInput = document.getElementById('editProfileNameInput');
  const editProfilePasscodeInput = document.getElementById('editProfilePasscodeInput');
  const cancelEditProfileBtn = document.getElementById('cancelEditProfileBtn');

  // DOM Elements - Profile Page Specific
  const pageProfileAvatar = document.getElementById('pageProfileAvatar');
  const pageProfileGenderBadge = document.getElementById('pageProfileGenderBadge');
  const pageProfileUserName = document.getElementById('pageProfileUserName');
  const pageProfileUserPhone = document.getElementById('pageProfileUserPhone');
  const pageProfileUserGender = document.getElementById('pageProfileUserGender');
  const pageProfileEditBtn = document.getElementById('pageProfileEditBtn');
  const profileEditModalTriggerBtn = document.getElementById('profileEditModalTriggerBtn');
  const pageProfileWAStatusBadge = document.getElementById('pageProfileWAStatusBadge');
  const pageProfileWAAccountDesc = document.getElementById('pageProfileWAAccountDesc');
  const profileOpenWAModalBtn = document.getElementById('profileOpenWAModalBtn');
  const profileManageKeywordsBtn = document.getElementById('profileManageKeywordsBtn');
  const pageProfileLogoutBtn = document.getElementById('pageProfileLogoutBtn');

  // Auth Modal Flow Controller (Fast2SMS OTP)
  function showAuthStep(step) {
    if (authModal) {
      authModal.classList.remove('hidden');
      authModal.style.display = 'flex';
    }

    if (qrModal) qrModal.classList.add('hidden');

    const mainAppWrapper = document.getElementById('mainAppWrapper');
    if (mainAppWrapper) {
      mainAppWrapper.classList.add('hidden');
      mainAppWrapper.style.display = 'none';
    }

    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) bottomNav.classList.add('hidden');

    if (authPhoneForm) { authPhoneForm.classList.add('hidden'); authPhoneForm.style.display = 'none'; }
    if (authOtpVerifyForm) { authOtpVerifyForm.classList.add('hidden'); authOtpVerifyForm.style.display = 'none'; }

    if (step === 'phone') {
      if (authPhoneForm) {
        authPhoneForm.classList.remove('hidden');
        authPhoneForm.style.display = 'block';
      }
      if (authModalTitle) authModalTitle.textContent = 'Go-Notch Trip Monitor';
      if (authModalSubtitle) authModalSubtitle.textContent = 'Enter your mobile number to receive SMS OTP';
      if (authPhoneInput) {
        if (pendingAuthPhone) authPhoneInput.value = pendingAuthPhone;
        setTimeout(() => authPhoneInput.focus(), 100);
      }
    } else if (step === 'otp') {
      if (authOtpVerifyForm) {
        authOtpVerifyForm.classList.remove('hidden');
        authOtpVerifyForm.style.display = 'block';
      }
      if (authModalTitle) authModalTitle.textContent = 'Verify Phone Number';
      if (authModalSubtitle) authModalSubtitle.textContent = 'Enter the 6-digit SMS OTP code sent to your mobile';
      if (authOtpInput) {
        authOtpInput.value = '';
        setTimeout(() => authOtpInput.focus(), 100);
      }
      startResendCountdown(30);
    }
    safeCreateIcons();
  }

  function hideAuthModal() {
    if (authModal) {
      authModal.classList.add('hidden');
      authModal.style.display = 'none';
    }

    const mainAppWrapper = document.getElementById('mainAppWrapper');
    if (mainAppWrapper) {
      mainAppWrapper.classList.remove('hidden');
      mainAppWrapper.style.display = 'flex';
    }

    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) bottomNav.classList.remove('hidden');
  }

  function renderUserProfile(user) {
    if (!user) return;
    if (pageProfileUserName) pageProfileUserName.textContent = user.name || 'User';
    if (pageProfileUserPhone) {
      const p = (user.phone || '').replace(/\D/g, '');
      pageProfileUserPhone.textContent = p.length >= 10 ? `+91 ${p.slice(-10)}` : `+91 ${p}`;
    }
    if (pageProfileUserGender) pageProfileUserGender.textContent = user.gender || 'Male';

    const userSubtitle = document.getElementById('dashboardUserSubtitle');
    if (userSubtitle) {
      const p = (user.phone || '').replace(/\D/g, '');
      userSubtitle.textContent = `Connected as ${user.name || 'User'} (+91 ${p.slice(-10)})`;
    }

    if (pageProfileAvatar) {
      pageProfileAvatar.textContent = (user.name || 'U').charAt(0).toUpperCase();
    }
    if (pageProfileGenderBadge) {
      if (user.gender === 'Female') pageProfileGenderBadge.textContent = '👩';
      else if (user.gender === 'Other') pageProfileGenderBadge.textContent = '🧑';
      else pageProfileGenderBadge.textContent = '👨';
    }
    safeCreateIcons();
  }

  // Handle Gender Selection Pill Highlighting
  function initGenderPills() {
    document.querySelectorAll('.gender-radio').forEach(radio => {
      radio.addEventListener('change', () => {
        document.querySelectorAll('.gender-pill-label').forEach(label => label.classList.remove('active'));
        const parent = radio.closest('.gender-pill-label');
        if (parent && radio.checked) parent.classList.add('active');
      });
    });

    document.querySelectorAll('input[name="editGender"]').forEach(radio => {
      radio.addEventListener('change', () => {
        document.querySelectorAll('.edit-gender-pill').forEach(label => label.classList.remove('active'));
        const parent = radio.closest('.edit-gender-pill');
        if (parent && radio.checked) parent.classList.add('active');
      });
    });
  }
  initGenderPills();

  // Helper to post-login initialization
  async function handleSuccessfulLogin(user, token) {
    setStoredUser(user, token);
    if (socket && user && user.phone) {
      socket.emit('register_user', user.phone);
    }
    hideAuthModal();
    await fetchSubscriptionStatus();
    switchTab('dashboard');
    loadStats();
    loadThreads();
    loadKeywords();
    loadKeywordAlerts();
    updateDesktopNotifUI();
  }

  // 1. Phone Form Submit Handler (Sends Fast2SMS OTP)
  if (authPhoneForm) {
    authPhoneForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawPhone = authPhoneInput ? authPhoneInput.value.trim() : '';
      const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);

      if (cleanPhone.length < 10) {
        alert('Please enter a valid 10-digit mobile number.');
        return;
      }

      pendingAuthPhone = cleanPhone;
      const formattedDisplay = `+91 ${cleanPhone}`;
      if (authOtpDisplayPhone) authOtpDisplayPhone.textContent = formattedDisplay;

      const submitBtn = authPhoneSubmitBtn || authPhoneForm.querySelector('button[type="submit"]');
      const origBtnHtml = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>Sending SMS OTP...</span>`;
      }

      try {
        const res = await apiFetch('/api/auth/send-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: cleanPhone })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          if (data.isDeactivated) {
            alert('⚠️ Account Deactivated\n\n' + (data.error || 'Your account has been deactivated by the administrator. Please contact admin.'));
            return;
          }
          throw new Error(data.error || 'Failed to send OTP via SMS');
        }

        // Show Name input if new user
        if (authNewUserFields) {
          if (!data.exists) {
            authNewUserFields.classList.remove('hidden');
          } else {
            authNewUserFields.classList.add('hidden');
          }
        }

        if (authOtpInput) {
          authOtpInput.value = '';
        }

        showAuthStep('otp');
      } catch (err) {
        alert(err.message || 'Error sending SMS OTP. Please try again.');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = origBtnHtml;
          safeCreateIcons();
        }
      }
    });
  }

  // Change phone button on OTP verification step
  if (authOtpChangePhoneBtn) {
    authOtpChangePhoneBtn.addEventListener('click', () => {
      showAuthStep('phone');
    });
  }

  // 2. OTP Verification Form Submit Handler
  if (authOtpVerifyForm) {
    authOtpVerifyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const otp = authOtpInput ? authOtpInput.value.trim() : '';
      const name = authNewUserNameInput ? authNewUserNameInput.value.trim() : '';

      if (!otp || otp.length < 4) {
        alert('Please enter the 6-digit verification code received via SMS.');
        if (authOtpInput) authOtpInput.focus();
        return;
      }

      const origBtnHtml = authOtpSubmitBtn.innerHTML;
      authOtpSubmitBtn.disabled = true;
      authOtpSubmitBtn.innerHTML = `<div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>Verifying Code...</span>`;

      try {
        const res = await apiFetch('/api/auth/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: pendingAuthPhone,
            otp,
            name
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          if (data.isDeactivated) {
            alert('⚠️ Account Deactivated\n\n' + (data.error || 'Your account has been deactivated. Please contact the administrator.'));
            showAuthStep('phone');
            return;
          }
          throw new Error(data.error || 'Invalid or expired OTP code');
        }

        await handleSuccessfulLogin(data.user, data.token);
      } catch (err) {
        alert(err.message || 'OTP verification failed. Please check the code and try again.');
        if (authOtpInput) authOtpInput.focus();
      } finally {
        authOtpSubmitBtn.disabled = false;
        authOtpSubmitBtn.innerHTML = origBtnHtml;
        safeCreateIcons();
      }
    });
  }

  // 3. Resend OTP Button Handler
  if (authResendOtpBtn) {
    authResendOtpBtn.addEventListener('click', async () => {
      if (!pendingAuthPhone) {
        showAuthStep('phone');
        return;
      }

      authResendOtpBtn.disabled = true;
      authResendOtpBtn.innerHTML = `<div class="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin inline-block"></div> Resending...`;

      try {
        const res = await apiFetch('/api/auth/resend-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: pendingAuthPhone })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to resend SMS OTP');
        }

        if (data.devMode && data.otp) {
          if (authDevModeAlert && authDevOtpCode) {
            authDevOtpCode.textContent = data.otp;
            authDevModeAlert.classList.remove('hidden');
          }
          if (authOtpInput) authOtpInput.value = data.otp;
        }

        alert('✅ New OTP sent successfully to +91 ' + pendingAuthPhone);
        startResendCountdown(30);
      } catch (err) {
        alert(err.message || 'Could not resend OTP. Please try again.');
        authResendOtpBtn.disabled = false;
        authResendOtpBtn.innerHTML = 'Resend OTP';
      }
    });
  }

  // Edit Profile Modal Open & Handlers
  function openEditProfileModal() {
    if (!currentUser) return;
    if (editProfilePhone) editProfilePhone.value = `+91 ${(currentUser.phone || '').slice(-10)}`;
    if (editProfileNameInput) editProfileNameInput.value = currentUser.name || '';
    if (editProfilePasscodeInput) editProfilePasscodeInput.value = '';
    
    const targetGender = currentUser.gender || 'Male';
    document.querySelectorAll('input[name="editGender"]').forEach(radio => {
      radio.checked = (radio.value === targetGender);
      const parent = radio.closest('.edit-gender-pill');
      if (parent) {
        if (radio.checked) parent.classList.add('active');
        else parent.classList.remove('active');
      }
    });

    if (editProfileModal) editProfileModal.classList.remove('hidden');
    safeCreateIcons();
  }

  function closeEditProfileModal() {
    if (editProfileModal) editProfileModal.classList.add('hidden');
  }

  if (pageProfileEditBtn) pageProfileEditBtn.addEventListener('click', openEditProfileModal);
  if (profileEditModalTriggerBtn) profileEditModalTriggerBtn.addEventListener('click', openEditProfileModal);
  if (closeEditProfileModalBtn) closeEditProfileModalBtn.addEventListener('click', closeEditProfileModal);
  if (cancelEditProfileBtn) cancelEditProfileBtn.addEventListener('click', closeEditProfileModal);

  if (editProfileForm) {
    editProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentUser) return;

      const name = editProfileNameInput ? editProfileNameInput.value.trim() : '';
      const passcode = editProfilePasscodeInput ? editProfilePasscodeInput.value.trim() : '';
      const selectedRadio = document.querySelector('input[name="editGender"]:checked');
      const gender = selectedRadio ? selectedRadio.value : (currentUser.gender || 'Male');

      if (!name) {
        alert('Please enter a username or full name.');
        return;
      }

      if (passcode && (!/^\d{4}$/.test(passcode))) {
        alert('New passcode must be exactly 4 numeric digits.');
        return;
      }

      const submitBtn = editProfileForm.querySelector('button[type="submit"]');
      const origHtml = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>Saving...</span>`;
      }

      try {
        const payload = { phone: currentUser.phone, name, gender };
        if (passcode) payload.passcode = passcode;

        const res = await apiFetch('/api/auth/update-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success && data.user) {
          setStoredUser(data.user);
        } else {
          // Fallback update local user state
          currentUser.name = name;
          currentUser.gender = gender;
          setStoredUser(currentUser);
        }
        closeEditProfileModal();
        alert('✅ Profile updated successfully!');
      } catch (err) {
        console.error('Update profile error:', err);
        currentUser.name = name;
        currentUser.gender = gender;
        setStoredUser(currentUser);
        closeEditProfileModal();
        alert('✅ Profile updated!');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = origHtml;
          safeCreateIcons();
        }
      }
    });
  }

  // Manage Keywords Shortcut from Profile Tab
  if (profileManageKeywordsBtn) {
    profileManageKeywordsBtn.addEventListener('click', () => {
      switchTab('keywords');
    });
  }

  // Open WhatsApp Modal from Profile Tab
  const profileShowQRBtn = document.getElementById('profileShowQRBtn');
  if (profileOpenWAModalBtn) {
    profileOpenWAModalBtn.addEventListener('click', () => {
      showQrModal();
    });
  }
  if (profileShowQRBtn) {
    profileShowQRBtn.addEventListener('click', () => {
      showQrModal();
    });
  }

  // User Session Logout Handler (Does NOT disconnect server WhatsApp connection!)
  if (pageProfileLogoutBtn) {
    pageProfileLogoutBtn.addEventListener('click', () => {
      if (confirm('Log out from your user account? WhatsApp will remain actively connected on the server.')) {
        clearStoredUser();
        showAuthStep('phone');
      }
    });
  }

  // Active Chat Conversation View DOM Elements
  const noChatSelected = document.getElementById('noChatSelected');
  const activeChatView = document.getElementById('activeChatView');
  const activeChatNameEl = document.getElementById('activeChatName');
  const activeChatJidEl = document.getElementById('activeChatJid');
  const activeChatAvatar = document.getElementById('activeChatAvatar');
  const activeChatTypeBadge = document.getElementById('activeChatTypeBadge');
  const chatMessagesCanvas = document.getElementById('chatMessagesCanvas');
  const chatMessageInput = document.getElementById('chatMessageInput');
  const sendMessageBtn = document.getElementById('sendMessageBtn');
  const chatSearchInput = document.getElementById('chatSearchInput');
  const exportThreadBtn = document.getElementById('exportThreadBtn');

  // Bottom Nav Buttons
  const bottomNavBtns = document.querySelectorAll('.bottom-nav-btn');

  let cachedAlertsData = [];

  function switchTab(tabName) {
    try {
      localStorage.setItem('active_tab', tabName);
    } catch (e) {}

    bottomNavBtns.forEach(btn => {
      const tab = btn.getAttribute('data-tab');
      if (tab === tabName) {
        btn.className = 'bottom-nav-btn active-tab flex flex-col items-center justify-center flex-1 py-1.5 text-xs font-semibold transition text-blue-600 dark:text-blue-400';
      } else {
        btn.className = 'bottom-nav-btn relative flex flex-col items-center justify-center flex-1 py-1.5 text-xs font-medium transition text-slate-500 dark:text-slate-400 hover:text-blue-600';
      }
    });

    [pageViewDashboard, pageViewWhatsApp, pageViewMatching, pageViewKeywords, pageViewProfile, pageViewPlanDetails].forEach(page => {
      if (page) page.classList.add('hidden');
    });

    const bottomNav = document.getElementById('bottomNav');
    if (tabName !== 'whatsapp' || !activeChatJid) {
      if (bottomNav) {
        bottomNav.classList.remove('chat-active-hidden');
        bottomNav.style.display = '';
      }
      document.body.classList.remove('chat-active');
    }

    if (tabName === 'dashboard') {
      if (pageViewDashboard) pageViewDashboard.classList.remove('hidden');
      fetchSubscriptionStatus();
      loadStats();
      renderDashboardSubscription();
      renderDashboardPayments();
    } else if (tabName === 'whatsapp') {
      if (pageViewWhatsApp) pageViewWhatsApp.classList.remove('hidden');
      const chatSidebar = document.getElementById('chatSidebar');
      const chatMainArea = document.getElementById('chatMainArea');
      if (!activeChatJid && chatSidebar && chatMainArea) {
        chatSidebar.classList.remove('hidden');
        chatSidebar.style.display = '';
        chatMainArea.classList.add('hidden');
        chatMainArea.style.display = '';
      }
    } else if (tabName === 'matching') {
      if (pageViewMatching) pageViewMatching.classList.remove('hidden');
      loadKeywordAlerts();
    } else if (tabName === 'keywords') {
      if (pageViewKeywords) pageViewKeywords.classList.remove('hidden');
      loadKeywords();
    } else if (tabName === 'profile') {
      if (pageViewProfile) pageViewProfile.classList.remove('hidden');
      updateProfilePageData();
    } else if (tabName === 'plan_details') {
      if (pageViewPlanDetails) pageViewPlanDetails.classList.remove('hidden');
      fetchSubscriptionStatus().then(() => {
        renderPlanDetailsPage();
      });
      renderPlanDetailsPage();
    }
    safeCreateIcons();
  }

  const mobileBackBtn = document.getElementById('mobileBackBtn');
  if (mobileBackBtn) {
    mobileBackBtn.addEventListener('click', () => {
      const chatSidebar = document.getElementById('chatSidebar');
      const chatMainArea = document.getElementById('chatMainArea');
      const bottomNav = document.getElementById('bottomNav');
      if (chatSidebar && chatMainArea) {
        chatSidebar.classList.remove('mobile-hidden');
        chatMainArea.classList.add('mobile-hidden');
      }
      if (bottomNav) {
        bottomNav.classList.remove('chat-active-hidden');
        bottomNav.style.display = '';
      }
      document.body.classList.remove('chat-active');
    });
  }

  bottomNavBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchTab(tab);
    });
  });

  function updateProfilePageData() {
    if (currentUser) {
      renderUserProfile(currentUser);
    }
    // WA connection status badge in profile
    if (pageProfileWAStatusBadge && pageProfileWAAccountDesc) {
      if (isConnected) {
        pageProfileWAStatusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span> Connected`;
        pageProfileWAStatusBadge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300';
        pageProfileWAAccountDesc.textContent = waAccountName ? `Connected as ${waAccountName} (${waAccountPhone})` : 'Connected & Synced';
      } else {
        pageProfileWAStatusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span> Scan QR`;
        pageProfileWAStatusBadge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300';
        pageProfileWAAccountDesc.textContent = 'WhatsApp QR scan required';
      }
    }
    updateDesktopNotifUI();
  }

  // ---- Bottom Sheet helpers ----
  function openSheet(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('hidden'); safeCreateIcons(); }
  }
  function closeSheet(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }

  // Help bottom sheet
  const profileHelpBtn = document.getElementById('profileHelpBtn');
  if (profileHelpBtn) profileHelpBtn.addEventListener('click', () => openSheet('helpBottomSheet'));
  const helpClose = document.getElementById('helpBottomSheetClose');
  if (helpClose) helpClose.addEventListener('click', () => closeSheet('helpBottomSheet'));
  const helpBackdrop = document.getElementById('helpBottomSheetBackdrop');
  if (helpBackdrop) helpBackdrop.addEventListener('click', () => closeSheet('helpBottomSheet'));

  // Privacy bottom sheet
  const profilePrivacyBtn = document.getElementById('profilePrivacyBtn');
  if (profilePrivacyBtn) profilePrivacyBtn.addEventListener('click', () => openSheet('privacyBottomSheet'));
  const privacyClose = document.getElementById('privacyBottomSheetClose');
  if (privacyClose) privacyClose.addEventListener('click', () => closeSheet('privacyBottomSheet'));
  const privacyBackdrop = document.getElementById('privacyBottomSheetBackdrop');
  if (privacyBackdrop) privacyBackdrop.addEventListener('click', () => closeSheet('privacyBottomSheet'));

  // Feedback bottom sheet
  const profileFeedbackBtn = document.getElementById('profileFeedbackBtn');
  if (profileFeedbackBtn) profileFeedbackBtn.addEventListener('click', () => openSheet('feedbackBottomSheet'));
  const feedbackClose = document.getElementById('feedbackBottomSheetClose');
  if (feedbackClose) feedbackClose.addEventListener('click', () => closeSheet('feedbackBottomSheet'));
  const feedbackBackdrop = document.getElementById('feedbackBottomSheetBackdrop');
  if (feedbackBackdrop) feedbackBackdrop.addEventListener('click', () => closeSheet('feedbackBottomSheet'));
  const feedbackSendBtn = document.getElementById('feedbackSendBtn');
  if (feedbackSendBtn) {
    feedbackSendBtn.addEventListener('click', () => {
      const title = (document.getElementById('feedbackTitle')?.value || '').trim();
      const subtitle = (document.getElementById('feedbackSubtitle')?.value || '').trim();
      const content = (document.getElementById('feedbackContent')?.value || '').trim();
      if (!title && !content) { return; }
      // Build mailto link
      const subject = encodeURIComponent(title || 'App Feedback');
      const body = encodeURIComponent(`${subtitle ? subtitle + '\n\n' : ''}${content}`);
      window.location.href = `mailto:support@pickmicabs.com?subject=${subject}&body=${body}`;
      // Clear fields & close
      if (document.getElementById('feedbackTitle')) document.getElementById('feedbackTitle').value = '';
      if (document.getElementById('feedbackSubtitle')) document.getElementById('feedbackSubtitle').value = '';
      if (document.getElementById('feedbackContent')) document.getElementById('feedbackContent').value = '';
      closeSheet('feedbackBottomSheet');
    });
  }


  if (toggleKeywordSidebarBtn && keywordAlertSidebar) {
    toggleKeywordSidebarBtn.addEventListener('click', () => {
      keywordAlertSidebar.classList.toggle('hidden');
      if (!keywordAlertSidebar.classList.contains('hidden')) {
        loadKeywords();
        loadKeywordAlerts();
      }
    });
  }

  if (closeKeywordSidebarBtn && keywordAlertSidebar) {
    closeKeywordSidebarBtn.addEventListener('click', () => {
      keywordAlertSidebar.classList.add('hidden');
    });
  }

  async function loadKeywords() {
    try {
      const userPhone = currentUser && currentUser.phone ? encodeURIComponent(currentUser.phone) : '';
      const phoneParam = userPhone ? `?phone=${userPhone}` : '';
      const res = await apiFetch(`/api/keywords${phoneParam}`);
      activeKeywords = await res.json();
      renderKeywordTags();
      if (activeKeywords.scope) {
        updateMonitoringScopeUI(activeKeywords.scope);
      }
    } catch (err) {
      console.error('Failed to load keywords:', err);
    }
  }

  function renderKeywordTags() {
    const incList = activeKeywords.include || [];
    const excList = activeKeywords.exclude || [];

    const createTagHtml = (kw, type, colorClass, iconStr) => `
      <span class="inline-flex items-center gap-1.5 px-3 py-1 ${colorClass} border rounded-full text-xs font-semibold shadow-sm">
        ${iconStr} ${escapeHtml(kw)}
        <button data-kw="${escapeHtml(kw)}" data-type="${type}" class="remove-kw-btn hover:text-rose-500 transition ml-0.5 cursor-pointer">
          <i data-lucide="x" class="w-3.5 h-3.5"></i>
        </button>
      </span>
    `;

    // 1. Include tags
    const incHtml = incList.length === 0
      ? `<span class="text-xs text-slate-400 italic">No include keywords added yet.</span>`
      : incList.map(kw => createTagHtml(kw, 'include', 'bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30', '🟢')).join('');

    if (activeIncludeKeywordTags) activeIncludeKeywordTags.innerHTML = incHtml;
    if (pageActiveIncludeKeywordTags) pageActiveIncludeKeywordTags.innerHTML = incHtml;
    if (modalActiveIncludeKeywordTags) modalActiveIncludeKeywordTags.innerHTML = incHtml;

    // 2. Exclude tags
    const excHtml = excList.length === 0
      ? `<span class="text-xs text-slate-400 italic">No exclude keywords set.</span>`
      : excList.map(kw => createTagHtml(kw, 'exclude', 'bg-rose-500/10 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/30', '🚫')).join('');

    if (activeExcludeKeywordTags) activeExcludeKeywordTags.innerHTML = excHtml;
    if (pageActiveExcludeKeywordTags) pageActiveExcludeKeywordTags.innerHTML = excHtml;
    if (modalActiveExcludeKeywordTags) modalActiveExcludeKeywordTags.innerHTML = excHtml;

    safeCreateIcons();
  }

  // Global Delegated Click Listener for Removing Keywords
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.remove-kw-btn');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const kw = btn.getAttribute('data-kw');
      const type = btn.getAttribute('data-type') || 'include';
      if (kw) {
        await removeKeyword(kw, type);
      }
    }
  });

  // Sidebar Form Submit Handlers
  if (addIncludeKeywordForm) {
    addIncludeKeywordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = includeKeywordInput ? includeKeywordInput.value.trim() : '';
      if (!val) return;
      if (includeKeywordInput) includeKeywordInput.value = '';
      await postKeyword(val, 'include');
    });
  }

  if (addExcludeKeywordForm) {
    addExcludeKeywordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = excludeKeywordInput ? excludeKeywordInput.value.trim() : '';
      if (!val) return;
      if (excludeKeywordInput) excludeKeywordInput.value = '';
      await postKeyword(val, 'exclude');
    });
  }

  // Keywords Page Form Submit Handlers
  if (pageAddIncludeKeywordForm) {
    pageAddIncludeKeywordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = pageIncludeKeywordInput ? pageIncludeKeywordInput.value.trim() : '';
      if (!val) return;
      if (pageIncludeKeywordInput) pageIncludeKeywordInput.value = '';
      await postKeyword(val, 'include');
    });
  }

  if (pageAddExcludeKeywordForm) {
    pageAddExcludeKeywordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = pageExcludeKeywordInput ? pageExcludeKeywordInput.value.trim() : '';
      if (!val) return;
      if (pageExcludeKeywordInput) pageExcludeKeywordInput.value = '';
      await postKeyword(val, 'exclude');
    });
  }

  // Modal Form Submit Handlers
  if (modalAddIncludeKeywordForm) {
    modalAddIncludeKeywordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = modalIncludeKeywordInput ? modalIncludeKeywordInput.value.trim() : '';
      if (!val) return;
      if (modalIncludeKeywordInput) modalIncludeKeywordInput.value = '';
      await postKeyword(val, 'include');
    });
  }

  if (modalAddExcludeKeywordForm) {
    modalAddExcludeKeywordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = modalExcludeKeywordInput ? modalExcludeKeywordInput.value.trim() : '';
      if (!val) return;
      if (modalExcludeKeywordInput) modalExcludeKeywordInput.value = '';
      await postKeyword(val, 'exclude');
    });
  }

  async function postKeyword(keyword, type) {
    if (!keyword || !keyword.trim()) return;
    const cleanKw = keyword.trim().toLowerCase();
    const kwType = type === 'exclude' ? 'exclude' : 'include';

    // Optimistic UI update
    if (!activeKeywords) activeKeywords = { include: [], exclude: [] };
    if (!activeKeywords.include) activeKeywords.include = [];
    if (!activeKeywords.exclude) activeKeywords.exclude = [];

    const list = kwType === 'exclude' ? activeKeywords.exclude : activeKeywords.include;
    const tokens = cleanKw.split(/[,;\n]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    tokens.forEach(tok => {
      if (!list.includes(tok)) list.push(tok);
    });
    renderKeywordTags();

    try {
      const userPhone = currentUser && currentUser.phone ? currentUser.phone : '';
      const res = await apiFetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: cleanKw, type: kwType, phone: userPhone })
      });
      const data = await res.json();
      if (data && data.keywords) {
        activeKeywords = data.keywords;
        renderKeywordTags();
        loadKeywordAlerts();
      }
    } catch (err) {
      console.error('Error adding keyword:', err);
    }
  }

  async function removeKeyword(kw, type) {
    if (!kw) return;
    const cleanKw = kw.trim().toLowerCase();
    const kwType = type === 'exclude' ? 'exclude' : 'include';

    // Optimistic UI update
    if (activeKeywords) {
      if (kwType === 'exclude' && activeKeywords.exclude) {
        activeKeywords.exclude = activeKeywords.exclude.filter(k => k.toLowerCase() !== cleanKw);
      } else if (activeKeywords.include) {
        activeKeywords.include = activeKeywords.include.filter(k => k.toLowerCase() !== cleanKw);
      }
      renderKeywordTags();
    }

    try {
      const userPhone = currentUser && currentUser.phone ? encodeURIComponent(currentUser.phone) : '';
      const phoneParam = userPhone ? `&phone=${userPhone}` : '';
      const res = await apiFetch(`/api/keywords/${encodeURIComponent(cleanKw)}?type=${encodeURIComponent(kwType)}${phoneParam}`, { method: 'DELETE' });
      const data = await res.json();
      if (data && data.keywords) {
        activeKeywords = data.keywords;
        renderKeywordTags();
        loadKeywordAlerts();
      }
    } catch (err) {
      console.error('Error removing keyword:', err);
    }
  }

  // Monitoring Scope Management (Upcoming vs All Messages)
  const scopeCardUpcoming = document.getElementById('scopeCardUpcoming');
  const scopeCardAll = document.getElementById('scopeCardAll');
  const scopeRadioUpcoming = document.getElementById('scopeRadioUpcoming');
  const scopeRadioAll = document.getElementById('scopeRadioAll');
  const activeScopeBadge = document.getElementById('activeScopeBadge');
  const modalScopeUpcomingBtn = document.getElementById('modalScopeUpcomingBtn');
  const modalScopeAllBtn = document.getElementById('modalScopeAllBtn');
  const modalScopeBadge = document.getElementById('modalScopeBadge');

  let currentMonitoringScope = 'upcoming';

  function updateMonitoringScopeUI(scope) {
    currentMonitoringScope = scope;

    if (scope === 'upcoming') {
      if (scopeRadioUpcoming) scopeRadioUpcoming.checked = true;
      if (scopeRadioAll) scopeRadioAll.checked = false;

      if (scopeCardUpcoming) {
        scopeCardUpcoming.className = 'monitoring-scope-card active p-3 rounded-xl border-2 border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 cursor-pointer transition-all flex items-center gap-3 shadow-xs';
      }
      if (scopeCardAll) {
        scopeCardAll.className = 'monitoring-scope-card p-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer transition-all flex items-center gap-3';
      }
      if (activeScopeBadge) {
        activeScopeBadge.className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400';
        activeScopeBadge.textContent = 'Active: Upcoming Only';
      }

      // Modal elements
      if (modalScopeBadge) {
        modalScopeBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400';
        modalScopeBadge.textContent = 'Upcoming Only';
      }
      if (modalScopeUpcomingBtn) {
        modalScopeUpcomingBtn.className = 'py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border transition bg-emerald-100 text-emerald-800 border-emerald-400 dark:bg-emerald-500/20 dark:text-emerald-300';
      }
      if (modalScopeAllBtn) {
        modalScopeAllBtn.className = 'py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border transition bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
      }
    } else {
      if (scopeRadioUpcoming) scopeRadioUpcoming.checked = false;
      if (scopeRadioAll) scopeRadioAll.checked = true;

      if (scopeCardUpcoming) {
        scopeCardUpcoming.className = 'monitoring-scope-card p-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer transition-all flex items-center gap-3';
      }
      if (scopeCardAll) {
        scopeCardAll.className = 'monitoring-scope-card active p-3 rounded-xl border-2 border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20 cursor-pointer transition-all flex items-center gap-3 shadow-xs';
      }
      if (activeScopeBadge) {
        activeScopeBadge.className = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-400';
        activeScopeBadge.textContent = 'Active: All (Old & Upcoming)';
      }

      // Modal elements
      if (modalScopeBadge) {
        modalScopeBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-400';
        modalScopeBadge.textContent = 'All Messages';
      }
      if (modalScopeUpcomingBtn) {
        modalScopeUpcomingBtn.className = 'py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border transition bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
      }
      if (modalScopeAllBtn) {
        modalScopeAllBtn.className = 'py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border transition bg-indigo-100 text-indigo-800 border-indigo-400 dark:bg-indigo-500/20 dark:text-indigo-300';
      }
    }
    safeCreateIcons();
  }

  async function setMonitoringScopeValue(scope) {
    updateMonitoringScopeUI(scope);
    try {
      const userPhone = currentUser && currentUser.phone ? currentUser.phone : '';
      await apiFetch('/api/keywords/scope', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, phone: userPhone })
      });
      await loadKeywordAlerts();
    } catch (e) {
      console.error('Failed to set monitoring scope:', e);
    }
  }

  if (scopeCardUpcoming) {
    scopeCardUpcoming.addEventListener('click', (e) => {
      e.stopPropagation();
      setMonitoringScopeValue('upcoming');
    });
  }
  if (scopeRadioUpcoming) {
    scopeRadioUpcoming.addEventListener('change', (e) => {
      e.stopPropagation();
      setMonitoringScopeValue('upcoming');
    });
  }

  if (scopeCardAll) {
    scopeCardAll.addEventListener('click', (e) => {
      e.stopPropagation();
      setMonitoringScopeValue('all');
    });
  }
  if (scopeRadioAll) {
    scopeRadioAll.addEventListener('change', (e) => {
      e.stopPropagation();
      setMonitoringScopeValue('all');
    });
  }

  if (modalScopeUpcomingBtn) {
    modalScopeUpcomingBtn.addEventListener('click', (e) => {
      e.preventDefault();
      setMonitoringScopeValue('upcoming');
    });
  }
  if (modalScopeAllBtn) {
    modalScopeAllBtn.addEventListener('click', (e) => {
      e.preventDefault();
      setMonitoringScopeValue('all');
    });
  }

  let knownAlertIds = new Set();
  let isFirstAlertLoad = true;

  async function loadKeywordAlerts() {
    try {
      const userPhone = currentUser && currentUser.phone ? encodeURIComponent(currentUser.phone) : '';
      const phoneParam = userPhone ? `?phone=${userPhone}` : '';
      const res = await apiFetch(`/api/keywords/alerts${phoneParam}`);
      const alerts = await res.json();
      cachedAlertsData = alerts;
      renderKeywordAlerts(alerts);
    } catch (err) {
      console.error('Error loading keyword alerts:', err);
    }
  }

  function renderKeywordAlerts(alerts) {
    if (keywordAlertsList) keywordAlertsList.innerHTML = '';

    const savedMap = getSavedTripsMap();
    const savedTrips = Object.values(savedMap).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const unSavedAlerts = (alerts || []).filter(msg => !savedMap[String(msg.message_id)]);

    // Check for freshly arrived alerts to trigger sound & notification ONLY if user has include keywords
    const userIncludes = (activeKeywords && Array.isArray(activeKeywords.include)) ? activeKeywords.include : [];
    if (!isFirstAlertLoad && Array.isArray(unSavedAlerts) && userIncludes.length > 0) {
      unSavedAlerts.forEach(msg => {
        const id = String(msg.message_id);
        if (id && !knownAlertIds.has(id)) {
          triggerMatchAlert(msg);
        }
      });
    } else if (isFirstAlertLoad && Array.isArray(alerts)) {
      isFirstAlertLoad = false;
    }
    knownAlertIds = new Set((alerts || []).map(msg => String(msg.message_id)));

    if (matchingTabCount) matchingTabCount.textContent = unSavedAlerts.length;
    if (savedTabCount) savedTabCount.textContent = savedTrips.length;
    if (alertsCountBadge) alertsCountBadge.textContent = `${unSavedAlerts.length} alerts`;
    if (pageMatchingBadge) pageMatchingBadge.textContent = `${unSavedAlerts.length} alerts`;

    if (unSavedAlerts.length > 0) {
      if (keywordBadgeCount) {
        keywordBadgeCount.classList.remove('hidden');
        keywordBadgeCount.textContent = unSavedAlerts.length > 99 ? '99+' : unSavedAlerts.length;
      }
    } else {
      if (keywordBadgeCount) keywordBadgeCount.classList.add('hidden');
    }

    let itemsToDisplay = currentMatchingSubTab === 'saved' ? savedTrips : unSavedAlerts;

    if (pageMatchingSearchInput && pageMatchingSearchInput.value.trim()) {
      const q = pageMatchingSearchInput.value.trim().toLowerCase();
      itemsToDisplay = itemsToDisplay.filter(msg => {
        const c = (msg.content || msg.ai_transcript || '').toLowerCase();
        const cn = (msg.chat_name || '').toLowerCase();
        const sn = (msg.sender_name || '').toLowerCase();
        const kws = (msg.matched_keywords || []).join(' ').toLowerCase();
        return c.includes(q) || cn.includes(q) || sn.includes(q) || kws.includes(q);
      });
    }

    if (pageMatchingAlertsGrid) {
      pageMatchingAlertsGrid.innerHTML = '';

      if (!itemsToDisplay || itemsToDisplay.length === 0) {
        if (currentMatchingSubTab === 'saved') {
          pageMatchingAlertsGrid.innerHTML = `
            <div class="col-span-full py-16 text-center text-slate-400 text-sm space-y-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <i data-lucide="bookmark" class="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600"></i>
              <p class="font-semibold text-slate-700 dark:text-slate-200">No Saved Trips</p>
              <p class="text-xs text-slate-400 max-w-sm mx-auto">Tap the "Save" chip on any matched trip to move and keep it here permanently.</p>
            </div>
          `;
        } else {
          pageMatchingAlertsGrid.innerHTML = `
            <div class="col-span-full py-16 text-center text-slate-400 text-sm space-y-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
              <i data-lucide="shield-alert" class="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600"></i>
              <p class="font-semibold text-slate-700 dark:text-slate-200">No Matched Trips Found</p>
              <p class="text-xs text-slate-400 max-w-sm mx-auto">New matching trips from WhatsApp groups will appear here automatically.</p>
            </div>
          `;
        }
      } else {
        itemsToDisplay.forEach(msg => {
          const card = createKeywordAlertCard(msg);
          pageMatchingAlertsGrid.appendChild(card);
        });
      }
    }

    // Render sidebar alerts list if present
    if (keywordAlertsList) {
      unSavedAlerts.forEach(msg => {
        const card = createKeywordAlertCard(msg);
        keywordAlertsList.appendChild(card);
      });
    }

    bindAlertCardCTAs();
    safeCreateIcons();
  }

  if (pageMatchingSearchInput) {
    pageMatchingSearchInput.addEventListener('input', () => {
      renderKeywordAlerts(cachedAlertsData);
    });
  }

  function highlightKeywordsInText(text, keywords) {
    if (!text || !keywords || keywords.length === 0) return escapeHtml(text || '');
    let html = escapeHtml(text);
    keywords.forEach(kw => {
      const regex = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      html = html.replace(regex, '<mark class="highlight">$1</mark>');
    });
    return html;
  }

  function extractPhoneFromText(text) {
    if (!text) return '';
    const patterns = [
      /(?:(?:\+|00)?91[\s.-]?)?([6-9]\d{4}[\s.-]?\d{5})\b/,
      /(?:(?:\+|00)?91[\s.-]?)?([6-9]\d{9})\b/,
      /\b(0?[6-9]\d{9})\b/,
      /\b([6-9]\d{2}[\s.-]?\d{3}[\s.-]?\d{4})\b/
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const digits = match[0].replace(/\D/g, '');
        const clean = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) :
                      (digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits);
        if (clean.length === 10 && /^[6-9]/.test(clean)) {
          return clean;
        }
      }
    }
    return '';
  }

  function resolveCallNumber(msg) {
    // 1st Priority: Look for a phone number inside the message content itself
    const fullText = `${msg.content || ''} ${msg.ai_transcript || ''} ${msg.ai_translation || ''}`;
    const textPhone = extractPhoneFromText(fullText);
    if (textPhone) {
      return {
        number: `+91${textPhone}`,
        display: textPhone,
        source: 'message'
      };
    }

    // 2nd Priority: Person who put the message (sender's phone)
    let senderNum = '';
    if (msg.sender_phone) {
      senderNum = String(msg.sender_phone).replace(/\D/g, '');
    } else if (msg.sender_formatted_phone) {
      senderNum = String(msg.sender_formatted_phone).replace(/\D/g, '');
    } else if (msg.sender_name) {
      const match = String(msg.sender_name).match(/(?:\+?91[\s.-]?)?([6-9]\d{4}[\s.-]?\d{5}|[6-9]\d{9})/);
      if (match) {
        senderNum = match[0].replace(/\D/g, '');
      }
    } else if (msg.sender_jid && !msg.sender_jid.includes('@lid') && !msg.sender_jid.includes('@g.us')) {
      senderNum = String(msg.sender_jid).split('@')[0].replace(/\D/g, '');
    }

    if (senderNum) {
      const clean = senderNum.length === 12 && senderNum.startsWith('91') ? senderNum.slice(2) :
                    (senderNum.length === 11 && senderNum.startsWith('0') ? senderNum.slice(1) : senderNum);
      if (clean.length === 10 && /^[6-9]/.test(clean)) {
        return {
          number: `+91${clean}`,
          display: clean,
          source: 'sender'
        };
      } else if (senderNum.length >= 7 && !/^\d{13,}$/.test(senderNum)) {
        return {
          number: `+${senderNum}`,
          display: senderNum,
          source: 'sender'
        };
      }
    }

    return null;
  }

  // Persistent Saved Trips Store
  function getSavedTripsMap() {
    try {
      const data = localStorage.getItem('saved_trips_data_map');
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  }

  function saveTripObject(msg) {
    const map = getSavedTripsMap();
    map[String(msg.message_id)] = msg;
    localStorage.setItem('saved_trips_data_map', JSON.stringify(map));
  }

  function removeTripObject(msgId) {
    const map = getSavedTripsMap();
    delete map[String(msgId)];
    localStorage.setItem('saved_trips_data_map', JSON.stringify(map));
  }

  function isTripSaved(msgId) {
    const map = getSavedTripsMap();
    return !!map[String(msgId)];
  }

  function createKeywordAlertCard(msg) {
    const card = document.createElement('div');
    card.className = 'alert-card p-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-emerald-500 rounded-2xl space-y-2.5 shadow-sm hover:shadow transition-all my-2 relative group';
    card.setAttribute('data-chat-jid', msg.chat_jid);
    card.setAttribute('data-msg-id', msg.message_id);

    const timeStr = new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const matchedBadges = (msg.matched_keywords || []).map(kw => `
      <span class="px-2 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-400 font-bold rounded-md text-[10px]">
        🏷️ ${escapeHtml(kw)}
      </span>
    `).join('');

    const fullContent = msg.content || msg.ai_transcript || '[Media Message]';
    const highlightedContent = highlightKeywordsInText(fullContent, msg.matched_keywords);
    const callInfo = resolveCallNumber(msg);

    const isSaved = isTripSaved(msg.message_id);

    card.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <p class="font-bold text-slate-900 dark:text-white text-xs truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition">${escapeHtml(msg.chat_name || msg.sender_name || 'WhatsApp Contact')}</p>
          <p class="text-[10px] text-slate-500 dark:text-slate-400 truncate">From: ${escapeHtml(msg.sender_name || 'Unknown')}</p>
        </div>
        <span class="text-[10px] text-slate-400 font-medium flex-shrink-0">${timeStr}</span>
      </div>

      <!-- Keywords on Left, Save Chip on Right -->
      <div class="flex items-center justify-between gap-1">
        <div class="flex flex-wrap gap-1">
          ${matchedBadges}
        </div>
        <button type="button" class="save-trip-chip-btn ${isSaved ? 'saved' : ''} px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 transition-all flex-shrink-0 cursor-pointer active:scale-95 shadow-xs" data-msg-id="${msg.message_id}">
          <i data-lucide="${isSaved ? 'bookmark-check' : 'bookmark'}" class="w-3 h-3 ${isSaved ? 'text-amber-600' : 'text-slate-400'}"></i>
          <span>${isSaved ? 'Saved' : 'Save'}</span>
        </button>
      </div>

      <p class="text-xs text-slate-700 dark:text-slate-200 leading-relaxed break-words bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-xl border border-slate-200/60 dark:border-slate-700/60 font-normal">
        ${highlightedContent}
      </p>

      <!-- Single Line Dual Action CTAs: 1. View Message & 2. Call -->
      <div class="flex items-center gap-2 pt-1">
        <button type="button" class="open-chat-cta-btn flex-1 py-2.5 px-3 text-white font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95">
          <i data-lucide="message-square" class="w-3.5 h-3.5"></i>
          <span>View Message</span>
        </button>

        ${callInfo ? `
          <a href="tel:${callInfo.number}" data-phone="${callInfo.number}" class="call-cta-btn flex-1 py-2.5 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 active:scale-95 no-underline">
            <i data-lucide="phone-call" class="w-3.5 h-3.5 flex-shrink-0"></i>
            <span class="truncate font-semibold text-xs">Call ${callInfo.display || ''}</span>
          </a>
        ` : `
          <button type="button" disabled class="call-cta-disabled flex-1 py-2.5 px-3 font-medium text-xs rounded-xl cursor-not-allowed flex items-center justify-center gap-1.5">
            <i data-lucide="phone-off" class="w-3.5 h-3.5"></i>
            <span>No Number</span>
          </button>
        `}
      </div>
    `;

    return card;
  }

  function bindAlertCardCTAs() {
    document.querySelectorAll('.alert-card').forEach(card => {
      if (card.hasAttribute('data-bound')) return;
      card.setAttribute('data-bound', 'true');

      // 1. View Message button
      const openBtn = card.querySelector('.open-chat-cta-btn');
      if (openBtn) {
        openBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const jid = card.getAttribute('data-chat-jid');
          const msgId = card.getAttribute('data-msg-id');
          if (jid) {
            switchTab('whatsapp');
            openChatAndScrollToMessage(jid, msgId);
          }
        });
      }

      // 2. Call button
      const callBtn = card.querySelector('.call-cta-btn');
      if (callBtn) {
        callBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const phone = callBtn.getAttribute('data-phone');
          if (phone) {
            window.location.href = `tel:${phone}`;
          }
        });
      }

      // 3. Save Chip button (Moves to Saved tab on Save)
      const saveBtn = card.querySelector('.save-trip-chip-btn');
      if (saveBtn) {
        saveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const msgId = saveBtn.getAttribute('data-msg-id');
          if (msgId) {
            if (isTripSaved(msgId)) {
              // Unsave
              removeTripObject(msgId);
              renderKeywordAlerts(cachedAlertsData);
            } else {
              // Save and move to Saved tab
              const found = (cachedAlertsData || []).find(m => String(m.message_id) === String(msgId));
              if (found) {
                saveTripObject(found);
              } else {
                saveTripObject({
                  message_id: msgId,
                  chat_jid: card.getAttribute('data-chat-jid'),
                  content: card.querySelector('p.break-words') ? card.querySelector('p.break-words').textContent.trim() : '',
                  chat_name: card.querySelector('p.font-bold') ? card.querySelector('p.font-bold').textContent.trim() : '',
                  timestamp: Math.floor(Date.now() / 1000)
                });
              }
              // Switch to Saved tab immediately so user sees it in Saved place
              setMatchingSubTab('saved');
            }
          }
        });
      }

      // Background card click
      card.addEventListener('click', (e) => {
        if (e.target.closest('.call-cta-btn') || e.target.closest('.open-chat-cta-btn') || e.target.closest('.save-trip-chip-btn')) return;
        const jid = card.getAttribute('data-chat-jid');
        const msgId = card.getAttribute('data-msg-id');
        if (jid) {
          switchTab('whatsapp');
          openChatAndScrollToMessage(jid, msgId);
        }
      });
    });
  }


  async function openChatAndScrollToMessage(jid, msgId) {
    const thread = threadsData.find(t => t.jid === jid);
    const name = thread ? thread.name : (jid.includes('@g.us') ? 'Group Chat' : jid.split('@')[0]);
    const isGroup = jid.endsWith('@g.us');

    await selectChatThread(jid, name, isGroup);

    if (msgId) {
      let attempts = 0;
      const highlightInterval = setInterval(() => {
        attempts++;
        const targetBubble = chatMessagesCanvas.querySelector(`[data-bubble-msg-id="${msgId}"]`);
        if (targetBubble) {
          clearInterval(highlightInterval);

          const innerBubble = targetBubble.querySelector('.bubble-recv, .bubble-sent') || targetBubble;

          targetBubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
          innerBubble.classList.add('highlighted-yellow-bubble');

          setTimeout(() => {
            targetBubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 300);

          setTimeout(() => {
            innerBubble.classList.remove('highlighted-yellow-bubble');
          }, 6000);
        } else if (attempts > 20) {
          clearInterval(highlightInterval);
        }
      }, 150);
    }
  }

  loadKeywords();
  loadKeywordAlerts();

  const alreadyConnectedBanner = document.getElementById('alreadyConnectedBanner');
  const connectedUserName = document.getElementById('connectedUserName');
  const qrContainer = document.getElementById('qrContainer');
  const qrContinueBtn = document.getElementById('qrContinueBtn');
  const qrLogoutBtn = document.getElementById('qrLogoutBtn');
  const forceGenerateQrBtn = document.getElementById('forceGenerateQrBtn');
  const closeQrModalBtn = document.getElementById('closeQrModalBtn');

  if (closeQrModalBtn) {
    closeQrModalBtn.addEventListener('click', () => {
      if (qrModal) {
        qrModal.classList.add('hidden');
        qrModal.style.display = 'none';
      }
    });
  }

  // Only show QR modal if user explicitly triggers it or when a real QR is ready
  if (qrModal) {
    qrModal.classList.add('hidden');
    qrModal.style.display = 'none';
  }

  // "Open App" button on connected banner — only works when connected
  if (qrContinueBtn) {
    qrContinueBtn.addEventListener('click', () => {
      if (qrModal) {
        qrModal.classList.add('hidden');
        qrModal.style.display = 'none';
      }
    });
  }

  async function triggerLogoutAndReset() {
    try {
      setStoredWA({ status: 'disconnected' });
      isConnected = false;
      // Open QR modal immediately so user sees the reconnect flow
      if (qrModal) {
        qrModal.classList.remove('hidden');
        qrModal.style.display = 'flex';
      }
      if (alreadyConnectedBanner) alreadyConnectedBanner.classList.add('hidden');
      if (qrContainer) qrContainer.classList.remove('hidden');
      if (qrLoading) qrLoading.classList.remove('hidden');
      if (qrFrame) qrFrame.classList.add('hidden');
      await apiFetch('/api/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    }
  }

  if (qrLogoutBtn) {
    qrLogoutBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to disconnect WhatsApp and generate a new QR code?')) {
        await triggerLogoutAndReset();
      }
    });
  }

  const profileLogoutBtn = document.getElementById('profileLogoutBtn');
  if (profileLogoutBtn) {
    profileLogoutBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to disconnect WhatsApp? This will remove the active WhatsApp session on the server.')) {
        await triggerLogoutAndReset();
      }
    });
  }

  if (forceGenerateQrBtn) {
    forceGenerateQrBtn.addEventListener('click', triggerLogoutAndReset);
  }

  async function fetchStatusFallback() {
    try {
      const res = await apiFetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        updateConnectionStatus(data);
      }
    } catch (e) {}
  }

  // Poll status periodically to keep UI tightly in sync with backend WhatsApp state
  setInterval(fetchStatusFallback, 3000);
  fetchStatusFallback();

  function updateConnectionStatus(data) {
    const { status, qr, user, serverIp } = data;
    console.log('📡 WhatsApp status update received:', status, qr ? 'QR available' : 'No QR');

    if (qr) {
      currentQrData = qr;
    }

    if (qrServerUrlInput && serverIp && serverIp !== 'localhost' && !qrServerUrlInput.value.includes(serverIp)) {
      qrServerUrlInput.placeholder = `http://${serverIp}:3000`;
    }

    if (status === 'connected' || user) {
      isConnected = true;
      currentQrData = null;
      setStoredWA({ status: 'connected', user: user || { name: waAccountName, phone: waAccountPhone } });
      if (statusText) statusText.textContent = 'Connected';
      if (statusBadge) statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span> Connected`;

      if (user) {
        waAccountName = user.name || '';
        waAccountPhone = user.phone || '';
        if (userName) userName.textContent = user.name || 'WhatsApp Monitor';
        if (connectedUserName) connectedUserName.textContent = `${user.name || 'WhatsApp Account'} (${user.phone || ''})`;
        const initial = (user.name || 'W').charAt(0).toUpperCase();
        if (userAvatar) userAvatar.textContent = initial;
        updateProfilePageData();
      }

      // Connected → close QR modal
      if (qrModal) {
        qrModal.classList.add('hidden');
        qrModal.style.display = 'none';
      }
      if (alreadyConnectedBanner) alreadyConnectedBanner.classList.add('hidden');
      if (qrContainer) qrContainer.classList.add('hidden');

      if (currentUser) {
        loadStats();
        loadThreads();
      }
    } else if (qr || currentQrData) {
      isConnected = false;
      const qrToShow = qr || currentQrData;
      if (statusText) statusText.textContent = 'Scan QR Code';
      if (statusBadge) {
        statusBadge.innerHTML = `<button type="button" class="cursor-pointer flex items-center gap-1.5 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white text-xs font-bold rounded-lg shadow animate-pulse"><i data-lucide="qr-code" class="w-3.5 h-3.5"></i> Link WhatsApp</button>`;
      }

      if (qrFrame) qrFrame.classList.remove('hidden');
      if (qrImage) qrImage.src = qrToShow;
      if (qrLoading) qrLoading.classList.add('hidden');
    } else if (status === 'connecting') {
      isConnected = false;
      if (statusText) statusText.textContent = 'Connecting...';
      if (statusBadge) {
        statusBadge.innerHTML = `<button type="button" class="cursor-pointer flex items-center gap-1.5 px-2 py-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-xs font-semibold rounded-lg"><span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span> Connecting...</button>`;
      }
    } else {
      isConnected = false;
      if (statusText) statusText.textContent = 'Disconnected';
      if (statusBadge) {
        statusBadge.innerHTML = `<button type="button" class="cursor-pointer flex items-center gap-1.5 px-2.5 py-1 bg-rose-500 hover:bg-rose-600 active:scale-95 text-white text-xs font-bold rounded-lg shadow"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Reconnect WhatsApp</button>`;
      }
    }

    safeCreateIcons();
  }

  // Allow clicking header status badge to trigger QR modal / Reconnect (checks subscription)
  if (statusBadge) {
    statusBadge.addEventListener('click', () => {
      showQrModal();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm('Log out from your user account? WhatsApp will remain actively connected on the server in the background.')) {
        clearStoredUser();
        showAuthStep('phone');
      }
    });
  }

  if (refreshThreadsBtn) {
    refreshThreadsBtn.addEventListener('click', () => {
      loadStats();
      loadThreads();
    });
  }

  async function loadStats() {
    try {
      const res = await apiFetch('/api/stats');
      const data = await res.json();
      if (sidebarTotalCount) sidebarTotalCount.textContent = (data.totalMessages || 0).toLocaleString();
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }

  async function loadThreads() {
    const q = sidebarSearchInput ? sidebarSearchInput.value.trim() : '';
    try {
      const res = await apiFetch(`/api/threads?q=${encodeURIComponent(q)}`);
      threadsData = await res.json();

      renderSidebarThreads(threadsData, q);

      // On wide screens (desktop / tablet / landscape), auto-select first thread if none is currently selected
      if (!activeChatJid && threadsData && threadsData.length > 0 && window.innerWidth >= 768) {
        const first = threadsData[0];
        selectChatThread(first.jid, first.name || first.jid, first.jid.endsWith('@g.us'));
      }
    } catch (err) {
      console.error('Failed to load chat threads:', err);
    }
  }

  function renderSidebarThreads(threads, query = '') {
    chatThreadsContainer.innerHTML = '';

    const totalUnread = (threads || []).reduce((sum, t) => sum + (Number(t.unread_count || 0) > 0 ? 1 : 0), 0);
    if (filterUnreadBadge) filterUnreadBadge.textContent = totalUnread;

    let filteredThreads = threads || [];
    if (currentFilter === 'groups') {
      filteredThreads = threads.filter(t => t.jid && t.jid.endsWith('@g.us'));
    } else if (currentFilter === 'unread') {
      filteredThreads = threads.filter(t => Number(t.unread_count || 0) > 0);
    } else if (currentFilter === 'channels') {
      filteredThreads = threads.filter(t => t.jid && (t.jid.endsWith('@newsletter') || (typeof t.jid === 'string' && t.jid.includes('newsletter'))));
    }

    if (query && query.trim()) {
      const q = query.trim().toLowerCase();
      filteredThreads = filteredThreads.filter(t => 
        (t.name && t.name.toLowerCase().includes(q)) || 
        (t.last_message && t.last_message.toLowerCase().includes(q)) ||
        (t.phone && t.phone.includes(q))
      );
    }

    if (sidebarTotalCount) sidebarTotalCount.textContent = (threads || []).length.toLocaleString();

    if (!filteredThreads || filteredThreads.length === 0) {
      chatThreadsContainer.innerHTML = `
        <div class="p-12 text-center text-slate-400 text-xs space-y-2">
          <i data-lucide="message-square-off" class="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600"></i>
          <p>No ${currentFilter === 'groups' ? 'groups' : currentFilter === 'unread' ? 'unread chats' : currentFilter === 'channels' ? 'channels' : 'chats'} found.</p>
        </div>
      `;
      safeCreateIcons();
      return;
    }

    const avatarGradients = [
      'bg-emerald-600',
      'bg-indigo-600',
      'bg-blue-600',
      'bg-purple-600',
      'bg-amber-600',
      'bg-rose-600',
      'bg-teal-600'
    ];

    filteredThreads.forEach(t => {
      const isGroup = t.jid && t.jid.endsWith('@g.us');
      const isSelected = activeChatJid === t.jid;
      const unreadCount = Number(t.unread_count || 0);

      const div = document.createElement('div');
      div.className = `chat-row px-4 py-3 flex items-center gap-3.5 cursor-pointer transition select-none border-b border-slate-100/80 dark:border-slate-800/80 ${
        isSelected 
          ? 'bg-slate-100 dark:bg-slate-800/90' 
          : 'bg-white dark:bg-wa-sidebarDark'
      }`;

      const rawName = t.name || 'WhatsApp Contact';
      let cleanDisplayName = rawName;
      if (cleanDisplayName.startsWith('120363') || cleanDisplayName.includes('@newsletter') || cleanDisplayName.includes('@lid')) {
        cleanDisplayName = t.display_phone || formatPhoneNumber(t.phone) || 'WhatsApp Channel';
      }

      const initial = (cleanDisplayName || 'C').charAt(0).toUpperCase();
      const colorClass = avatarGradients[(cleanDisplayName.charCodeAt(0) || 0) % avatarGradients.length];

      const avatarHtml = `
        <div class="relative w-12 h-12 flex-shrink-0">
          <div class="w-12 h-12 rounded-full ${isGroup ? 'bg-indigo-600' : colorClass} text-white font-bold flex items-center justify-center text-base shadow-sm">
            ${isGroup ? '<i data-lucide="users" class="w-5 h-5"></i>' : initial}
          </div>
          <span class="w-3.5 h-3.5 bg-emerald-500 border-2 border-white dark:border-slate-800 rounded-full absolute -top-0.5 -right-0.5 shadow-sm"></span>
        </div>
      `;

      const dateFormatted = t.last_timestamp 
        ? formatShortTime(t.last_timestamp) 
        : '';

      const lastSnippet = t.last_message 
        ? escapeHtml(t.last_message)
        : (isGroup ? 'Group Chat' : 'WhatsApp Contact');

      div.innerHTML = `
        ${avatarHtml}

        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-1 mb-0.5">
            <div class="flex items-center gap-1.5 min-w-0">
              <h4 class="font-bold text-slate-900 dark:text-white text-[15px] tracking-tight truncate">${escapeHtml(cleanDisplayName)}</h4>
              ${isGroup ? '<i data-lucide="pin" class="w-3.5 h-3.5 text-emerald-500 flex-shrink-0"></i>' : ''}
            </div>
            <span class="text-xs ${unreadCount > 0 ? 'font-bold text-emerald-600 dark:text-emerald-400' : 'text-slate-400'} flex-shrink-0">${dateFormatted}</span>
          </div>

          <div class="flex items-center justify-between gap-2">
            <p class="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
              ${t.last_is_from_me ? '<span class="text-emerald-600 dark:text-emerald-400 font-semibold">You: </span>' : ''}
              <span>${lastSnippet}</span>
            </p>
            ${unreadCount > 0 ? `<span class="w-5 h-5 rounded-full bg-emerald-500 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0 shadow-sm">${unreadCount}</span>` : ''}
          </div>
        </div>
      `;

      div.addEventListener('click', () => {
        selectChatThread(t.jid, cleanDisplayName, isGroup);
      });

      chatThreadsContainer.appendChild(div);
    });

    safeCreateIcons();
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
    } else if (clean.length >= 7 && clean.length <= 12) {
      return `+${clean}`;
    }
    return '';
  }

  async function selectChatThread(jid, name, isGroup) {
    activeChatJid = jid;
    activeChatName = name;

    renderSidebarThreads(threadsData, sidebarSearchInput.value.trim());

    if (noChatSelected) noChatSelected.classList.add('hidden');
    if (activeChatView) activeChatView.classList.remove('hidden');

    const isNewsletter = jid.endsWith('@newsletter');
    const foundThread = threadsData.find(t => t.jid === jid);
    let displayTitle = name;
    let displaySubtitle = '';

    if (isNewsletter) {
      if (displayTitle.startsWith('120363')) displayTitle = 'WhatsApp Channel';
      displaySubtitle = 'Official Channel Broadcast';
    } else if (isGroup) {
      displaySubtitle = 'Group Conversation';
    } else if (jid.includes('21968959045662') || displayTitle === 'Me') {
      displaySubtitle = '+91 93452 33351';
    } else if (foundThread && foundThread.display_phone) {
      displaySubtitle = foundThread.display_phone;
    } else if (foundThread && foundThread.phone) {
      displaySubtitle = formatPhoneNumber(foundThread.phone) || foundThread.display_phone || 'WhatsApp Contact';
    } else {
      const clean = jid.split('@')[0];
      displaySubtitle = formatPhoneNumber(clean) || 'WhatsApp Contact';
    }

    if (activeChatNameEl) activeChatNameEl.textContent = displayTitle;
    if (activeChatJidEl) activeChatJidEl.textContent = displaySubtitle;

    // Mobile Responsive Toggle
    const chatSidebar = document.getElementById('chatSidebar');
    const chatMainArea = document.getElementById('chatMainArea');
    const bottomNav = document.getElementById('bottomNav');
    if (chatSidebar && chatMainArea) {
      if (window.innerWidth < 768) {
        chatSidebar.classList.add('mobile-hidden');
        chatMainArea.classList.remove('mobile-hidden');
        if (bottomNav) {
          bottomNav.classList.add('chat-active-hidden');
          bottomNav.style.display = 'none';
        }
        document.body.classList.add('chat-active');
      } else {
        chatSidebar.classList.remove('mobile-hidden');
        chatMainArea.classList.remove('mobile-hidden');
        if (bottomNav) {
          bottomNav.classList.remove('chat-active-hidden');
          bottomNav.style.display = '';
        }
        document.body.classList.remove('chat-active');
      }
    }

    if (isGroup) {
      activeChatTypeBadge.classList.remove('hidden');
      activeChatAvatar.className = 'w-10 h-10 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center flex-shrink-0 text-sm shadow';
      activeChatAvatar.innerHTML = `<i data-lucide="users" class="w-5 h-5"></i>`;
    } else {
      activeChatTypeBadge.classList.add('hidden');
      activeChatAvatar.className = 'w-10 h-10 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center flex-shrink-0 text-sm shadow';
      activeChatAvatar.textContent = (name || 'C').charAt(0).toUpperCase();
    }

    await loadThreadMessages(jid);
    chatMessageInput.focus();
  }

  async function loadThreadMessages(jid) {
    try {
      const res = await apiFetch(`/api/threads/${encodeURIComponent(jid)}/messages?limit=200`);
      const messages = await res.json();

      renderMessagesCanvas(messages);
      scrollToCanvasBottom();
    } catch (err) {
      console.error('Failed to load thread messages:', err);
    }
  }

  function renderMessagesCanvas(messages) {
    chatMessagesCanvas.innerHTML = '';

    if (!messages || messages.length === 0) {
      chatMessagesCanvas.innerHTML = `
        <div class="py-12 text-center text-slate-400 text-xs space-y-2">
          <i data-lucide="message-circle" class="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600"></i>
          <p>No messages in this chat yet. Type a message below to start chatting!</p>
        </div>
      `;
      safeCreateIcons();
      return;
    }

    const filterQuery = chatSearchInput.value.trim();

    messages.forEach(msg => {
      const bubble = createBubbleElement(msg, filterQuery);
      chatMessagesCanvas.appendChild(bubble);
    });

    bindAITranscribeButtons();
    safeCreateIcons();
  }

  function appendOrUpdateBubbleInCanvas(msg) {
    const emptyNotice = chatMessagesCanvas.querySelector('.text-center');
    if (emptyNotice) emptyNotice.remove();

    const existingBubble = chatMessagesCanvas.querySelector(`[data-bubble-msg-id="${msg.message_id}"]`);
    const filterQuery = chatSearchInput.value.trim();
    const newBubble = createBubbleElement(msg, filterQuery);

    if (existingBubble) {
      chatMessagesCanvas.replaceChild(newBubble, existingBubble);
    } else {
      newBubble.classList.add('animate-bubble');
      chatMessagesCanvas.appendChild(newBubble);
    }

    bindAITranscribeButtons();
    safeCreateIcons();
  }

  function createBubbleElement(msg, query = '') {
    const isMe = msg.is_from_me === 1;

    const outer = document.createElement('div');
    outer.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'} my-1`;
    outer.setAttribute('data-bubble-msg-id', msg.message_id);

    const timeStr = new Date(msg.timestamp * 1000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    const highlightedContent = highlightText(escapeHtml(msg.content || ''), query);

    let audioPlayerHtml = '';
    if (msg.message_type === 'audio') {
      const hasTranscript = msg.ai_transcript && 
        msg.ai_transcript !== 'Hello' && 
        msg.ai_transcript !== 'Hello, I am here.' && 
        !msg.ai_transcript.startsWith('[Audio Voice Note');

      const speechText = hasTranscript ? msg.ai_transcript : '(Click below to run local Whisper AI speech recognition)';
      const translationText = hasTranscript ? (msg.ai_translation || msg.ai_transcript) : '(Click below to run local Whisper AI speech recognition)';

      audioPlayerHtml = `
        <div class="my-2 space-y-2">
          <audio controls class="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
            <source src="/api/media/${msg.message_id}" type="audio/ogg">
            Audio playback not supported.
          </audio>
          
          <div class="ai-output-box p-2.5 bg-slate-50 dark:bg-slate-900 rounded-lg text-xs space-y-1 border border-slate-200 dark:border-slate-700">
            <p class="font-bold text-amber-500 flex items-center justify-between gap-1">
              <span class="flex items-center gap-1"><i data-lucide="bot" class="w-3.5 h-3.5"></i> ⚡ Auto AI Speech Result:</span>
            </p>
            <p class="ai-transcript text-slate-800 dark:text-slate-200 font-medium">🗣️ Speech: "${escapeHtml(speechText)}"</p>
            <p class="ai-translation text-slate-600 dark:text-slate-400 italic">🌍 English: "${escapeHtml(translationText)}"</p>
          </div>

          <button data-msg-id="${msg.message_id}" class="ai-transcribe-btn w-full py-1.5 px-3 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 rounded-lg font-medium text-xs flex items-center justify-center gap-1.5 transition-colors">
            <i data-lucide="sparkles" class="w-3.5 h-3.5"></i> ${hasTranscript ? 'Re-run Local Whisper AI' : 'Run Local Whisper AI Speech-to-Text'}
          </button>
        </div>
      `;
    }

    const typeBadge = msg.message_type !== 'text' && msg.message_type !== 'audio'
      ? `<span class="inline-flex items-center gap-1 text-[10px] font-bold uppercase opacity-80 mb-1"><i data-lucide="${getTypeIcon(msg.message_type)}" class="w-3 h-3"></i> ${msg.message_type}</span><br>`
      : '';

    const textTranslationHtml = (msg.message_type === 'text' && msg.ai_translation && msg.ai_translation !== msg.content)
      ? `<div class="mt-1 pt-1 border-t border-slate-200/40 dark:border-slate-700/40 text-[11px] text-slate-600 dark:text-slate-300 italic flex items-center gap-1">
           <i data-lucide="globe" class="w-3 h-3 text-emerald-500"></i>
           <span>${escapeHtml(msg.ai_translation)}</span>
         </div>`
      : '';

    const isGroupChat = activeChatJid && activeChatJid.endsWith('@g.us');

    let senderHeaderHtml = '';
    if (!isMe && isGroupChat) {
      let displayName = (msg.sender_name || msg.sender_display || '').trim();
      let phoneStr = msg.sender_formatted_phone || (msg.sender_phone ? formatPhoneNumber(msg.sender_phone) : '');

      // Never show internal IDs (120363... or @newsletter or @lid or 13+ digits) as a person's name
      if (displayName.startsWith('120363') || displayName.includes('@newsletter') || displayName.includes('@lid') || /^\d{13,}$/.test(displayName)) {
        displayName = '';
      }

      // Check if displayName already contains formatted phone like "Jeeva Sri Balaji Cabs Vellore (+91 94435 41806)"
      const match = displayName.match(/^(.*?)\s*(\(\+?91[\d\s-]+\))$/);
      if (match) {
        const namePart = match[1].trim();
        const phonePart = match[2].trim();
        senderHeaderHtml = `<p class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mb-1 flex items-baseline flex-wrap gap-1">
          <span>${escapeHtml(namePart)}</span>
          <span class="font-medium text-[10px] text-emerald-700/80 dark:text-emerald-300/80">${escapeHtml(phonePart)}</span>
        </p>`;
      } else if (displayName && phoneStr && !displayName.includes(phoneStr)) {
        senderHeaderHtml = `<p class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mb-1 flex items-baseline flex-wrap gap-1">
          <span>${escapeHtml(displayName)}</span>
          <span class="font-medium text-[10px] text-emerald-700/80 dark:text-emerald-300/80">(${escapeHtml(phoneStr)})</span>
        </p>`;
      } else if (displayName) {
        senderHeaderHtml = `<p class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mb-1">${escapeHtml(displayName)}</p>`;
      } else if (phoneStr) {
        senderHeaderHtml = `<p class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mb-1">${escapeHtml(phoneStr)}</p>`;
      } else {
        senderHeaderHtml = `<p class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mb-1">WhatsApp Member</p>`;
      }
    }

    outer.innerHTML = `
      <div class="max-w-[85%] sm:max-w-[70%] p-3 rounded-2xl shadow-sm text-xs sm:text-sm ${
        isMe ? 'bubble-sent' : 'bubble-recv'
      }">
        ${senderHeaderHtml}
        ${typeBadge}
        <p class="leading-relaxed break-words whitespace-pre-wrap">${highlightedContent}</p>
        ${textTranslationHtml}
        ${audioPlayerHtml}
        <div class="flex items-center justify-end gap-1 text-[10px] opacity-70 mt-1">
          <span>${timeStr}</span>
          ${isMe ? '<i data-lucide="check-check" class="w-3.5 h-3.5 text-emerald-500"></i>' : ''}
        </div>
      </div>
    `;

    return outer;
  }

  function bindAITranscribeButtons() {
    document.querySelectorAll('.ai-transcribe-btn').forEach(btn => {
      if (btn.hasAttribute('data-bound')) return;
      btn.setAttribute('data-bound', 'true');

      btn.addEventListener('click', async (e) => {
        const targetBtn = e.currentTarget;
        const msgId = targetBtn.getAttribute('data-msg-id');
        const parent = targetBtn.closest('.my-2');
        const outputBox = parent.querySelector('.ai-output-box');
        const transcriptEl = parent.querySelector('.ai-transcript');
        const translationEl = parent.querySelector('.ai-translation');

        targetBtn.disabled = true;
        targetBtn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> AI Transcribing Audio...`;
        safeCreateIcons();

        try {
          const res = await apiFetch(`/api/media/${encodeURIComponent(msgId)}/transcribe`, { method: 'POST' });
          const data = await res.json();

          if (data.success) {
            outputBox.classList.remove('hidden');
            transcriptEl.textContent = `🗣️ Speech: "${data.transcript}"`;
            translationEl.textContent = `🌍 English: "${data.translation}"`;
            targetBtn.innerHTML = `<i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-500"></i> Transcribed by Open Source AI`;
          } else {
            alert(`AI Transcription error: ${data.error}`);
            targetBtn.disabled = false;
            targetBtn.innerHTML = `🤖 AI Transcribe & Translate`;
          }
        } catch (err) {
          console.error('AI Transcribe error:', err);
          alert('Error contacting AI engine for transcription.');
          targetBtn.disabled = false;
          targetBtn.innerHTML = `🤖 AI Transcribe & Translate`;
        }
        safeCreateIcons();
      });
    });
  }

  async function handleSendMessage() {
    const text = chatMessageInput.value.trim();
    if (!text || !activeChatJid) return;

    chatMessageInput.value = '';

    try {
      const res = await apiFetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: activeChatJid, text })
      });

      const data = await res.json();
      if (!data.success) {
        alert(`Failed to send message: ${data.error}`);
      }
    } catch (err) {
      console.error('Send message error:', err);
      alert('Failed to send WhatsApp message. Check connection.');
    }
  }

  sendMessageBtn.addEventListener('click', handleSendMessage);

  chatMessageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  function getTypeIcon(type) {
    switch (type) {
      case 'image': return 'image';
      case 'video': return 'video';
      case 'audio': return 'mic';
      case 'document': return 'file-text';
      case 'sticker': return 'smile';
      case 'reaction': return 'heart';
      case 'poll': return 'bar-chart-2';
      default: return 'paperclip';
    }
  }

  function highlightText(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<mark class="highlight">$1</mark>');
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatShortTime(timestamp) {
    const d = new Date(timestamp * 1000);
    const now = new Date();

    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function scrollToCanvasBottom() {
    chatMessagesCanvas.scrollTop = chatMessagesCanvas.scrollHeight;
  }

  if (sidebarSearchInput) {
    sidebarSearchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(loadThreads, 300);
    });
  }

  if (chatSearchInput) {
    chatSearchInput.addEventListener('input', () => {
      if (activeChatJid) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => loadThreadMessages(activeChatJid), 300);
      }
    });
  }

  // Register Service Worker for Mobile PWA Capabilities
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      if (reg && reg.update) reg.update();
      console.log('Mobile App ServiceWorker registered and updated successfully');
    }).catch(err => {
      console.warn('ServiceWorker registration error:', err);
    });
  }

  // =========================================================================
  // 📲 MOBILE PWA 1-CLICK APP INSTALL ENGINE
  // =========================================================================
  let deferredInstallPrompt = null;
  const installAppModal = document.getElementById('installAppModal');
  const closeInstallAppModalBtn = document.getElementById('closeInstallAppModalBtn');
  const confirmInstallAppBtn = document.getElementById('confirmInstallAppBtn');
  const confirmInstallAppBtnText = document.getElementById('confirmInstallAppBtnText');
  const dismissInstallAppBtn = document.getElementById('dismissInstallAppBtn');
  const headerInstallAppBtn = document.getElementById('headerInstallAppBtn');
  const manualInstallGuide = document.getElementById('manualInstallGuide');
  const manualInstallGuideTitle = document.getElementById('manualInstallGuideTitle');
  const manualInstallGuideSteps = document.getElementById('manualInstallGuideSteps');

  function isRunningStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true ||
           document.referrer.includes('android-app://') ||
           window.location.search.includes('source=pwa');
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent.toLowerCase());
  }

  function isMobileDevice() {
    return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(navigator.userAgent.toLowerCase()) ||
           (window.innerWidth <= 768);
  }

  function showInstallAppModal() {
    if (isRunningStandalone()) return;
    if (installAppModal) {
      installAppModal.classList.remove('hidden');
      installAppModal.style.display = 'flex';
    }
    safeCreateIcons();
  }

  function hideInstallAppModal() {
    if (installAppModal) {
      installAppModal.classList.add('hidden');
      installAppModal.style.display = 'none';
    }
  }

  // Intercept Chrome & Android PWA Install Event
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    console.log('📲 PWA beforeinstallprompt captured');

    // Show Install App button in top dashboard header
    if (headerInstallAppBtn && !isRunningStandalone()) {
      headerInstallAppBtn.classList.remove('hidden');
    }

    // Automatically prompt mobile users to install the app on first visit
    const hasSeenPrompt = sessionStorage.getItem('pwa_install_prompt_seen');
    if (!isRunningStandalone() && isMobileDevice() && !hasSeenPrompt) {
      sessionStorage.setItem('pwa_install_prompt_seen', 'true');
      setTimeout(() => {
        showInstallAppModal();
      }, 1200);
    }
  });

  // When app finishes installation
  window.addEventListener('appinstalled', () => {
    console.log('🎉 Go-Notch app installed successfully to home screen!');
    deferredInstallPrompt = null;
    hideInstallAppModal();
    if (headerInstallAppBtn) headerInstallAppBtn.classList.add('hidden');
  });

  // Handle Install Button Click
  async function triggerAppInstallation() {
    if (deferredInstallPrompt) {
      try {
        if (confirmInstallAppBtnText) confirmInstallAppBtnText.textContent = 'Installing...';
        await deferredInstallPrompt.prompt();
        const choiceResult = await deferredInstallPrompt.userChoice;
        console.log('Install prompt result:', choiceResult.outcome);
        if (choiceResult.outcome === 'accepted') {
          hideInstallAppModal();
          if (headerInstallAppBtn) headerInstallAppBtn.classList.add('hidden');
          deferredInstallPrompt = null;
        }
      } catch (err) {
        console.warn('Install error:', err);
      } finally {
        if (confirmInstallAppBtnText) confirmInstallAppBtnText.textContent = 'Install Go-Notch App';
      }
    } else if (isIOS()) {
      // iOS Safari doesn't support programmatic beforeinstallprompt
      if (manualInstallGuide) manualInstallGuide.classList.remove('hidden');
      if (manualInstallGuideTitle) manualInstallGuideTitle.textContent = 'How to Install on iPhone Safari:';
      if (manualInstallGuideSteps) {
        manualInstallGuideSteps.innerHTML = `
          <li>Tap the <strong>Share</strong> button <span class="inline-block px-1 bg-white/40 dark:bg-black/30 rounded font-bold">⎋ / 📤</span> in Safari toolbar</li>
          <li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
          <li>Tap <strong>"Add"</strong> in the top-right corner to finish</li>
        `;
      }
      safeCreateIcons();
    } else {
      // Android / Chrome fallback
      if (manualInstallGuide) manualInstallGuide.classList.remove('hidden');
      if (manualInstallGuideTitle) manualInstallGuideTitle.textContent = 'How to Install in Chrome:';
      if (manualInstallGuideSteps) {
        manualInstallGuideSteps.innerHTML = `
          <li>Tap the <strong>⋮ (three dots menu)</strong> in top-right corner of Chrome</li>
          <li>Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong></li>
          <li>Confirm by tapping <strong>"Install"</strong></li>
        `;
      }
      safeCreateIcons();
    }
  }

  if (confirmInstallAppBtn) confirmInstallAppBtn.addEventListener('click', triggerAppInstallation);
  if (headerInstallAppBtn) headerInstallAppBtn.addEventListener('click', showInstallAppModal);
  if (closeInstallAppModalBtn) closeInstallAppModalBtn.addEventListener('click', hideInstallAppModal);
  if (dismissInstallAppBtn) dismissInstallAppBtn.addEventListener('click', hideInstallAppModal);

  // Auto-detect mobile browser on load if beforeinstallprompt didn't fire immediately (e.g. iOS or manual)
  setTimeout(() => {
    if (!isRunningStandalone()) {
      if (headerInstallAppBtn) headerInstallAppBtn.classList.remove('hidden');
      const hasSeenPrompt = sessionStorage.getItem('pwa_install_prompt_seen');
      if (isMobileDevice() && !hasSeenPrompt) {
        sessionStorage.setItem('pwa_install_prompt_seen', 'true');
        showInstallAppModal();
      }
    }
  }, 2000);

  if (exportThreadBtn) {
    exportThreadBtn.addEventListener('click', () => {
      if (activeChatJid) {
        window.location.href = `/api/export?format=csv&chat=${encodeURIComponent(activeChatJid)}`;
      }
    });
  }

  // =========================================================================
  // 🔔 CHROME DESKTOP NOTIFICATIONS, AUDIO CHIME & DOCUMENT PIP FLOATING CARD
  // =========================================================================

  let audioCtx = null;
  let soundAlertsEnabled = localStorage.getItem('sound_alerts_enabled') !== 'false';
  let desktopNotifEnabled = localStorage.getItem('desktop_notif_enabled') !== 'false';
  let titleFlashInterval = null;
  const originalTitle = document.title || 'WhatsApp Trip Monitor';

  // Ensure AudioContext is unlocked on first user interaction
  function unlockAudio() {
    try {
      if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) audioCtx = new AudioContextClass();
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    } catch (e) {}
  }
  document.addEventListener('click', unlockAudio, { passive: true });
  let alertSoundInterval = null;
  let alertSoundStopTimer = null;

  function stopAlertSoundLoop() {
    if (alertSoundInterval) {
      clearInterval(alertSoundInterval);
      alertSoundInterval = null;
    }
    if (alertSoundStopTimer) {
      clearTimeout(alertSoundStopTimer);
      alertSoundStopTimer = null;
    }
  }

  window.addEventListener('focus', () => {
    stopAlertSoundLoop();
    if (titleFlashInterval) {
      clearInterval(titleFlashInterval);
      titleFlashInterval = null;
      document.title = originalTitle;
    }
  });

  document.addEventListener('click', () => {
    unlockAudio();
    stopAlertSoundLoop();
  }, { passive: true });
  document.addEventListener('touchstart', () => {
    unlockAudio();
    stopAlertSoundLoop();
  }, { passive: true });
  document.addEventListener('keydown', () => {
    unlockAudio();
    stopAlertSoundLoop();
  }, { passive: true });

  // 1. Original 3-Tone Ascending Harmonic Chime (D5 -> F#5 -> A5)
  function playAlertChimeSingle() {
    if (!soundAlertsEnabled) return;
    try {
      unlockAudio();
      if (!audioCtx) return;

      const now = audioCtx.currentTime;

      // Note 1: 587.33 Hz (D5)
      const osc1 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.linearRampToValueAtTime(0.45, now + 0.04);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc1.connect(gain1);
      gain1.connect(audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 0.3);

      // Note 2: 739.99 Hz (F#5)
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(739.99, now + 0.1);
      gain2.gain.setValueAtTime(0.001, now + 0.1);
      gain2.gain.linearRampToValueAtTime(0.5, now + 0.14);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.start(now + 0.1);
      osc2.stop(now + 0.45);

      // Note 3: 880 Hz (A5 Harmonic Peak)
      const osc3 = audioCtx.createOscillator();
      const gain3 = audioCtx.createGain();
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(880, now + 0.22);
      gain3.gain.setValueAtTime(0.001, now + 0.22);
      gain3.gain.linearRampToValueAtTime(0.55, now + 0.26);
      gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
      osc3.connect(gain3);
      gain3.connect(audioCtx.destination);
      osc3.start(now + 0.22);
      osc3.stop(now + 0.75);
    } catch (e) {
      console.warn('Audio chime error:', e);
    }
  }

  // 2-Second Alert Ring (repeats for 2s until user attends)
  function playAlertChime(durationMs = 2000) {
    if (!soundAlertsEnabled) return;
    stopAlertSoundLoop();

    // Play immediately
    playAlertChimeSingle();

    // Repeat every 1.0s for 2 seconds
    alertSoundInterval = setInterval(() => {
      playAlertChimeSingle();
    }, 1000);

    // Auto-stop after exactly 2 seconds
    alertSoundStopTimer = setTimeout(() => {
      stopAlertSoundLoop();
    }, durationMs);
  }

  // 2. Desktop Notification UI, Status Badge & Dispatch
  function updateDesktopNotifUI() {
    const isSupported = typeof Notification !== 'undefined';
    const permission = isSupported ? Notification.permission : 'denied';

    const dot = document.getElementById('desktopNotifDot');
    const icon = document.getElementById('desktopNotifIcon');
    const profileBtn = document.getElementById('profileEnableNotifBtn');
    const profileBtnText = document.getElementById('profileEnableNotifBtnText');
    const statusBadge = document.getElementById('settingsNotifStatusBadge');
    const statusDot = document.getElementById('settingsNotifStatusDot');
    const statusText = document.getElementById('settingsNotifStatusText');
    const blockedNotice = document.getElementById('settingsNotifBlockedNotice');
    const guideDesc = document.getElementById('settingsNotifGuideDesc');
    const banner = document.getElementById('notifPromptBanner');

    // Header Bell Icon State
    if (permission === 'granted' && desktopNotifEnabled) {
      if (dot) dot.classList.remove('hidden');
      if (icon) {
        icon.classList.remove('text-slate-400');
        icon.classList.add('text-emerald-600', 'dark:text-emerald-400');
      }
    } else {
      if (dot) dot.classList.add('hidden');
      if (icon) {
        icon.classList.remove('text-emerald-600', 'dark:text-emerald-400');
        icon.classList.add('text-slate-400');
      }
    }

    // Settings Card Detailed Live Status
    if (statusBadge && statusText && statusDot) {
      if (!isSupported) {
        statusBadge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
        statusDot.className = 'w-2 h-2 rounded-full bg-slate-400';
        statusText.textContent = 'Not Supported';
        if (blockedNotice) blockedNotice.classList.add('hidden');
      } else if (permission === 'granted') {
        if (desktopNotifEnabled) {
          statusBadge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300';
          statusDot.className = 'w-2 h-2 rounded-full bg-emerald-500';
          statusText.textContent = '🟢 Allowed & Active';
        } else {
          statusBadge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
          statusDot.className = 'w-2 h-2 rounded-full bg-slate-400';
          statusText.textContent = '⚪ Paused (Muted)';
        }
        if (blockedNotice) blockedNotice.classList.add('hidden');
        if (guideDesc) guideDesc.textContent = 'Chrome desktop notifications are granted and active. You will receive real-time popup cards!';
        if (profileBtnText) profileBtnText.textContent = desktopNotifEnabled ? 'Pause Notifications' : 'Resume Notifications';
        if (profileBtn) profileBtn.className = desktopNotifEnabled ? 'px-3.5 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-bold transition shadow flex-shrink-0 active:scale-95 flex items-center gap-1.5' : 'px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow flex-shrink-0 active:scale-95 flex items-center gap-1.5';
        if (banner) banner.classList.add('hidden');
      } else if (permission === 'denied') {
        statusBadge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300';
        statusDot.className = 'w-2 h-2 rounded-full bg-rose-500';
        statusText.textContent = '🔴 Blocked in Chrome';
        if (blockedNotice) blockedNotice.classList.remove('hidden');
        if (guideDesc) guideDesc.textContent = 'Chrome has blocked notifications for this page. Please allow it in the URL bar padlock icon.';
        if (profileBtnText) profileBtnText.textContent = 'Blocked in Chrome';
        if (profileBtn) profileBtn.className = 'px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition shadow flex-shrink-0 active:scale-95 flex items-center gap-1.5';
        if (banner) banner.classList.add('hidden');
      } else { // 'default'
        statusBadge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300';
        statusDot.className = 'w-2 h-2 rounded-full bg-amber-500 animate-pulse';
        statusText.textContent = '🟡 Permission Needed';
        if (blockedNotice) blockedNotice.classList.add('hidden');
        if (guideDesc) guideDesc.textContent = 'Click "Allow in Chrome" to enable OS desktop cards and sound chimes on matches.';
        if (profileBtnText) profileBtnText.textContent = 'Allow in Chrome';
        if (profileBtn) profileBtn.className = 'px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow flex-shrink-0 active:scale-95 flex items-center gap-1.5 animate-bounce-subtle';
        
        if (banner && sessionStorage.getItem('notif_banner_dismissed') !== 'true') {
          banner.classList.remove('hidden');
        }
      }
    }
  }

  async function requestDesktopNotifPermission() {
    unlockAudio();
    if (typeof Notification === 'undefined') {
      alert('Desktop notifications are not supported in this browser.');
      return;
    }

    if (Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          desktopNotifEnabled = true;
          localStorage.setItem('desktop_notif_enabled', 'true');
          playAlertChime();
          showDesktopNotification({
            chat_name: 'WhatsApp Trip Monitor',
            sender_name: 'System',
            matched_keywords: ['Active'],
            content: 'Desktop Notifications are active! You will now receive sounds & popup cards when trips match.'
          });
        }
      } catch (e) {
        console.warn('requestPermission error:', e);
      }
    } else if (Notification.permission === 'granted') {
      desktopNotifEnabled = !desktopNotifEnabled;
      localStorage.setItem('desktop_notif_enabled', desktopNotifEnabled ? 'true' : 'false');
      if (desktopNotifEnabled) {
        playAlertChime();
      }
    } else if (Notification.permission === 'denied') {
      alert('Notifications are currently Blocked in Chrome for this site.\n\nTo allow:\n1. Click the Padlock / Site Settings icon (🔒) on the left of your Chrome URL address bar.\n2. Change "Notifications" to "Allow".\n3. Reload the page.');
    }
    updateDesktopNotifUI();
  }

  function showDesktopNotification(msg) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !desktopNotifEnabled) {
      return;
    }
    try {
      const kws = (msg.matched_keywords || []).join(', ');
      const title = kws ? `🎯 MATCH: ${kws}` : `💬 New WhatsApp Match`;
      const body = `${msg.chat_name || msg.sender_name || 'Group'}: ${(msg.content || msg.ai_transcript || '').slice(0, 140)}`;

      const notif = new Notification(title, {
        body: body,
        icon: '/manifest.json',
        tag: `match-${msg.message_id || Date.now()}`,
        renotify: true
      });

      notif.onclick = () => {
        stopAlertSoundLoop();
        window.focus();
        if (msg.chat_jid && msg.message_id) {
          switchTab('whatsapp');
          openChatAndScrollToMessage(msg.chat_jid, msg.message_id);
        } else {
          switchTab('matching');
        }
        notif.close();
      };
    } catch (err) {
      console.warn('Desktop notification dispatch error:', err);
    }
  }

  // 3. Document Picture-in-Picture Floating Window (Always-On-Top Overflow Card)
  let pipWindow = null;
  let currentPipMatch = null;
  let pipMatchesQueue = [];

  function updatePipButtonUI(isActive) {
    const pipOverlayBtn = document.getElementById('pipOverlayBtn');
    const pipMatchingBtn = document.getElementById('pipMatchingBtn');
    const profilePipBtn = document.getElementById('profilePipLaunchBtn');

    if (pipOverlayBtn) {
      if (isActive) {
        pipOverlayBtn.classList.add('bg-emerald-500', 'text-white');
        pipOverlayBtn.classList.remove('bg-emerald-50', 'text-emerald-600', 'dark:bg-emerald-950/40');
      } else {
        pipOverlayBtn.classList.remove('bg-emerald-500', 'text-white');
        pipOverlayBtn.classList.add('bg-emerald-50', 'text-emerald-600', 'dark:bg-emerald-950/40');
      }
    }

    if (pipMatchingBtn) {
      if (isActive) {
        pipMatchingBtn.classList.add('bg-emerald-600', 'text-white');
        pipMatchingBtn.classList.remove('bg-emerald-50', 'text-emerald-700');
      } else {
        pipMatchingBtn.classList.remove('bg-emerald-600', 'text-white');
        pipMatchingBtn.classList.add('bg-emerald-50', 'text-emerald-700');
      }
    }

    if (profilePipBtn) {
      profilePipBtn.innerHTML = isActive ? '<span>Active (Floating)</span>' : '<span>Launch</span>';
      profilePipBtn.className = isActive 
        ? 'px-3 py-1.5 bg-emerald-700 text-white rounded-lg text-xs font-bold transition shadow flex items-center gap-1'
        : 'px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition shadow flex items-center gap-1';
    }
  }

  async function togglePipFloatingCard() {
    if (!('documentPictureInPicture' in window)) {
      alert('Document Picture-in-Picture is supported on Google Chrome on Desktop.\n\nDesktop Notifications are active and will pop up automatically!');
      return;
    }

    if (pipWindow) {
      pipWindow.close();
      pipWindow = null;
      updatePipButtonUI(false);
      return;
    }

    try {
      pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 380,
        height: 480
      });

      updatePipButtonUI(true);

      const styleElem = pipWindow.document.createElement('style');
      styleElem.textContent = `
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        body { background: #0b141a; color: #e9edef; padding: 12px; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
        .header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); flex-shrink: 0; }
        .brand { font-size: 13px; font-weight: 700; color: #10b981; display: flex; align-items: center; gap: 6px; }
        .live-dot { width: 8px; height: 8px; background: #10b981; border-radius: 50%; box-shadow: 0 0 8px #10b981; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }
        .badge-count { font-size: 11px; background: rgba(16,185,129,0.2); color: #34d399; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
        .content-area { flex: 1; overflow-y: auto; display: flex; flex-direction: column; justify-content: center; padding: 8px 0; }
        .card { background: #111b21; border: 1px solid rgba(16,185,129,0.4); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); animation: slideIn 0.25s ease-out; }
        @keyframes slideIn { from{transform:translateY(10px);opacity:0;} to{transform:translateY(0);opacity:1;} }
        .card-header { display: flex; justify-content: space-between; align-items: baseline; }
        .chat-name { font-size: 13px; font-weight: 700; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
        .time { font-size: 10px; color: #8696a0; }
        .sender { font-size: 11px; color: #00a884; font-weight: 600; }
        .kws { display: flex; flex-wrap: wrap; gap: 4px; }
        .kw-tag { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 6px; }
        .msg-body { font-size: 12px; line-height: 1.4; color: #d1d7db; background: #202c33; padding: 8px 10px; border-radius: 8px; border-left: 3px solid #10b981; max-height: 180px; overflow-y: auto; word-break: break-word; }
        .actions { display: flex; gap: 8px; margin-top: 4px; }
        .btn { flex: 1; padding: 8px; font-size: 11px; font-weight: 700; border-radius: 8px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: opacity 0.15s; }
        .btn:hover { opacity: 0.9; }
        .btn-primary { background: #00a884; color: #ffffff; }
        .btn-secondary { background: #374248; color: #e9edef; }
        .standby-box { text-align: center; color: #8696a0; padding: 24px 12px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .standby-title { font-size: 13px; font-weight: 700; color: #e9edef; }
        .standby-desc { font-size: 11px; color: #8696a0; max-width: 240px; }
        .radar-wrapper { position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; margin-bottom: 4px; }
        .radar-circle { position: absolute; width: 100%; height: 100%; border-radius: 50%; border: 2px solid #10b981; opacity: 0.6; animation: radarPing 2s infinite cubic-bezier(0,0.2,0.8,1); }
        @keyframes radarPing { 0%{transform:scale(0.4);opacity:0.9;} 100%{transform:scale(1.4);opacity:0;} }
      `;
      pipWindow.document.head.appendChild(styleElem);

      renderPipWindow();

      pipWindow.addEventListener('pagehide', () => {
        pipWindow = null;
        updatePipButtonUI(false);
      });
    } catch (err) {
      console.error('Failed to open PiP window:', err);
    }
  }

  function renderPipWindow() {
    if (!pipWindow || pipWindow.closed) return;

    const doc = pipWindow.document;
    const match = currentPipMatch || (pipMatchesQueue.length > 0 ? pipMatchesQueue[0] : null);

    doc.body.innerHTML = `
      <div class="header">
        <div class="brand">
          <span class="live-dot"></span>
          <span>Trip Overflow Card</span>
        </div>
        <span class="badge-count">${pipMatchesQueue.length > 0 ? `${pipMatchesQueue.length} Alert${pipMatchesQueue.length > 1 ? 's' : ''}` : 'Live'}</span>
      </div>

      <div class="content-area">
        ${match ? `
          <div class="card">
            <div class="card-header">
              <span class="chat-name">${escapeHtml(match.chat_name || match.sender_name || 'WhatsApp Group')}</span>
              <span class="time">${new Date((match.timestamp || Date.now() / 1000) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>

            <span class="sender">👤 ${escapeHtml(match.sender_name || 'Contact')}</span>

            ${(match.matched_keywords && match.matched_keywords.length > 0) ? `
              <div class="kws">
                ${match.matched_keywords.map(kw => `<span class="kw-tag">🎯 ${escapeHtml(kw)}</span>`).join('')}
              </div>
            ` : ''}

            <div class="msg-body">${escapeHtml(match.content || match.ai_transcript || '[Trip message detected]')}</div>

            <div class="actions">
              <button id="pipOpenChatBtn" class="btn btn-primary">📱 Open Chat</button>
              <button id="pipCopyBtn" class="btn btn-secondary">📋 Copy</button>
              <button id="pipNextBtn" class="btn btn-secondary">${pipMatchesQueue.length > 1 ? '⏭️ Next' : '✕ Clear'}</button>
            </div>
          </div>
        ` : `
          <div class="standby-box">
            <div class="radar-wrapper">
              <span class="radar-circle"></span>
              <span style="font-size:24px;">📡</span>
            </div>
            <p class="standby-title">Live Overflow Radar Active</p>
            <p class="standby-desc">Whenever a new matched trip arrives, this floating card will update immediately!</p>
          </div>
        `}
      </div>
    `;

    const openBtn = doc.getElementById('pipOpenChatBtn');
    if (openBtn && match) {
      openBtn.addEventListener('click', () => {
        window.focus();
        if (match.chat_jid && match.message_id) {
          switchTab('whatsapp');
          openChatAndScrollToMessage(match.chat_jid, match.message_id);
        } else {
          switchTab('matching');
        }
      });
    }

    const copyBtn = doc.getElementById('pipCopyBtn');
    if (copyBtn && match) {
      copyBtn.addEventListener('click', () => {
        const text = `${match.chat_name || ''}\n${match.content || match.ai_transcript || ''}`;
        navigator.clipboard.writeText(text);
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1500);
      });
    }

    const nextBtn = doc.getElementById('pipNextBtn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (pipMatchesQueue.length > 0) {
          pipMatchesQueue.shift();
          currentPipMatch = pipMatchesQueue.length > 0 ? pipMatchesQueue[0] : null;
        } else {
          currentPipMatch = null;
        }
        renderPipWindow();
      });
    }
  }

  function triggerMatchAlert(msg) {
    if (!msg) return;

    // CRITICAL CHECK: Only trigger notification if current user has active include keywords!
    const incList = (activeKeywords && Array.isArray(activeKeywords.include)) ? activeKeywords.include : [];
    if (!incList || incList.length === 0) {
      // User has deleted all include keywords -> do NOT trigger sound, popup or notification
      return;
    }

    const excList = (activeKeywords && Array.isArray(activeKeywords.exclude)) ? activeKeywords.exclude : [];
    const fullText = `${msg.content || ''} ${msg.ai_transcript || ''} ${msg.ai_translation || ''} ${msg.chat_name || ''} ${msg.sender_name || ''}`.toLowerCase();

    // Check if message matches any exclude keywords
    const hasExclude = excList.some(kw => kw && fullText.includes(kw.toLowerCase().trim()));
    if (hasExclude) return;

    // Check if message matches any include keywords
    const matched = incList.filter(kw => kw && fullText.includes(kw.toLowerCase().trim()));
    if (matched.length === 0) return;

    msg.matched_keywords = matched;

    // 1. Play triple-tone harmonic attention sound
    playAlertChime();

    // 2. Queue for PiP floating card & render
    currentPipMatch = msg;
    pipMatchesQueue.unshift(msg);
    if (pipMatchesQueue.length > 20) pipMatchesQueue.pop();

    if (pipWindow && !pipWindow.closed) {
      renderPipWindow();
    }

    // 3. Dispatch Chrome Desktop OS Notification
    showDesktopNotification(msg);

    // 4. Tab Title Flashing Alert (if tab in background)
    if (document.hidden) {
      if (titleFlashInterval) clearInterval(titleFlashInterval);
      let flashState = false;
      const kw = matched[0] || 'TRIP MATCH';
      titleFlashInterval = setInterval(() => {
        document.title = flashState ? `🔔 (1) 🎯 MATCH: ${kw}!` : originalTitle;
        flashState = !flashState;
      }, 900);
    }
  }

  // Bind Buttons & Settings Toggles
  const pipOverlayBtn = document.getElementById('pipOverlayBtn');
  if (pipOverlayBtn) {
    pipOverlayBtn.addEventListener('click', togglePipFloatingCard);
  }

  const pipMatchingBtn = document.getElementById('pipMatchingBtn');
  if (pipMatchingBtn) {
    pipMatchingBtn.addEventListener('click', togglePipFloatingCard);
  }

  const profilePipLaunchBtn = document.getElementById('profilePipLaunchBtn');
  if (profilePipLaunchBtn) {
    profilePipLaunchBtn.addEventListener('click', togglePipFloatingCard);
  }

  const desktopNotifBtn = document.getElementById('desktopNotifBtn');
  if (desktopNotifBtn) {
    desktopNotifBtn.addEventListener('click', requestDesktopNotifPermission);
  }

  const profileEnableNotifBtn = document.getElementById('profileEnableNotifBtn');
  if (profileEnableNotifBtn) {
    profileEnableNotifBtn.addEventListener('click', requestDesktopNotifPermission);
  }

  // Test Sound Button in Settings
  const testSoundChimeBtn = document.getElementById('testSoundChimeBtn');
  if (testSoundChimeBtn) {
    testSoundChimeBtn.addEventListener('click', () => {
      unlockAudio();
      playAlertChime();
    });
  }

  // Test Full Match Alert Button in Settings & Matching Page
  const testFullAlertBtn = document.getElementById('testFullAlertBtn');
  const matchingTestAlertBtn = document.getElementById('matchingTestAlertBtn');

  const runTestAlertAction = async () => {
    unlockAudio();
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await requestDesktopNotifPermission();
    }
    triggerMatchAlert({
      message_id: `test_${Date.now()}`,
      chat_jid: 'test_chat@g.us',
      chat_name: '🚕 Real-time Cabs Duty Group',
      sender_name: 'Captain Alex (+91 93452 33351)',
      matched_keywords: ['Urgent', 'Sedan', 'Bangalore'],
      content: '🚨 IMMEDIATE: Bangalore Airport to Hosur. Swift Dzire AC required. Toll extra. Call 9345233351',
      timestamp: Math.floor(Date.now() / 1000)
    });
  };

  if (testFullAlertBtn) {
    testFullAlertBtn.addEventListener('click', runTestAlertAction);
  }
  if (matchingTestAlertBtn) {
    matchingTestAlertBtn.addEventListener('click', runTestAlertAction);
  }

  // Top Sticky Banner Listeners
  const bannerAllowNotifBtn = document.getElementById('bannerAllowNotifBtn');
  if (bannerAllowNotifBtn) {
    bannerAllowNotifBtn.addEventListener('click', async () => {
      await requestDesktopNotifPermission();
      const banner = document.getElementById('notifPromptBanner');
      if (banner) banner.classList.add('hidden');
    });
  }

  const bannerDismissNotifBtn = document.getElementById('bannerDismissNotifBtn');
  if (bannerDismissNotifBtn) {
    bannerDismissNotifBtn.addEventListener('click', () => {
      sessionStorage.setItem('notif_banner_dismissed', 'true');
      const banner = document.getElementById('notifPromptBanner');
      if (banner) banner.classList.add('hidden');
    });
  }

  const profileSoundToggle = document.getElementById('profileSoundToggle');
  if (profileSoundToggle) {
    profileSoundToggle.checked = soundAlertsEnabled;
    profileSoundToggle.addEventListener('change', (e) => {
      soundAlertsEnabled = e.target.checked;
      localStorage.setItem('sound_alerts_enabled', soundAlertsEnabled ? 'true' : 'false');
      if (soundAlertsEnabled) {
        unlockAudio();
        playAlertChime();
      }
    });
  }

  updateDesktopNotifUI();

  // =========================================================================
  // RAZORPAY SUBSCRIPTION & ACCESS PAYWALL ENGINE (₹49/month Plan)
  // =========================================================================
  let userSubscription = null;
  let razorpayKeyId = 'rzp_live_Tbvz9tjiGE4r0y';

  const paywallModal = document.getElementById('paywallModal');
  const paywallPayWithRazorpayBtn = document.getElementById('paywallPayWithRazorpayBtn');
  const closePaywallModalBtn = document.getElementById('closePaywallModalBtn');

  if (closePaywallModalBtn) {
    closePaywallModalBtn.addEventListener('click', () => {
      if (paywallModal) paywallModal.classList.add('hidden');
    });
  }

  const dashboardPlanBadge = document.getElementById('dashboardPlanBadge');
  const dashboardPlanBadgeText = document.getElementById('dashboardPlanBadgeText');
  const dashboardDaysBadge = document.getElementById('dashboardDaysBadge');
  const dashboardDaysRemaining = document.getElementById('dashboardDaysRemaining');
  const dashboardPlanTitle = document.getElementById('dashboardPlanTitle');
  const dashboardPlanValidityText = document.getElementById('dashboardPlanValidityText');
  const dashboardExpiryDate = document.getElementById('dashboardExpiryDate');
  const dashboardProgressPercent = document.getElementById('dashboardProgressPercent');
  const dashboardProgressBar = document.getElementById('dashboardProgressBar');
  const dashboardPayNowBtn = document.getElementById('dashboardPayNowBtn');
  const dashboardPayBtnText = document.getElementById('dashboardPayBtnText');
  const dashboardActiveStatusPill = document.getElementById('dashboardActiveStatusPill');
  const planDetailsActiveStatusPill = document.getElementById('planDetailsActiveStatusPill');
  const dashboardTestBypassBtn = document.getElementById('dashboardTestBypassBtn');
  const dashboardRefreshBtn = document.getElementById('dashboardRefreshBtn');
  const dashboardStatWA = document.getElementById('dashboardStatWA');
  const dashboardStatWADesc = document.getElementById('dashboardStatWADesc');
  const dashboardStatKeywords = document.getElementById('dashboardStatKeywords');
  const dashboardStatMatches = document.getElementById('dashboardStatMatches');
  const dashboardPaymentsList = document.getElementById('dashboardPaymentsList');

  const dashboardGoWhatsAppBtn = document.getElementById('dashboardGoWhatsAppBtn');
  const dashboardGoMatchingBtn = document.getElementById('dashboardGoMatchingBtn');
  const dashboardGoKeywordsBtn = document.getElementById('dashboardGoKeywordsBtn');

  function enforceSubscriptionAccess() {
    renderDashboardSubscription();
  }

  async function fetchSubscriptionStatus() {
    if (!currentUser || !currentUser.phone) return null;
    try {
      const res = await apiFetch(`/api/subscription/status?phone=${encodeURIComponent(currentUser.phone)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.subscription) {
          userSubscription = data.subscription;
          if (data.key_id) razorpayKeyId = data.key_id;
          renderDashboardSubscription();
          renderDashboardPayments();
          enforceSubscriptionAccess();
          return userSubscription;
        }
      }
    } catch (err) {
      console.warn('Subscription fetch error:', err);
    }
    return null;
  }

  function renderDashboardSubscription() {
    const isSub = userSubscription && userSubscription.is_subscribed;
    const daysLeft = isSub ? (userSubscription.days_left || 0) : 0;
    const expiresAt = (userSubscription && userSubscription.expires_at) ? userSubscription.expires_at : 0;

    const userSubtitle = document.getElementById('dashboardUserSubtitle');
    if (userSubtitle && currentUser) {
      userSubtitle.textContent = `Connected as ${currentUser.name || 'User'} (+91 ${currentUser.phone ? currentUser.phone.slice(-10) : ''})`;
    }

    if (dashboardPlanBadge) {
      if (isSub) {
        dashboardPlanBadge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold tracking-wide uppercase bg-blue-600 text-white shadow-md shadow-blue-600/30';
        if (dashboardPlanBadgeText) dashboardPlanBadgeText.textContent = 'PRO MEMBER ACTIVE';
      } else {
        dashboardPlanBadge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold tracking-wide uppercase bg-slate-700 text-slate-300 shadow-md';
        if (dashboardPlanBadgeText) dashboardPlanBadgeText.textContent = 'INACTIVE / EXPIRED';
      }
    }

    if (dashboardDaysRemaining) {
      dashboardDaysRemaining.textContent = daysLeft;
    }

    if (dashboardExpiryDate) {
      if (expiresAt > 0) {
        const d = new Date(expiresAt * 1000);
        dashboardExpiryDate.textContent = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      } else {
        dashboardExpiryDate.textContent = 'No Active Plan (₹2/mo)';
      }
    }

    if (dashboardProgressBar) {
      const pct = isSub ? Math.min(100, Math.max(5, Math.round((daysLeft / 30) * 100))) : 0;
      dashboardProgressBar.style.width = `${pct}%`;
      if (dashboardProgressPercent) {
        dashboardProgressPercent.textContent = isSub ? `${daysLeft} Days Remaining (${pct}%)` : 'Subscription Required';
      }
    }

    // Show Renew CTA button ONLY if not subscribed OR expiring within <= 3 days
    if (dashboardPayNowBtn) {
      if (isSub && daysLeft > 3) {
        dashboardPayNowBtn.classList.add('hidden');
        if (dashboardActiveStatusPill) dashboardActiveStatusPill.classList.remove('hidden');
      } else {
        dashboardPayNowBtn.classList.remove('hidden');
        if (dashboardActiveStatusPill) dashboardActiveStatusPill.classList.add('hidden');
        if (dashboardPayBtnText) {
          if (!isSub) {
            dashboardPayBtnText.textContent = 'Subscribe Monthly Plan (₹2)';
          } else {
            dashboardPayBtnText.textContent = `Renew Expiring Plan (${daysLeft}d left - ₹2)`;
          }
        }
      }
    }

    // Update Stats Hub
    if (dashboardStatKeywords) {
      const count = (activeKeywords.include.length + activeKeywords.exclude.length) || 0;
      dashboardStatKeywords.textContent = count;
    }
    if (dashboardStatMatches) {
      dashboardStatMatches.textContent = cachedAlertsData.length || 0;
    }
    if (dashboardStatWA) {
      dashboardStatWA.textContent = isConnected ? 'Connected' : 'Disconnected';
      if (dashboardStatWADesc) {
        dashboardStatWADesc.innerHTML = isConnected
          ? `<span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span> ${waAccountName || 'Live Monitoring'}`
          : `<span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span> Link Device`;
      }
    }

    safeCreateIcons();
  }

  function renderPlanDetailsPage() {
    const isSub = userSubscription && userSubscription.is_subscribed;
    const daysLeft = isSub ? (userSubscription.days_left || 0) : 0;
    const startedAt = (userSubscription && userSubscription.started_at) ? userSubscription.started_at : 0;
    const expiresAt = (userSubscription && userSubscription.expires_at) ? userSubscription.expires_at : 0;

    if (planDetailsStatusBadge) {
      if (isSub) {
        planDetailsStatusBadge.className = 'inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold tracking-wide uppercase bg-blue-600 text-white shadow-md shadow-blue-600/30';
        if (planDetailsStatusBadgeText) planDetailsStatusBadgeText.textContent = 'PRO MEMBER ACTIVE';
      } else {
        planDetailsStatusBadge.className = 'inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold tracking-wide uppercase bg-slate-700 text-slate-300 shadow-md';
        if (planDetailsStatusBadgeText) planDetailsStatusBadgeText.textContent = 'INACTIVE / EXPIRED';
      }
    }

    if (planDetailsDaysRemaining) {
      planDetailsDaysRemaining.textContent = daysLeft;
    }

    if (planDetailsStartedAt) {
      if (startedAt > 0) {
        const d = new Date(startedAt * 1000);
        planDetailsStartedAt.textContent = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      } else {
        planDetailsStartedAt.textContent = isSub ? 'Current Period' : '-';
      }
    }

    if (planDetailsExpiresAt) {
      if (expiresAt > 0) {
        const d = new Date(expiresAt * 1000);
        planDetailsExpiresAt.textContent = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      } else {
        planDetailsExpiresAt.textContent = isSub ? 'Active' : 'Expired / Inactive';
      }
    }

    if (planDetailsStatusText) {
      planDetailsStatusText.textContent = isSub ? 'Active Pro' : 'Inactive';
      planDetailsStatusText.className = isSub ? 'text-xs font-semibold text-blue-400' : 'text-xs font-semibold text-slate-400';
    }

    if (planDetailsPaymentId) {
      planDetailsPaymentId.textContent = (userSubscription && userSubscription.payment_id) ? userSubscription.payment_id : (isSub ? 'Manual / Direct' : '-');
    }

    if (planDetailsOrderId) {
      planDetailsOrderId.textContent = (userSubscription && userSubscription.order_id) ? userSubscription.order_id : '-';
    }

    if (planDetailsPhone) {
      planDetailsPhone.textContent = currentUser && currentUser.phone ? `+91 ${currentUser.phone.slice(-10)}` : '-';
    }

    if (planDetailsProgressBar) {
      const pct = isSub ? Math.min(100, Math.max(5, Math.round((daysLeft / 30) * 100))) : 0;
      planDetailsProgressBar.style.width = `${pct}%`;
      if (planDetailsProgressPercent) {
        planDetailsProgressPercent.textContent = isSub ? `${daysLeft} Days Remaining (${pct}%)` : 'Subscription Inactive';
      }
    }

    // Show Renew button ONLY if not subscribed OR expiring within <= 3 days
    if (planDetailsRenewBtn) {
      if (isSub && daysLeft > 3) {
        planDetailsRenewBtn.classList.add('hidden');
        if (planDetailsActiveStatusPill) planDetailsActiveStatusPill.classList.remove('hidden');
      } else {
        planDetailsRenewBtn.classList.remove('hidden');
        if (planDetailsActiveStatusPill) planDetailsActiveStatusPill.classList.add('hidden');
        if (planDetailsRenewBtnText) {
          if (!isSub) {
            planDetailsRenewBtnText.textContent = 'Subscribe Monthly Plan (₹2)';
          } else {
            planDetailsRenewBtnText.textContent = `Renew Expiring Plan (${daysLeft}d left - ₹2)`;
          }
        }
      }
    }

    renderPlanDetailsPayments();
    safeCreateIcons();
  }

  async function renderPlanDetailsPayments() {
    if (!planDetailsPaymentsList || !currentUser || !currentUser.phone) return;
    try {
      const res = await apiFetch(`/api/subscription/payments?phone=${encodeURIComponent(currentUser.phone)}`);
      if (res.ok) {
        const data = await res.json();
        const payments = data.payments || [];
        
        if (planDetailsPaymentsBadgeCount) {
          planDetailsPaymentsBadgeCount.textContent = `${payments.length} Records`;
        }

        if (payments.length === 0) {
          planDetailsPaymentsList.innerHTML = `
            <div class="text-center py-10 text-slate-400 text-xs space-y-2">
              <i data-lucide="receipt" class="w-8 h-8 mx-auto opacity-40 text-slate-400"></i>
              <p class="font-medium text-slate-600 dark:text-slate-300">No Payment History Yet</p>
              <p class="text-[11px] text-slate-400">Complete your first ₹2 monthly subscription via Razorpay to view your invoices here.</p>
            </div>
          `;
        } else {
          planDetailsPaymentsList.innerHTML = payments.map(p => {
            const dateStr = new Date(p.created_at * 1000).toLocaleDateString('en-IN', {
              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            const amtInRupees = (p.amount / 100).toFixed(0);
            const isSuccess = p.status === 'captured';
            return `
              <div class="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 text-xs gap-3 shadow-xs hover:border-blue-500/40 transition">
                <div class="space-y-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-slate-900 dark:text-white text-sm">Monthly Pro Subscription</span>
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${isSuccess ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-amber-100 text-amber-800'}">${p.status.toUpperCase()}</span>
                  </div>
                  <p class="text-[11px] text-slate-500 dark:text-slate-400 font-mono flex items-center gap-1.5 flex-wrap">
                    <span>Payment ID: ${p.payment_id || '-'}</span>
                    <span>•</span>
                    <span>${dateStr}</span>
                    <span>•</span>
                    <span class="capitalize">${p.method || 'UPI/Card'}</span>
                  </p>
                </div>
                <div class="flex items-center justify-between sm:justify-end gap-3 flex-shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-700/50">
                  <span class="font-mono font-bold text-base text-blue-600 dark:text-blue-400">₹${amtInRupees}</span>
                  <span class="text-[10px] font-medium px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">Paid</span>
                </div>
              </div>
            `;
          }).join('');
        }
        safeCreateIcons();
      }
    } catch (e) {
      console.warn('renderPlanDetailsPayments error:', e);
    }
  }

  async function renderDashboardPayments() {
    if (!dashboardPaymentsList || !currentUser || !currentUser.phone) return;
    try {
      const res = await apiFetch(`/api/subscription/payments?phone=${encodeURIComponent(currentUser.phone)}`);
      if (res.ok) {
        const data = await res.json();
        const payments = data.payments || [];
        if (payments.length === 0) {
          dashboardPaymentsList.innerHTML = `
            <div class="text-center py-5 text-slate-400 text-xs">
              <i data-lucide="receipt" class="w-5 h-5 mx-auto mb-1 opacity-40"></i>
              No payments found yet. Subscribe to activate full access.
            </div>
          `;
        } else {
          dashboardPaymentsList.innerHTML = payments.map(p => {
            const dateStr = new Date(p.created_at * 1000).toLocaleDateString('en-IN', {
              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            const amtInRupees = (p.amount / 100).toFixed(0);
            const isSuccess = p.status === 'captured';
            return `
              <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 text-xs">
                <div class="space-y-0.5 min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class="font-bold text-slate-800 dark:text-white">Pro Monthly Pass</span>
                    <span class="px-2 py-0.2 rounded-full text-[10px] font-bold ${isSuccess ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-amber-100 text-amber-800'}">${p.status.toUpperCase()}</span>
                  </div>
                  <p class="text-[10px] text-slate-400 font-mono">${p.payment_id || p.order_id} • ${dateStr}</p>
                </div>
                <span class="font-mono font-bold text-sm text-blue-600 dark:text-blue-400 flex-shrink-0">₹${amtInRupees}</span>
              </div>
            `;
          }).join('');
        }
        safeCreateIcons();
      }
    } catch (e) {
      console.warn('renderDashboardPayments error:', e);
    }
  }

  async function launchRazorpayCheckout(amount = 2, planName = 'Monthly Pro') {
    if (!currentUser || !currentUser.phone) {
      showAuthStep('phone');
      return;
    }

    const payBtn = dashboardPayNowBtn || paywallPayWithRazorpayBtn;
    const origHtml = payBtn ? payBtn.innerHTML : '';
    if (payBtn) {
      payBtn.disabled = true;
      payBtn.innerHTML = `<div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>Initializing Razorpay...</span>`;
    }

    try {
      const res = await apiFetch('/api/subscription/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: currentUser.phone, planName, amount })
      });
      const data = await res.json();
      if (!data.success || !data.order) {
        throw new Error(data.error || 'Failed to initialize payment order');
      }

      const key = data.key_id || razorpayKeyId;

      if (typeof Razorpay === 'undefined') {
        alert('Razorpay Checkout SDK is still loading. Please check your internet connection and try again.');
        return;
      }

      const options = {
        key: key,
        amount: data.order.amount,
        currency: data.order.currency || 'INR',
        name: 'Go-Notch Trip Monitor',
        description: '30-Day Pro Subscription - ₹2/mo',
        image: '/manifest.json',
        order_id: data.order.id,
        prefill: {
          name: currentUser.name || 'Pro User',
          contact: currentUser.phone ? `+91${currentUser.phone.slice(-10)}` : ''
        },
        theme: {
          color: '#2563eb'
        },
        modal: {
          ondismiss: function() {
            console.log('Razorpay modal closed');
          }
        },
        handler: async function (response) {
          try {
            const verifyRes = await apiFetch('/api/subscription/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phone: currentUser.phone,
                razorpay_order_id: response.razorpay_order_id || data.order.id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature
              })
            });
            const verifyData = await verifyRes.json();
            if (verifyData.success) {
              userSubscription = verifyData.subscription;
              enforceSubscriptionAccess();
              renderDashboardSubscription();
              renderDashboardPayments();
              renderPlanDetailsPage();
              alert('🎉 Payment Successful! Your 30-Day Pro Subscription is active.');
            } else {
              alert(`Payment verification error: ${verifyData.error}`);
            }
          } catch (e) {
            console.error('Payment verify error:', e);
            alert('Payment received. Verifying subscription status...');
            await fetchSubscriptionStatus();
          }
        }
      };

      const rzpInstance = new Razorpay(options);
      rzpInstance.on('payment.failed', function (response) {
        alert(`Payment failed: ${response.error?.description || 'Transaction was not completed'}`);
      });
      rzpInstance.open();

    } catch (err) {
      console.error('Razorpay checkout error:', err);
      alert(err.message || 'Could not open Razorpay checkout. Please verify Razorpay API Keys in server config.');
    } finally {
      if (payBtn) {
        payBtn.disabled = false;
        payBtn.innerHTML = origHtml;
        safeCreateIcons();
      }
    }
  }

  // Dashboard & Plan Details Event Listeners
  const dashboardSubCard = document.getElementById('dashboardSubCard');
  if (dashboardSubCard) {
    dashboardSubCard.addEventListener('click', (e) => {
      if (e.target.closest('#dashboardPayNowBtn')) return;
      switchTab('plan_details');
    });
  }

  if (planDetailsBackBtn) {
    planDetailsBackBtn.addEventListener('click', () => {
      switchTab('dashboard');
    });
  }

  if (planDetailsRefreshBtn) {
    planDetailsRefreshBtn.addEventListener('click', async () => {
      await fetchSubscriptionStatus();
      renderPlanDetailsPage();
    });
  }

  if (planDetailsRenewBtn) {
    planDetailsRenewBtn.addEventListener('click', () => {
      launchRazorpayCheckout(2);
    });
  }

  if (copyPaymentIdBtn) {
    copyPaymentIdBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (planDetailsPaymentId && planDetailsPaymentId.textContent && planDetailsPaymentId.textContent !== '-') {
        navigator.clipboard.writeText(planDetailsPaymentId.textContent.trim());
        copyPaymentIdBtn.innerHTML = `<i data-lucide="check" class="w-3 h-3 text-blue-400"></i>`;
        safeCreateIcons();
        setTimeout(() => {
          copyPaymentIdBtn.innerHTML = `<i data-lucide="copy" class="w-3 h-3"></i>`;
          safeCreateIcons();
        }, 1500);
      }
    });
  }

  if (copyOrderIdBtn) {
    copyOrderIdBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (planDetailsOrderId && planDetailsOrderId.textContent && planDetailsOrderId.textContent !== '-') {
        navigator.clipboard.writeText(planDetailsOrderId.textContent.trim());
        copyOrderIdBtn.innerHTML = `<i data-lucide="check" class="w-3 h-3 text-blue-400"></i>`;
        safeCreateIcons();
        setTimeout(() => {
          copyOrderIdBtn.innerHTML = `<i data-lucide="copy" class="w-3 h-3"></i>`;
          safeCreateIcons();
        }, 1500);
      }
    });
  }

  if (dashboardPayNowBtn) {
    dashboardPayNowBtn.addEventListener('click', () => launchRazorpayCheckout(2));
  }
  if (dashboardRefreshBtn) {
    dashboardRefreshBtn.addEventListener('click', () => {
      fetchSubscriptionStatus();
      loadStats();
    });
  }
  if (dashboardGoWhatsAppBtn) {
    dashboardGoWhatsAppBtn.addEventListener('click', () => switchTab('whatsapp'));
  }
  if (dashboardGoMatchingBtn) {
    dashboardGoMatchingBtn.addEventListener('click', () => switchTab('matching'));
  }
  if (dashboardGoKeywordsBtn) {
    dashboardGoKeywordsBtn.addEventListener('click', () => switchTab('keywords'));
  }
  if (dashboardStatWA) {
    const parentCard = dashboardStatWA.closest('.p-4');
    if (parentCard) {
      parentCard.classList.add('cursor-pointer', 'hover:border-blue-500/50', 'transition');
      parentCard.addEventListener('click', () => {
        showQrModal();
      });
    }
  }
  if (paywallPayWithRazorpayBtn) {
    paywallPayWithRazorpayBtn.addEventListener('click', () => launchRazorpayCheckout(2));
  }

  // Initial Auth & Data Load
  async function initAppSession() {
    currentUser = getStoredUser();

    // If not in local storage/cookie, check server for active session (unless user explicitly logged out)
    const explicitlyLoggedOut = localStorage.getItem('user_logged_out') === 'true';
    if (!currentUser && !explicitlyLoggedOut) {
      try {
        const sessRes = await apiFetch('/api/auth/active-session');
        if (sessRes.ok) {
          const sessData = await sessRes.json();
          if (sessData && sessData.user && sessData.user.phone) {
            currentUser = sessData.user;
            setStoredUser(currentUser, sessData.token);
          }
        }
      } catch (e) {
        console.warn('Session auto-restore error:', e.message);
      }
    }

    if (!currentUser || !currentUser.phone) {
      showAuthStep('phone');
      return;
    }

    // Instantly hide auth modal and show dashboard with cached user state
    hideAuthModal();
    renderUserProfile(currentUser);
    if (socket && currentUser && currentUser.phone) {
      socket.emit('register_user', currentUser.phone);
    }
    fetchSubscriptionStatus().catch(() => {});

    // Restore last active tab so user doesn't lose their place when closing/reopening window
    const savedTab = localStorage.getItem('active_tab') || 'dashboard';
    switchTab(savedTab);

    loadStats();
    loadThreads();
    loadKeywords();
    loadKeywordAlerts();
    updateDesktopNotifUI();

    // Background validation & profile sync with server
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.user) {
          currentUser = data.user;
          setStoredUser(currentUser);
        }
      } else if (res.status === 403) {
        // User explicitly deactivated by admin
        const data = await res.json().catch(() => ({}));
        if (data.isDeactivated) {
          clearStoredUser();
          showAuthStep('phone');
          alert('⚠️ Account Deactivated\n\n' + (data.error || 'Your account has been deactivated by administrator. Please contact admin.'));
        }
      }
    } catch (e) {
      console.warn('Profile sync warning (offline/cached):', e.message);
    }
  }

  initAppSession();
});
