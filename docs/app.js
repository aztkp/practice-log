// Practice Log Web App
(function() {
  'use strict';

  const GITHUB_REPO = 'aztkp/practice-log';
  const STORAGE_KEY = 'practice_log_token';

  // Categories configuration - add new categories here
  const CATEGORIES = [
    { id: 'guitar', label: 'Guitar', emoji: '🎸' },
    { id: 'piano', label: 'Piano', emoji: '🎹' },
    { id: 'english', label: 'English', emoji: '📚' }
  ];

  let practiceData = null;
  let dataSha = null;
  let currentCategory = 'guitar';
  let currentYear = new Date().getFullYear();
  let currentMonth = new Date().getMonth();

  // Utils
  function b64decode(str) {
    const binary = atob(str.replace(/\n/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function b64encode(str) {
    return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
  }

  function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast ' + type + ' show';
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function getToken() { return localStorage.getItem(STORAGE_KEY) || ''; }
  function setToken(t) { localStorage.setItem(STORAGE_KEY, t); }

  function formatDate(d) {
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function getDateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function getTodayKey() {
    return getDateKey(new Date());
  }

  // API
  async function fetchData() {
    const token = getToken();
    if (!token) {
      document.getElementById('settings-modal').classList.add('show');
      return null;
    }

    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`, {
        headers: { 'Authorization': `token ${token}` }
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      dataSha = data.sha;
      practiceData = JSON.parse(b64decode(data.content));

      // Initialize structure
      if (!practiceData.plans) practiceData.plans = {};
      if (!practiceData.records) practiceData.records = {};
      CATEGORIES.forEach(cat => {
        if (!practiceData.plans[cat.id]) practiceData.plans[cat.id] = [];
        if (!practiceData.records[cat.id]) practiceData.records[cat.id] = [];
      });
      return practiceData;
    } catch (e) {
      showToast('Failed to load data', 'error');
      return null;
    }
  }

  async function saveData() {
    const token = getToken();
    if (!token || !practiceData) return false;

    try {
      if (!dataSha) {
        const latest = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`, {
          headers: { 'Authorization': `token ${token}` }
        });
        if (latest.ok) {
          const latestData = await latest.json();
          dataSha = latestData.sha;
        }
      }

      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`, {
        method: 'PUT',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Update practice log',
          content: b64encode(JSON.stringify(practiceData, null, 2)),
          sha: dataSha
        })
      });

      if (res.status === 409) {
        const latest = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`, {
          headers: { 'Authorization': `token ${token}` }
        });
        if (latest.ok) {
          const latestData = await latest.json();
          dataSha = latestData.sha;
          const retry = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`, {
            method: 'PUT',
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: 'Update practice log',
              content: b64encode(JSON.stringify(practiceData, null, 2)),
              sha: dataSha
            })
          });
          if (retry.ok) {
            const data = await retry.json();
            dataSha = data.content.sha;
            showToast('Saved');
            return true;
          }
        }
      }

      if (!res.ok) throw new Error('Failed');

      const data = await res.json();
      dataSha = data.content.sha;
      showToast('Saved');
      return true;
    } catch (e) {
      console.error('Save error:', e);
      showToast('Failed to save', 'error');
      return false;
    }
  }

  // Get record for a specific date
  function getRecord(dateKey) {
    const records = practiceData.records[currentCategory] || [];
    return records.find(r => r.date === dateKey);
  }

  // Stats
  function renderStats() {
    if (!practiceData) return;

    const records = practiceData.records[currentCategory] || [];
    const plans = practiceData.plans[currentCategory] || [];
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    let monthDays = 0;
    let monthChecks = 0;
    let yearDays = 0;

    records.forEach(record => {
      const d = new Date(record.date);
      const checks = (record.completed || []).length;
      if (d.getFullYear() === year) {
        if (checks > 0) yearDays++;
        if (d.getMonth() === month && checks > 0) {
          monthDays++;
          monthChecks += checks;
        }
      }
    });

    const statsRow = document.getElementById('stats-row');
    if (statsRow) {
      statsRow.innerHTML = `
        <div class="stat-card">
          <div class="stat-value ${currentCategory}">${monthDays}</div>
          <div class="stat-label">${month + 1}月の練習日数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value ${currentCategory}">${monthChecks}</div>
          <div class="stat-label">${month + 1}月の完了項目</div>
        </div>
        <div class="stat-card">
          <div class="stat-value ${currentCategory}">${plans.length}</div>
          <div class="stat-label">プラン数</div>
        </div>
      `;
    }
  }

  // Contribution Graph
  function renderContribGraph() {
    if (!practiceData) return;

    const container = document.getElementById('contrib-graph');
    if (!container) return;

    const records = practiceData.records[currentCategory] || [];
    const plans = practiceData.plans[currentCategory] || [];
    const checksByDate = {};

    records.forEach(record => {
      checksByDate[record.date] = (record.completed || []).length;
    });

    const maxChecks = plans.length || 1;
    const days = [];
    const today = new Date();
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = getDateKey(d);
      const checks = checksByDate[key] || 0;
      let level = 0;
      if (checks > 0) level = 1;
      if (checks >= maxChecks * 0.5) level = 2;
      if (checks >= maxChecks * 0.75) level = 3;
      if (checks >= maxChecks) level = 4;
      days.push({ key, checks, level });
    }

    container.innerHTML = `
      <div class="contrib-row">
        ${days.map(d => `<div class="contrib-day ${currentCategory} level-${d.level}" title="${d.key}: ${d.checks}項目"></div>`).join('')}
      </div>
    `;
  }

  // Calendar
  function renderCalendar() {
    if (!practiceData) return;

    const monthEl = document.getElementById('calendar-month');
    const gridEl = document.getElementById('calendar-grid');
    if (!monthEl || !gridEl) return;

    monthEl.textContent = `${currentYear}/${currentMonth + 1}`;

    const records = practiceData.records[currentCategory] || [];
    const checksByDate = {};
    records.forEach(record => {
      checksByDate[record.date] = (record.completed || []).length;
    });

    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const todayKey = getTodayKey();

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let html = weekdays.map(w => `<div class="calendar-weekday">${w}</div>`).join('');

    for (let i = 0; i < startDayOfWeek; i++) {
      html += '<div class="calendar-day empty"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const checks = checksByDate[dateKey] || 0;
      const isToday = dateKey === todayKey;
      const hasPractice = checks > 0;

      html += `
        <div class="calendar-day ${isToday ? 'today' : ''} ${hasPractice ? 'has-practice ' + currentCategory : ''}" data-date="${dateKey}">
          <span class="calendar-day-num">${day}</span>
          ${hasPractice ? `<span class="calendar-day-duration">${checks}✓</span>` : ''}
        </div>
      `;
    }

    gridEl.innerHTML = html;

    gridEl.querySelectorAll('.calendar-day:not(.empty)').forEach(dayEl => {
      dayEl.addEventListener('click', () => {
        openDayModal(dayEl.dataset.date);
      });
    });
  }

  // Today's Checklist
  function renderTodayChecklist() {
    if (!practiceData) return;

    const container = document.getElementById('today-checklist');
    if (!container) return;

    const plans = practiceData.plans[currentCategory] || [];
    const todayKey = getTodayKey();
    const record = getRecord(todayKey) || { date: todayKey, completed: [] };
    const completed = record.completed || [];

    if (plans.length === 0) {
      container.innerHTML = `
        <div class="empty">
          プランがありません。<br>
          <button class="btn btn-primary" id="add-first-plan" style="margin-top:12px;">プランを追加</button>
        </div>
      `;
      document.getElementById('add-first-plan')?.addEventListener('click', openPlansModal);
      return;
    }

    container.innerHTML = `
      <div class="checklist">
        ${plans.map(plan => `
          <label class="checklist-item">
            <input type="checkbox" ${completed.includes(plan) ? 'checked' : ''} data-plan="${plan}">
            <span class="checkmark"></span>
            <span class="checklist-label">${plan}</span>
          </label>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', async () => {
        const plan = cb.dataset.plan;
        let records = practiceData.records[currentCategory];
        let record = records.find(r => r.date === todayKey);

        if (!record) {
          record = { date: todayKey, completed: [] };
          records.push(record);
        }

        if (cb.checked) {
          if (!record.completed.includes(plan)) {
            record.completed.push(plan);
          }
        } else {
          record.completed = record.completed.filter(p => p !== plan);
        }

        await saveData();
        renderStats();
        renderContribGraph();
        renderCalendar();
      });
    });
  }

  // Recent Records
  function renderRecentRecords() {
    if (!practiceData) return;

    const container = document.getElementById('practice-list');
    if (!container) return;

    const records = (practiceData.records[currentCategory] || [])
      .filter(r => (r.completed || []).length > 0)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 7);

    if (records.length === 0) {
      container.innerHTML = '<div class="empty">まだ記録がありません</div>';
      return;
    }

    container.innerHTML = records.map(record => `
      <div class="practice-item ${currentCategory}">
        <div class="practice-date">${formatDate(record.date)}</div>
        <div class="practice-content">
          <div class="practice-checks">${(record.completed || []).map(p => `<span class="check-tag">✓ ${p}</span>`).join('')}</div>
        </div>
      </div>
    `).join('');
  }

  // Day Modal (for past dates)
  function openDayModal(dateKey) {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    const plans = practiceData.plans[currentCategory] || [];
    const record = getRecord(dateKey) || { date: dateKey, completed: [] };
    const completed = record.completed || [];

    title.textContent = formatDate(dateKey);

    if (plans.length === 0) {
      content.innerHTML = '<div class="empty">プランがありません</div>';
      modal.classList.add('show');
      return;
    }

    content.innerHTML = `
      <div class="checklist">
        ${plans.map(plan => `
          <label class="checklist-item">
            <input type="checkbox" ${completed.includes(plan) ? 'checked' : ''} data-plan="${plan}">
            <span class="checkmark"></span>
            <span class="checklist-label">${plan}</span>
          </label>
        `).join('')}
      </div>
      <button class="btn btn-primary" id="save-day" style="width:100%;margin-top:16px;">保存</button>
    `;

    modal.classList.add('show');

    document.getElementById('save-day').addEventListener('click', async () => {
      const newCompleted = [];
      content.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        newCompleted.push(cb.dataset.plan);
      });

      let records = practiceData.records[currentCategory];
      let existingRecord = records.find(r => r.date === dateKey);

      if (existingRecord) {
        existingRecord.completed = newCompleted;
      } else if (newCompleted.length > 0) {
        records.push({ date: dateKey, completed: newCompleted });
      }

      await saveData();
      modal.classList.remove('show');
      renderAll();
    });
  }

  // Plans Modal
  function openPlansModal() {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    const plans = practiceData.plans[currentCategory] || [];
    const cat = CATEGORIES.find(c => c.id === currentCategory);

    title.textContent = `${cat.emoji} ${cat.label} プラン`;

    content.innerHTML = `
      <div class="plans-list" id="plans-list">
        ${plans.map((plan, i) => `
          <div class="plan-item">
            <span class="plan-name">${plan}</span>
            <button class="btn btn-sm btn-delete" data-idx="${i}">×</button>
          </div>
        `).join('')}
      </div>
      <div class="add-plan-row">
        <input type="text" class="form-input" id="new-plan" placeholder="新しいプランを追加...">
        <button class="btn btn-primary" id="add-plan-btn">追加</button>
      </div>
    `;

    modal.classList.add('show');

    // Delete plan
    content.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx);
        const planName = plans[idx];
        if (!confirm(`「${planName}」を削除しますか？`)) return;

        practiceData.plans[currentCategory].splice(idx, 1);
        await saveData();
        openPlansModal(); // Refresh modal
        renderAll();
      });
    });

    // Add plan
    const addPlan = async () => {
      const input = document.getElementById('new-plan');
      const name = input.value.trim();
      if (!name) return;

      practiceData.plans[currentCategory].push(name);
      await saveData();
      openPlansModal(); // Refresh modal
      renderAll();
    };

    document.getElementById('add-plan-btn').addEventListener('click', addPlan);
    document.getElementById('new-plan').addEventListener('keypress', e => {
      if (e.key === 'Enter') addPlan();
    });
  }

  // Render Tabs
  function renderTabs() {
    const container = document.getElementById('tabs');
    if (!container) return;

    container.innerHTML = CATEGORIES.map((cat, i) => `
      <button class="tab ${cat.id} ${i === 0 ? 'active' : ''}" data-category="${cat.id}">
        ${cat.emoji} ${cat.label}
      </button>
    `).join('');

    container.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentCategory = tab.dataset.category;
        renderAll();
      });
    });
  }

  // Render All
  function renderAll() {
    renderStats();
    renderContribGraph();
    renderTodayChecklist();
    renderCalendar();
    renderRecentRecords();
  }

  // Init
  async function init() {
    renderTabs();

    // Calendar navigation
    document.getElementById('prev-month')?.addEventListener('click', () => {
      currentMonth--;
      if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
      }
      renderCalendar();
    });

    document.getElementById('next-month')?.addEventListener('click', () => {
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
      renderCalendar();
    });

    document.getElementById('today-btn')?.addEventListener('click', () => {
      const now = new Date();
      currentYear = now.getFullYear();
      currentMonth = now.getMonth();
      renderCalendar();
    });

    // Plans button
    document.getElementById('btn-plans')?.addEventListener('click', openPlansModal);

    // Modals
    document.getElementById('modal-close')?.addEventListener('click', () => {
      document.getElementById('edit-modal').classList.remove('show');
    });

    document.getElementById('edit-modal')?.addEventListener('click', e => {
      if (e.target.id === 'edit-modal') {
        document.getElementById('edit-modal').classList.remove('show');
      }
    });

    // Settings
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      document.getElementById('settings-token').value = getToken();
      document.getElementById('settings-modal').classList.add('show');
    });

    document.getElementById('settings-close')?.addEventListener('click', () => {
      document.getElementById('settings-modal').classList.remove('show');
    });

    document.getElementById('settings-save')?.addEventListener('click', async () => {
      setToken(document.getElementById('settings-token').value.trim());
      document.getElementById('settings-modal').classList.remove('show');
      showToast('Settings saved');
      await loadData();
    });

    // Refresh
    document.getElementById('btn-refresh')?.addEventListener('click', loadData);

    await loadData();
  }

  async function loadData() {
    await fetchData();
    if (practiceData) renderAll();
  }

  init();
})();
