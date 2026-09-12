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

  function apiFetch(urlPath, options) {
    let targetUrl = urlPath;
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
      if (!urlPath.startsWith('http://') && !urlPath.startsWith('https://')) {
        targetUrl = `${serverUrl}${urlPath.startsWith('/') ? '' : '/'}${urlPath}`;
      }
    }
    return fetch(targetUrl, options);
  }

  // State
  let activeChatJid = null;
  let activeChatName = '';
  let threadsData = [];
  let currentFilter = 'all';
  let isConnected = false;
  let waAccountName = '';
  let waAccountPhone = '';

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

  function showQrModal() {
    if (qrModal) qrModal.classList.remove('hidden');
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
      socket = io(serverUrl, { autoConnect: true, reconnection: true, timeout: 8000 });

      socket.on('connect', () => {
        if (qrServerStatus) {
          qrServerStatus.textContent = 'Server Online';
          qrServerStatus.className = 'font-bold text-emerald-500';
        }
        loadStats();
        loadThreads();
      });

      socket.on('connect_error', () => {
        if (qrServerStatus) {
          qrServerStatus.textContent = 'Server Unreachable';
          qrServerStatus.className = 'font-bold text-rose-500';
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
      });

      socket.on('contacts_updated', () => loadThreads());
      socket.on('chats_updated', () => loadThreads());
    }
  }

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

  // DOM Elements - 4 Main Page Views
  const pageViewWhatsApp = document.getElementById('pageViewWhatsApp');
  const pageViewMatching = document.getElementById('pageViewMatching');
  const pageViewKeywords = document.getElementById('pageViewKeywords');
  const pageViewProfile = document.getElementById('pageViewProfile');

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
        matchingTabBtn.className = 'filter-chip active px-3.5 py-1.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400 flex-shrink-0 transition flex items-center gap-1.5';
        savedTabBtn.className = 'filter-chip px-3.5 py-1.5 rounded-full text-xs font-medium bg-[#f0f2f5] dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition flex items-center gap-1.5';
      } else {
        savedTabBtn.className = 'filter-chip active px-3.5 py-1.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400 flex-shrink-0 transition flex items-center gap-1.5';
        matchingTabBtn.className = 'filter-chip px-3.5 py-1.5 rounded-full text-xs font-medium bg-[#f0f2f5] dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 flex-shrink-0 transition flex items-center gap-1.5';
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
        await apiFetch('/api/keywords/alerts', { method: 'DELETE' });
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


  // DOM Elements - Profile Page Specific
  const pageProfileName = document.getElementById('pageProfileName');
  const pageProfileWAName = document.getElementById('pageProfileWAName');
  const pageProfileWAPhone = document.getElementById('pageProfileWAPhone');
  const pageProfileWAStatus = document.getElementById('pageProfileWAStatus');
  const pageProfileTotalMsgs = document.getElementById('pageProfileTotalMsgs');
  const pageProfileTotalAlerts = document.getElementById('pageProfileTotalAlerts');
  const pageProfileSavedCount = document.getElementById('pageProfileSavedCount');
  const pageProfileScanQRBtn = document.getElementById('pageProfileScanQRBtn');
  const pageProfileLogoutBtn = document.getElementById('pageProfileLogoutBtn');
  const pageProfileThemeBtn = document.getElementById('pageProfileThemeBtn');


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
    bottomNavBtns.forEach(btn => {
      const tab = btn.getAttribute('data-tab');
      if (tab === tabName) {
        btn.className = 'bottom-nav-btn active-tab flex flex-col items-center justify-center flex-1 py-1.5 text-xs font-bold transition text-emerald-600 dark:text-emerald-400';
      } else {
        btn.className = 'bottom-nav-btn relative flex flex-col items-center justify-center flex-1 py-1.5 text-xs font-medium transition text-slate-500 dark:text-slate-400 hover:text-emerald-600';
      }
    });

    [pageViewWhatsApp, pageViewMatching, pageViewKeywords, pageViewProfile].forEach(page => {
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

    if (tabName === 'whatsapp') {
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
    // Header name
    if (pageProfileName) pageProfileName.textContent = waAccountName || 'WhatsApp Monitor';

    // WA connection status badge
    if (pageProfileWAStatus) {
      if (isConnected) {
        pageProfileWAStatus.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span> Connected`;
        pageProfileWAStatus.className = 'flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex-shrink-0';
      } else {
        pageProfileWAStatus.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span> Scan QR`;
        pageProfileWAStatus.className = 'flex items-center gap-1.5 text-[11px] font-bold text-amber-500 flex-shrink-0';
      }
    }
  }

  // WA card opens QR modal
  const profileWACardBtn = document.getElementById('profileWACardBtn');
  if (profileWACardBtn) {
    profileWACardBtn.addEventListener('click', () => {
      if (qrModal) qrModal.classList.remove('hidden');
    });
  }



  if (pageProfileLogoutBtn) {
    pageProfileLogoutBtn.addEventListener('click', async () => {
      if (confirm('Disconnect WhatsApp and remove local session?')) {
        await triggerLogoutAndReset();
      }
    });
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
      const res = await apiFetch('/api/keywords');
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
        <button data-kw="${escapeHtml(kw)}" data-type="${type}" class="remove-kw-btn hover:text-rose-500 transition ml-0.5">
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
      const val = includeKeywordInput.value.trim();
      if (!val) return;
      await postKeyword(val, 'include');
      includeKeywordInput.value = '';
    });
  }

  if (addExcludeKeywordForm) {
    addExcludeKeywordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = excludeKeywordInput.value.trim();
      if (!val) return;
      await postKeyword(val, 'exclude');
      excludeKeywordInput.value = '';
    });
  }

  // Keywords Page Form Submit Handlers
  if (pageAddIncludeKeywordForm) {
    pageAddIncludeKeywordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = pageIncludeKeywordInput.value.trim();
      if (!val) return;
      await postKeyword(val, 'include');
      pageIncludeKeywordInput.value = '';
    });
  }

  if (pageAddExcludeKeywordForm) {
    pageAddExcludeKeywordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = pageExcludeKeywordInput.value.trim();
      if (!val) return;
      await postKeyword(val, 'exclude');
      pageExcludeKeywordInput.value = '';
    });
  }

  // Modal Form Submit Handlers
  if (modalAddIncludeKeywordForm) {
    modalAddIncludeKeywordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = modalIncludeKeywordInput ? modalIncludeKeywordInput.value.trim() : '';
      if (!val) return;
      await postKeyword(val, 'include');
      if (modalIncludeKeywordInput) modalIncludeKeywordInput.value = '';
    });
  }

  if (modalAddExcludeKeywordForm) {
    modalAddExcludeKeywordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = modalExcludeKeywordInput ? modalExcludeKeywordInput.value.trim() : '';
      if (!val) return;
      await postKeyword(val, 'exclude');
      if (modalExcludeKeywordInput) modalExcludeKeywordInput.value = '';
    });
  }

  async function postKeyword(keyword, type) {
    try {
      const res = await apiFetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, type })
      });
      const data = await res.json();
      if (data.keywords) {
        activeKeywords = data.keywords;
        renderKeywordTags();
        loadKeywordAlerts();
      }
    } catch (err) {
      console.error('Error adding keyword:', err);
    }
  }

  async function removeKeyword(kw, type) {
    try {
      const res = await apiFetch(`/api/keywords/${encodeURIComponent(kw)}?type=${encodeURIComponent(type)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.keywords) {
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
      await apiFetch('/api/keywords/scope', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope })
      });
      loadKeywordAlerts();
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

  async function loadKeywordAlerts() {
    try {
      const res = await apiFetch('/api/keywords/alerts');
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
      if (qrModal) qrModal.classList.add('hidden');
    });
  }

  // Only show QR modal if user explicitly triggers it or when a real QR is ready
  if (qrModal) {
    qrModal.classList.add('hidden');
  }

  // "Open App" button on connected banner — only works when connected
  if (qrContinueBtn) {
    qrContinueBtn.addEventListener('click', () => {
      if (qrModal) qrModal.classList.add('hidden');
    });
  }

  async function triggerLogoutAndReset() {
    try {
      // Open QR modal immediately so user sees the reconnect flow
      if (qrModal) qrModal.classList.remove('hidden');
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
    qrLogoutBtn.addEventListener('click', triggerLogoutAndReset);
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

    if (qrServerUrlInput && serverIp && serverIp !== 'localhost' && !qrServerUrlInput.value.includes(serverIp)) {
      qrServerUrlInput.placeholder = `http://${serverIp}:3000`;
    }

    if (status === 'connected' || user) {
      isConnected = true;
      if (statusText) statusText.textContent = 'Connected';
      if (statusBadge) statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span> Connected`;

      if (user) {
        waAccountName = user.name || '';
        waAccountPhone = user.phone || '';
        if (userName) userName.textContent = user.name || 'WhatsApp Monitor';
        if (connectedUserName) connectedUserName.textContent = `${user.name || 'WhatsApp Account'} (${user.phone || ''})`;
        const initial = (user.name || 'W').charAt(0).toUpperCase();
        if (userAvatar) userAvatar.textContent = initial;
        if (logoutBtn) logoutBtn.classList.remove('hidden');
        updateProfilePageData();
      }

      // Connected → close QR modal immediately
      if (qrModal) qrModal.classList.add('hidden');
      if (alreadyConnectedBanner) alreadyConnectedBanner.classList.add('hidden');
      if (qrContainer) qrContainer.classList.add('hidden');

      loadStats();
      loadThreads();
    } else if (qr) {
      isConnected = false;
      if (statusText) statusText.textContent = 'Scan QR Code';
      if (statusBadge) statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span> Scan QR Code`;

      if (qrModal) qrModal.classList.remove('hidden');
      if (alreadyConnectedBanner) alreadyConnectedBanner.classList.add('hidden');
      if (qrContainer) qrContainer.classList.remove('hidden');
      if (qrLoading) qrLoading.classList.add('hidden');
      if (qrFrame) qrFrame.classList.remove('hidden');
      if (qrImage) qrImage.src = qr;

      if (logoutBtn) logoutBtn.classList.add('hidden');
    } else if (status === 'connecting') {
      if (statusText) statusText.textContent = 'Connecting...';
      if (statusBadge) statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span> Connecting...`;

      // Do NOT block screen with QR modal while connecting in background if no QR exists
      if (qrModal) qrModal.classList.add('hidden');
    } else {
      if (statusText) statusText.textContent = 'Disconnected';
      if (statusBadge) statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-400"></span> Disconnected`;

      if (qrModal && !qr) qrModal.classList.add('hidden');
    }

    safeCreateIcons();
  }

  logoutBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to disconnect WhatsApp and remove local session data?')) {
      await triggerLogoutAndReset();
    }
  });

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
    navigator.serviceWorker.register('/sw.js').then(() => {
      console.log('Mobile App ServiceWorker registered successfully');
    }).catch(err => {
      console.warn('ServiceWorker registration error:', err);
    });
  }

  if (exportThreadBtn) {
    exportThreadBtn.addEventListener('click', () => {
      if (activeChatJid) {
        window.location.href = `/api/export?format=csv&chat=${encodeURIComponent(activeChatJid)}`;
      }
    });
  }

  // Initial Data Load
  loadStats();
  loadThreads();
  loadKeywords();
  loadKeywordAlerts();
});
