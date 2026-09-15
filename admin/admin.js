document.addEventListener('DOMContentLoaded', () => {
  function safeCreateIcons() {
    if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') {
      try { lucide.createIcons(); } catch (e) {}
    }
  }
  safeCreateIcons();

  // State
  let adminToken = localStorage.getItem('admin_token') || '';
  let usersData = [];
  let plansData = [];
  let currentUserFilter = 'all';

  // DOM Elements - Auth Screen
  const adminAuthScreen = document.getElementById('adminAuthScreen');
  const adminDashboardApp = document.getElementById('adminDashboardApp');
  const adminLoginForm = document.getElementById('adminLoginForm');
  const adminPasscodeInput = document.getElementById('adminPasscodeInput');
  const toggleAdminPasscodeBtn = document.getElementById('toggleAdminPasscodeBtn');
  const adminLoginError = document.getElementById('adminLoginError');
  const adminLoginErrorMsg = document.getElementById('adminLoginErrorMsg');
  const adminLoginBtn = document.getElementById('adminLoginBtn');
  const adminLogoutBtn = document.getElementById('adminLogoutBtn');
  const adminRefreshBtn = document.getElementById('adminRefreshBtn');

  // DOM Elements - Navigation Tabs
  const tabButtons = document.querySelectorAll('.admin-tab-btn');
  const tabContents = document.querySelectorAll('.admin-tab-content');
  const tabUsersCount = document.getElementById('tabUsersCount');
  const tabPlansCount = document.getElementById('tabPlansCount');

  // DOM Elements - Metrics
  const metricTotalUsers = document.getElementById('metricTotalUsers');
  const metricActiveUsers = document.getElementById('metricActiveUsers');
  const metricDeactivatedUsers = document.getElementById('metricDeactivatedUsers');
  const metricSubscribedUsers = document.getElementById('metricSubscribedUsers');
  const metricTotalRevenue = document.getElementById('metricTotalRevenue');
  const metricTotalMessages = document.getElementById('metricTotalMessages');
  const metricTotalKeywords = document.getElementById('metricTotalKeywords');

  // DOM Elements - Users Tab
  const userSearchInput = document.getElementById('userSearchInput');
  const userFilterButtons = document.querySelectorAll('.user-filter-btn');
  const usersTableBody = document.getElementById('usersTableBody');

  // DOM Elements - Plans Tab & Modal
  const plansContainer = document.getElementById('plansContainer');
  const editPlanModal = document.getElementById('editPlanModal');
  const editPlanForm = document.getElementById('editPlanForm');
  const editPlanKey = document.getElementById('editPlanKey');
  const editPlanName = document.getElementById('editPlanName');
  const editPlanAmount = document.getElementById('editPlanAmount');
  const editPlanDuration = document.getElementById('editPlanDuration');
  const editPlanDesc = document.getElementById('editPlanDesc');
  const closeEditPlanModalBtn = document.getElementById('closeEditPlanModalBtn');
  const cancelEditPlanBtn = document.getElementById('cancelEditPlanBtn');

  // DOM Elements - Payments Tab
  const paymentsTableBody = document.getElementById('paymentsTableBody');

  // --- API Helper ---
  async function adminFetch(endpoint, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (adminToken) {
      headers['Authorization'] = `Bearer ${adminToken}`;
    }
    const res = await fetch(endpoint, { ...options, headers });
    if (res.status === 401) {
      handleUnauthorized();
      throw new Error('Unauthorized session. Please login again.');
    }
    return res;
  }

  function handleUnauthorized() {
    localStorage.removeItem('admin_token');
    adminToken = '';
    if (adminAuthScreen) adminAuthScreen.classList.remove('hidden');
    if (adminDashboardApp) adminDashboardApp.classList.add('hidden');
  }

  // --- Toast Notification Helper ---
  function showToast(message, type = 'success') {
    const container = document.getElementById('adminToastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    const isSuccess = type === 'success';
    toast.className = `p-4 rounded-2xl border shadow-xl flex items-center gap-3 text-xs font-semibold pointer-events-auto transform transition duration-300 translate-y-2 opacity-0 ${
      isSuccess 
        ? 'bg-slate-900 border-emerald-500/40 text-emerald-300' 
        : 'bg-slate-900 border-rose-500/40 text-rose-300'
    }`;

    toast.innerHTML = `
      <i data-lucide="${isSuccess ? 'check-circle' : 'alert-circle'}" class="w-4 h-4 ${isSuccess ? 'text-emerald-400' : 'text-rose-400'}"></i>
      <span>${message}</span>
    `;

    container.appendChild(toast);
    safeCreateIcons();

    setTimeout(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);

    setTimeout(() => {
      toast.classList.add('translate-y-2', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // --- Auth Flow ---
  if (toggleAdminPasscodeBtn && adminPasscodeInput) {
    toggleAdminPasscodeBtn.addEventListener('click', () => {
      const isPwd = adminPasscodeInput.type === 'password';
      adminPasscodeInput.type = isPwd ? 'text' : 'password';
      toggleAdminPasscodeBtn.innerHTML = `<i data-lucide="${isPwd ? 'eye-off' : 'eye'}" class="w-4 h-4"></i>`;
      safeCreateIcons();
    });
  }

  if (adminLoginForm) {
    adminLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const passcode = adminPasscodeInput ? adminPasscodeInput.value.trim() : '';
      if (!passcode) return;

      if (adminLoginError) adminLoginError.classList.add('hidden');
      if (adminLoginBtn) {
        adminLoginBtn.disabled = true;
        adminLoginBtn.innerHTML = `<div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>Verifying...</span>`;
      }

      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Authentication failed');
        }

        adminToken = data.token;
        localStorage.setItem('admin_token', adminToken);
        adminAuthScreen.classList.add('hidden');
        adminDashboardApp.classList.remove('hidden');
        showToast('Welcome to Admin Control Center');
        loadAllData();
      } catch (err) {
        if (adminLoginError && adminLoginErrorMsg) {
          adminLoginErrorMsg.textContent = err.message || 'Invalid passcode';
          adminLoginError.classList.remove('hidden');
        }
      } finally {
        if (adminLoginBtn) {
          adminLoginBtn.disabled = false;
          adminLoginBtn.innerHTML = `<i data-lucide="lock" class="w-4 h-4"></i><span>Unlock Admin Panel</span>`;
          safeCreateIcons();
        }
      }
    });
  }

  if (adminLogoutBtn) {
    adminLogoutBtn.addEventListener('click', () => {
      if (confirm('Lock the Admin Dashboard?')) {
        handleUnauthorized();
        showToast('Admin session locked', 'info');
      }
    });
  }

  if (adminRefreshBtn) {
    adminRefreshBtn.addEventListener('click', () => {
      loadAllData();
      showToast('Data refreshed');
    });
  }

  // --- Tab Navigation ---
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      tabContents.forEach(tc => {
        if (tc.id === `tab-${targetTab}`) {
          tc.classList.remove('hidden');
        } else {
          tc.classList.add('hidden');
        }
      });
      safeCreateIcons();
    });
  });

  // --- Data Loading & Rendering ---
  async function loadAllData() {
    await Promise.all([
      loadMetrics(),
      loadUsers(),
      loadPlans(),
      loadPayments(),
      checkRazorpayHealth(false)
    ]);
  }

  async function loadMetrics() {
    try {
      const res = await adminFetch('/api/admin/metrics');
      if (res.ok) {
        const data = await res.json();
        const m = data.metrics || {};
        if (metricTotalUsers) metricTotalUsers.textContent = (m.totalUsers || 0).toLocaleString();
        if (metricActiveUsers) metricActiveUsers.textContent = (m.activeUsers || 0).toLocaleString();
        if (metricDeactivatedUsers) metricDeactivatedUsers.textContent = (m.deactivatedUsers || 0).toLocaleString();
        if (metricSubscribedUsers) metricSubscribedUsers.textContent = (m.subscribedUsers || 0).toLocaleString();
        if (metricTotalRevenue) metricTotalRevenue.textContent = `₹${(m.totalRevenue || 0).toLocaleString()}`;
        if (metricTotalMessages) metricTotalMessages.textContent = (m.totalMessages || 0).toLocaleString();
        if (metricTotalKeywords) metricTotalKeywords.textContent = (m.totalKeywords || 0).toLocaleString();
      }
    } catch (e) {
      console.error('loadMetrics error:', e);
    }
  }

  async function loadUsers() {
    try {
      const res = await adminFetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        usersData = data.users || [];
        if (tabUsersCount) tabUsersCount.textContent = usersData.length;
        renderUsersTable();
      }
    } catch (e) {
      console.error('loadUsers error:', e);
    }
  }

  function renderUsersTable() {
    if (!usersTableBody) return;
    const query = userSearchInput ? userSearchInput.value.trim().toLowerCase() : '';
    
    let filtered = [...usersData];

    if (query) {
      filtered = filtered.filter(u => 
        (u.name && u.name.toLowerCase().includes(query)) ||
        (u.phone && u.phone.includes(query))
      );
    }

    if (currentUserFilter === 'active') {
      filtered = filtered.filter(u => u.is_active === 1);
    } else if (currentUserFilter === 'deactivated') {
      filtered = filtered.filter(u => u.is_active === 0);
    } else if (currentUserFilter === 'subscribed') {
      filtered = filtered.filter(u => u.is_subscribed);
    }

    if (filtered.length === 0) {
      usersTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="py-12 text-center text-slate-500">
            <i data-lucide="user-x" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
            <p class="font-medium">No users found matching your filters.</p>
          </td>
        </tr>
      `;
      safeCreateIcons();
      return;
    }

    usersTableBody.innerHTML = filtered.map(u => {
      const isActive = u.is_active === 1;
      const isSub = Boolean(u.is_subscribed);
      const initial = (u.name || 'U').charAt(0).toUpperCase();
      const regDate = u.created_at ? new Date(u.created_at * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
      const cleanPhone = String(u.phone || '').slice(-10);

      return `
        <tr class="hover:bg-slate-800/40 transition">
          <!-- User Profile -->
          <td class="py-3.5 px-4">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full ${isActive ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'bg-slate-800 text-slate-500 border border-slate-700'} flex items-center justify-center font-bold text-xs">
                ${initial}
              </div>
              <div class="min-w-0">
                <div class="font-semibold text-white truncate max-w-[140px] sm:max-w-[200px]">${u.name || 'User'}</div>
                <div class="text-[10px] text-slate-400 flex items-center gap-1">
                  <span>${u.gender || 'Male'}</span>
                  <span>•</span>
                  <span>ID #${u.id}</span>
                </div>
              </div>
            </div>
          </td>

          <!-- Mobile Phone -->
          <td class="py-3.5 px-4 font-mono font-medium text-slate-300">
            +91 ${cleanPhone}
          </td>

          <!-- Account Status (Active / Deactivated) -->
          <td class="py-3.5 px-4">
            ${isActive 
              ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                   <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Active
                 </span>`
              : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                   <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span> Deactivated
                 </span>`
            }
          </td>

          <!-- Subscription Details -->
          <td class="py-3.5 px-4">
            ${isSub
              ? `<div class="space-y-0.5">
                   <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                     <i data-lucide="sparkles" class="w-3 h-3"></i> ${u.plan_name || 'Pro'}
                   </span>
                   <div class="text-[10px] text-slate-400">${u.days_left || 0}d left</div>
                 </div>`
              : `<span class="text-slate-500 text-[11px]">Free / Expired</span>`
            }
          </td>

          <!-- Keywords Count -->
          <td class="py-3.5 px-4">
            <span class="font-semibold text-slate-300">${u.keywords_count || 0}</span>
          </td>

          <!-- Registration Date -->
          <td class="py-3.5 px-4 text-slate-400 text-[11px]">
            ${regDate}
          </td>

          <!-- Actions: 1-Click Status Toggle -->
          <td class="py-3.5 px-4 text-right">
            ${isActive
              ? `<button onclick="window.adminToggleUser('${u.phone}', false)" title="Deactivate user account" class="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 hover:text-rose-300 rounded-xl text-xs font-semibold transition active:scale-95 cursor-pointer inline-flex items-center gap-1.5">
                   <i data-lucide="user-x" class="w-3.5 h-3.5"></i>
                   <span>Deactivate</span>
                 </button>`
              : `<button onclick="window.adminToggleUser('${u.phone}', true)" title="Reactivate user account" class="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 rounded-xl text-xs font-semibold transition active:scale-95 cursor-pointer inline-flex items-center gap-1.5">
                   <i data-lucide="user-check" class="w-3.5 h-3.5"></i>
                   <span>Activate</span>
                 </button>`
            }
          </td>
        </tr>
      `;
    }).join('');

    safeCreateIcons();
  }

  // Filter Buttons Handler
  userFilterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      userFilterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentUserFilter = btn.getAttribute('data-user-filter');
      renderUsersTable();
    });
  });

  if (userSearchInput) {
    userSearchInput.addEventListener('input', renderUsersTable);
  }

  // Global Toggle Function
  window.adminToggleUser = async (phone, shouldActivate) => {
    const actionText = shouldActivate ? 'activate' : 'deactivate';
    const confirmMsg = shouldActivate 
      ? `Activate account +91 ${phone.slice(-10)}? The user will be able to log in.`
      : `Deactivate account +91 ${phone.slice(-10)}? The user will be blocked from logging in until reactivated.`;

    if (!confirm(confirmMsg)) return;

    try {
      const res = await adminFetch('/api/admin/users/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, is_active: shouldActivate })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update user status');
      }

      showToast(`User account ${shouldActivate ? 'activated' : 'deactivated'} successfully!`);
      await loadUsers();
      await loadMetrics();
    } catch (err) {
      alert(err.message || 'Error updating status');
    }
  };

  // --- Plans & Pricing Manager ---
  async function loadPlans() {
    try {
      const res = await adminFetch('/api/admin/plans');
      if (res.ok) {
        const data = await res.json();
        plansData = data.plans || [];
        if (tabPlansCount) tabPlansCount.textContent = plansData.length;
        renderPlansGrid();
      }
    } catch (e) {
      console.error('loadPlans error:', e);
    }
  }

  function renderPlansGrid() {
    if (!plansContainer) return;
    if (plansData.length === 0) {
      plansContainer.innerHTML = `<div class="col-span-3 text-center py-12 text-slate-500">No subscription plans found.</div>`;
      return;
    }

    plansContainer.innerHTML = plansData.map(p => {
      const isPro = p.plan_key === 'monthly_pro';
      return `
        <div class="bg-slate-900 border ${isPro ? 'border-blue-500/50 ring-1 ring-blue-500/30' : 'border-slate-800'} rounded-3xl p-6 flex flex-col justify-between space-y-5 shadow-sm relative overflow-hidden">
          ${isPro ? `<span class="absolute top-4 right-4 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-blue-500/20 text-blue-400 border border-blue-500/30">Primary Plan</span>` : ''}

          <div class="space-y-3">
            <div class="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-blue-400">
              <i data-lucide="credit-card" class="w-5 h-5"></i>
            </div>
            <div>
              <h3 class="text-lg font-bold text-white">${p.name}</h3>
              <p class="text-xs text-slate-400 mt-0.5">${p.duration_days} Days Access • Key: <code class="text-slate-300 font-mono text-[11px]">${p.plan_key}</code></p>
            </div>
            <p class="text-xs text-slate-400 leading-relaxed">${p.description || 'Full platform monitoring access.'}</p>
          </div>

          <div class="pt-4 border-t border-slate-800/80 flex items-center justify-between">
            <div>
              <span class="text-[10px] uppercase font-bold text-slate-500 block">Current Price</span>
              <div class="text-3xl font-extrabold text-white">
                ₹${p.amount} <span class="text-xs font-normal text-slate-400">/ ${p.duration_days}d</span>
              </div>
            </div>

            <button onclick="window.adminOpenEditPlan('${p.plan_key}')" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-semibold text-xs rounded-xl transition shadow-lg shadow-blue-600/20 flex items-center gap-1.5 cursor-pointer">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
              <span>Edit Price</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    safeCreateIcons();
  }

  window.adminOpenEditPlan = (planKey) => {
    const plan = plansData.find(p => p.plan_key === planKey);
    if (!plan) return;

    if (editPlanKey) editPlanKey.value = plan.plan_key;
    if (editPlanName) editPlanName.value = plan.name;
    if (editPlanAmount) editPlanAmount.value = plan.amount;
    if (editPlanDuration) editPlanDuration.value = plan.duration_days;
    if (editPlanDesc) editPlanDesc.value = plan.description || '';

    if (editPlanModal) editPlanModal.classList.remove('hidden');
    safeCreateIcons();
  };

  if (closeEditPlanModalBtn) closeEditPlanModalBtn.addEventListener('click', () => editPlanModal.classList.add('hidden'));
  if (cancelEditPlanBtn) cancelEditPlanBtn.addEventListener('click', () => editPlanModal.classList.add('hidden'));

  if (editPlanForm) {
    editPlanForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const planKey = editPlanKey ? editPlanKey.value : '';
      const name = editPlanName ? editPlanName.value.trim() : '';
      const amount = editPlanAmount ? parseInt(editPlanAmount.value, 10) : 0;
      const duration_days = editPlanDuration ? parseInt(editPlanDuration.value, 10) : 30;
      const description = editPlanDesc ? editPlanDesc.value.trim() : '';

      if (!planKey || isNaN(amount)) {
        alert('Please specify a valid amount.');
        return;
      }

      const saveBtn = document.getElementById('savePlanBtn');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>Saving...</span>`;
      }

      try {
        const res = await adminFetch('/api/admin/plans/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey, amount, name, duration_days, description })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to update plan price');
        }

        editPlanModal.classList.add('hidden');
        showToast(`Plan price updated to ₹${amount} successfully!`);
        await loadPlans();
      } catch (err) {
        alert(err.message || 'Error updating plan');
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>Save & Apply</span>`;
          safeCreateIcons();
        }
      }
    });
  }

  // --- Razorpay Gateway & Payments Logic ---
  let paymentsData = [];
  let currentPaymentFilter = 'all';

  const checkRazorpayBtn = document.getElementById('checkRazorpayBtn');
  const syncRazorpayBtn = document.getElementById('syncRazorpayBtn');
  const razorpayKeyIdDisplay = document.getElementById('razorpayKeyIdDisplay');
  const razorpayStatusDisplay = document.getElementById('razorpayStatusDisplay');
  const razorpayModeBadge = document.getElementById('razorpayModeBadge');
  const paymentsTotalPaid = document.getElementById('paymentsTotalPaid');
  const paymentsTotalCount = document.getElementById('paymentsTotalCount');
  const paymentSearchInput = document.getElementById('paymentSearchInput');
  const paymentFilterButtons = document.querySelectorAll('.payment-filter-btn');

  async function checkRazorpayHealth(showToastMsg = true) {
    if (checkRazorpayBtn) {
      checkRazorpayBtn.disabled = true;
      checkRazorpayBtn.innerHTML = `<div class="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div><span>Checking...</span>`;
    }

    try {
      const res = await adminFetch('/api/admin/razorpay/check');
      const data = await res.json();

      if (razorpayKeyIdDisplay) razorpayKeyIdDisplay.textContent = data.key_id_masked || 'Not Configured';

      if (razorpayModeBadge) {
        if (data.mode === 'live') {
          razorpayModeBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
          razorpayModeBadge.textContent = 'Live Mode';
        } else if (data.mode === 'test') {
          razorpayModeBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30';
          razorpayModeBadge.textContent = 'Test Mode';
        } else {
          razorpayModeBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-rose-500/20 text-rose-300 border border-rose-500/30';
          razorpayModeBadge.textContent = 'Unconfigured';
        }
      }

      if (razorpayStatusDisplay) {
        if (data.status === 'connected') {
          razorpayStatusDisplay.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Connected`;
          razorpayStatusDisplay.className = 'font-semibold text-emerald-400 flex items-center gap-1';
        } else {
          razorpayStatusDisplay.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span> Error`;
          razorpayStatusDisplay.className = 'font-semibold text-rose-400 flex items-center gap-1';
        }
      }

      if (showToastMsg) {
        if (data.status === 'connected') {
          showToast(`Razorpay Gateway Connected (${data.mode.toUpperCase()} Mode)`);
        } else {
          showToast(`Razorpay Error: ${data.error || 'Connection failed'}`, 'error');
        }
      }
    } catch (err) {
      if (showToastMsg) showToast('Failed to check Razorpay status: ' + err.message, 'error');
    } finally {
      if (checkRazorpayBtn) {
        checkRazorpayBtn.disabled = false;
        checkRazorpayBtn.innerHTML = `<i data-lucide="activity" class="w-3.5 h-3.5 text-blue-400"></i><span>Check API Health</span>`;
        safeCreateIcons();
      }
    }
  }

  async function syncRazorpayPayments() {
    if (syncRazorpayBtn) {
      syncRazorpayBtn.disabled = true;
      syncRazorpayBtn.innerHTML = `<div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div><span>Syncing...</span>`;
    }

    try {
      const res = await adminFetch('/api/admin/razorpay/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Sync failed');
      }

      showToast(data.message || `Synced payments from Razorpay successfully!`);
      await loadPayments();
      await loadMetrics();
    } catch (err) {
      showToast('Razorpay sync error: ' + err.message, 'error');
    } finally {
      if (syncRazorpayBtn) {
        syncRazorpayBtn.disabled = false;
        syncRazorpayBtn.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i><span>Sync Live Payments</span>`;
        safeCreateIcons();
      }
    }
  }

  if (checkRazorpayBtn) checkRazorpayBtn.addEventListener('click', () => checkRazorpayHealth(true));
  if (syncRazorpayBtn) syncRazorpayBtn.addEventListener('click', syncRazorpayPayments);

  async function loadPayments() {
    try {
      const res = await adminFetch('/api/admin/payments');
      if (res.ok) {
        const data = await res.json();
        paymentsData = data.payments || [];
        renderPaymentsSummary();
        renderPaymentsTable();
      }
    } catch (e) {
      console.error('loadPayments error:', e);
    }
  }

  function renderPaymentsSummary() {
    let totalPaidAmt = 0;
    paymentsData.forEach(p => {
      const isPaid = p.status === 'captured' || p.status === 'success' || p.status === 'paid';
      if (isPaid) {
        const amt = p.amount > 500 ? Math.round(p.amount / 100) : p.amount;
        totalPaidAmt += amt;
      }
    });

    if (paymentsTotalPaid) paymentsTotalPaid.textContent = `₹${totalPaidAmt.toLocaleString()}`;
    if (paymentsTotalCount) paymentsTotalCount.textContent = paymentsData.length;
  }

  function renderPaymentsTable() {
    if (!paymentsTableBody) return;
    const query = paymentSearchInput ? paymentSearchInput.value.trim().toLowerCase() : '';

    let filtered = [...paymentsData];

    if (query) {
      filtered = filtered.filter(p => 
        (p.order_id && p.order_id.toLowerCase().includes(query)) ||
        (p.payment_id && p.payment_id.toLowerCase().includes(query)) ||
        (p.user_phone && p.user_phone.includes(query)) ||
        (p.user_name && p.user_name.toLowerCase().includes(query))
      );
    }

    if (currentPaymentFilter === 'captured') {
      filtered = filtered.filter(p => p.status === 'captured' || p.status === 'success' || p.status === 'paid');
    } else if (currentPaymentFilter === 'created') {
      filtered = filtered.filter(p => p.status === 'created' || p.status === 'pending');
    } else if (currentPaymentFilter === 'failed') {
      filtered = filtered.filter(p => p.status === 'failed' || p.status === 'error');
    }

    if (filtered.length === 0) {
      paymentsTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="py-12 text-center text-slate-500">
            <i data-lucide="receipt" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
            <p class="font-medium">No payment records found matching your filters.</p>
          </td>
        </tr>
      `;
      safeCreateIcons();
      return;
    }

    paymentsTableBody.innerHTML = filtered.map(p => {
      const isPaid = p.status === 'captured' || p.status === 'success' || p.status === 'paid';
      const isFailed = p.status === 'failed' || p.status === 'error';
      const dateStr = p.created_at ? new Date(p.created_at * 1000).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
      const amtInRupees = p.amount > 500 ? Math.round(p.amount / 100) : p.amount;
      const cleanPhone = String(p.user_phone || '').slice(-10);

      return `
        <tr class="hover:bg-slate-800/40 transition">
          <td class="py-3.5 px-4 font-mono">
            <div class="font-semibold text-white text-xs">${p.order_id || '-'}</div>
            <div class="text-[10px] text-slate-400 font-normal mt-0.5 flex items-center gap-1">
              <span>${p.payment_id || 'Awaiting Payment'}</span>
            </div>
          </td>
          <td class="py-3.5 px-4">
            <div class="font-semibold text-white">${p.user_name || 'User'}</div>
            <div class="text-[11px] font-mono text-slate-400">+91 ${cleanPhone}</div>
          </td>
          <td class="py-3.5 px-4 font-mono font-bold text-white text-sm">
            ₹${amtInRupees}
          </td>
          <td class="py-3.5 px-4">
            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700 uppercase">
              ${p.method || 'UPI / Razorpay'}
            </span>
          </td>
          <td class="py-3.5 px-4">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase ${
              isPaid 
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                : (isFailed 
                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' 
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20')
            }">
              <span class="w-1.5 h-1.5 rounded-full ${isPaid ? 'bg-emerald-400' : (isFailed ? 'bg-rose-400' : 'bg-amber-400')}"></span>
              ${p.status}
            </span>
          </td>
          <td class="py-3.5 px-4 text-slate-400 text-[11px] whitespace-nowrap">
            ${dateStr}
          </td>
        </tr>
      `;
    }).join('');

    safeCreateIcons();
  }

  paymentFilterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      paymentFilterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPaymentFilter = btn.getAttribute('data-payment-filter');
      renderPaymentsTable();
    });
  });

  if (paymentSearchInput) {
    paymentSearchInput.addEventListener('input', renderPaymentsTable);
  }

  // --- Initial Startup Check ---
  async function initAdmin() {
    if (adminToken) {
      try {
        const res = await adminFetch('/api/admin/metrics');
        if (res.ok) {
          adminAuthScreen.classList.add('hidden');
          adminDashboardApp.classList.remove('hidden');
          loadAllData();
          return;
        }
      } catch (e) {}
    }
    handleUnauthorized();
  }

  initAdmin();
});
