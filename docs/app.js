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
  let currentInstrument = 'guitar';
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
      // Initialize all categories
      CATEGORIES.forEach(cat => {
        if (!practiceData[cat.id]) practiceData[cat.id] = [];
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

  // Stats
  function renderStats() {
    if (!practiceData) return;

    const items = practiceData[currentInstrument] || [];
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    let monthTotal = 0;
    let monthDays = 0;
    let yearTotal = 0;
    const monthDaysSet = new Set();

    items.forEach(item => {
      const d = new Date(item.date);
      if (d.getFullYear() === year) {
        yearTotal += item.duration || 0;
        if (d.getMonth() === month) {
          monthTotal += item.duration || 0;
          monthDaysSet.add(item.date);
        }
      }
    });
    monthDays = monthDaysSet.size;

    const statsRow = document.getElementById('stats-row');
    if (statsRow) {
      statsRow.innerHTML = `
        <div class="stat-card">
          <div class="stat-value ${currentInstrument}">${monthTotal}</div>
          <div class="stat-label">${month + 1}Monthly time (min)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value ${currentInstrument}">${monthDays}</div>
          <div class="stat-label">${month + 1}Monthly days</div>
        </div>
        <div class="stat-card">
          <div class="stat-value ${currentInstrument}">${Math.round(yearTotal / 60)}</div>
          <div class="stat-label">${year}Yearly time (h)</div>
        </div>
      `;
    }
  }

  // Contribution Graph
  function renderContribGraph() {
    if (!practiceData) return;

    const container = document.getElementById('contrib-graph');
    if (!container) return;

    const items = practiceData[currentInstrument] || [];
    const durationByDate = {};

    items.forEach(item => {
      durationByDate[item.date] = (durationByDate[item.date] || 0) + (item.duration || 0);
    });

    // Last 90 days
    const days = [];
    const today = new Date();
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = getDateKey(d);
      const duration = durationByDate[key] || 0;
      let level = 0;
      if (duration > 0) level = 1;
      if (duration >= 30) level = 2;
      if (duration >= 60) level = 3;
      if (duration >= 90) level = 4;
      days.push({ key, duration, level });
    }

    container.innerHTML = `
      <div class="contrib-row">
        ${days.map(d => `<div class="contrib-day ${currentInstrument} level-${d.level}" title="${d.key}: ${d.duration}min"></div>`).join('')}
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

    const items = practiceData[currentInstrument] || [];
    const durationByDate = {};
    items.forEach(item => {
      durationByDate[item.date] = (durationByDate[item.date] || 0) + (item.duration || 0);
    });

    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const todayKey = getTodayKey();

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let html = weekdays.map(w => `<div class="calendar-weekday">${w}</div>`).join('');

    // Empty cells before first day
    for (let i = 0; i < startDayOfWeek; i++) {
      html += '<div class="calendar-day empty"></div>';
    }

    // Days
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const duration = durationByDate[dateKey] || 0;
      const isToday = dateKey === todayKey;
      const hasPractice = duration > 0;

      html += `
        <div class="calendar-day ${isToday ? 'today' : ''} ${hasPractice ? 'has-practice ' + currentInstrument : ''}" data-date="${dateKey}">
          <span class="calendar-day-num">${day}</span>
          ${hasPractice ? `<span class="calendar-day-duration">${duration}m</span>` : ''}
        </div>
      `;
    }

    gridEl.innerHTML = html;

    // Attach click events
    gridEl.querySelectorAll('.calendar-day:not(.empty)').forEach(dayEl => {
      dayEl.addEventListener('click', () => {
        openDayModal(dayEl.dataset.date);
      });
    });
  }

  // Practice List
  function renderPracticeList() {
    if (!practiceData) return;

    const container = document.getElementById('practice-list');
    if (!container) return;

    const items = (practiceData[currentInstrument] || [])
      .map((item, idx) => ({ ...item, idx }))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);

    if (items.length === 0) {
      container.innerHTML = '<div class="empty">No practice records yet</div>';
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="practice-item ${currentInstrument}">
        <div class="practice-date">${formatDate(item.date)}</div>
        <div class="practice-content">
          <div class="practice-duration">${item.duration} min</div>
          ${item.content ? `<div class="practice-text">${item.content}</div>` : ''}
          ${item.progress ? `<div class="practice-progress">${item.progress}</div>` : ''}
        </div>
        <div class="practice-actions">
          <button class="btn btn-sm" data-idx="${item.idx}" data-action="edit">Edit</button>
          <button class="btn btn-sm" data-idx="${item.idx}" data-action="delete">Delete</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.idx)));
    });

    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => deleteItem(parseInt(btn.dataset.idx)));
    });
  }

  // Day Modal
  function openDayModal(dateKey) {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    const items = (practiceData[currentInstrument] || [])
      .map((item, idx) => ({ ...item, idx }))
      .filter(item => item.date === dateKey);

    title.textContent = formatDate(dateKey);

    let html = '';

    if (items.length > 0) {
      html += '<div style="margin-bottom:16px;">';
      items.forEach(item => {
        html += `
          <div class="practice-item ${currentInstrument}" style="margin-bottom:8px;">
            <div class="practice-content" style="flex:1;">
              <div class="practice-duration">${item.duration} min</div>
              ${item.content ? `<div class="practice-text">${item.content}</div>` : ''}
              ${item.progress ? `<div class="practice-progress">${item.progress}</div>` : ''}
            </div>
            <div class="practice-actions">
              <button class="btn btn-sm" data-idx="${item.idx}" data-action="edit-item">Edit</button>
              <button class="btn btn-sm" data-idx="${item.idx}" data-action="delete-item">Delete</button>
            </div>
          </div>
        `;
      });
      html += '</div>';
    }

    html += `
      <div class="section-title">Add Practice</div>
      <div class="form-group">
        <label class="form-label">Duration (min)</label>
        <input type="number" class="form-input" id="add-duration" min="1" value="30">
      </div>
      <div class="form-group">
        <label class="form-label">Content</label>
        <input type="text" class="form-input" id="add-content" placeholder="What did you practice?">
      </div>
      <div class="form-group">
        <label class="form-label">Progress / Notes</label>
        <textarea class="form-textarea" id="add-progress" placeholder="Progress or notes..."></textarea>
      </div>
      <button class="btn btn-primary" id="add-save" style="width:100%;margin-top:12px;">Add</button>
    `;

    content.innerHTML = html;
    modal.classList.add('show');

    // Edit/delete existing items
    content.querySelectorAll('[data-action="edit-item"]').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.classList.remove('show');
        openEditModal(parseInt(btn.dataset.idx));
      });
    });

    content.querySelectorAll('[data-action="delete-item"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx);
        if (!confirm('Delete this practice record?')) return;
        practiceData[currentInstrument].splice(idx, 1);
        await saveData();
        modal.classList.remove('show');
        renderAll();
      });
    });

    // Add new
    document.getElementById('add-save').addEventListener('click', async () => {
      const duration = parseInt(document.getElementById('add-duration').value) || 0;
      const contentVal = document.getElementById('add-content').value.trim();
      const progress = document.getElementById('add-progress').value.trim();

      if (duration <= 0) {
        showToast('Please enter duration', 'error');
        return;
      }

      practiceData[currentInstrument].push({
        date: dateKey,
        duration,
        content: contentVal || undefined,
        progress: progress || undefined
      });

      await saveData();
      modal.classList.remove('show');
      renderAll();
    });
  }

  // Edit Modal
  function openEditModal(idx) {
    const item = practiceData[currentInstrument][idx];
    if (!item) return;

    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    title.textContent = 'Edit Practice';

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">Date</label>
        <input type="date" class="form-input" id="edit-date" value="${item.date}">
      </div>
      <div class="form-group">
        <label class="form-label">Duration (min)</label>
        <input type="number" class="form-input" id="edit-duration" min="1" value="${item.duration || 30}">
      </div>
      <div class="form-group">
        <label class="form-label">Content</label>
        <input type="text" class="form-input" id="edit-content" value="${item.content || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Progress / Notes</label>
        <textarea class="form-textarea" id="edit-progress">${item.progress || ''}</textarea>
      </div>
      <button class="btn btn-primary" id="edit-save" style="width:100%;margin-top:12px;">Save</button>
    `;

    modal.classList.add('show');

    document.getElementById('edit-save').addEventListener('click', async () => {
      item.date = document.getElementById('edit-date').value;
      item.duration = parseInt(document.getElementById('edit-duration').value) || 30;
      item.content = document.getElementById('edit-content').value.trim() || undefined;
      item.progress = document.getElementById('edit-progress').value.trim() || undefined;

      await saveData();
      modal.classList.remove('show');
      renderAll();
    });
  }

  async function deleteItem(idx) {
    if (!confirm('Delete this practice record?')) return;
    practiceData[currentInstrument].splice(idx, 1);
    await saveData();
    renderAll();
  }

  // Quick Add
  async function quickAdd() {
    const duration = parseInt(document.getElementById('quick-duration').value) || 0;
    const content = document.getElementById('quick-content').value.trim();

    if (duration <= 0) {
      showToast('Please enter duration', 'error');
      return;
    }

    practiceData[currentInstrument].push({
      date: getTodayKey(),
      duration,
      content: content || undefined
    });

    await saveData();
    document.getElementById('quick-duration').value = '';
    document.getElementById('quick-content').value = '';
    renderAll();
  }

  // Render Tabs
  function renderTabs() {
    const container = document.getElementById('tabs');
    if (!container) return;

    container.innerHTML = CATEGORIES.map((cat, i) => `
      <button class="tab ${cat.id} ${i === 0 ? 'active' : ''}" data-instrument="${cat.id}">
        ${cat.emoji} ${cat.label}
      </button>
    `).join('');

    container.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentInstrument = tab.dataset.instrument;
        renderAll();
      });
    });
  }

  // Render All
  function renderAll() {
    renderStats();
    renderContribGraph();
    renderCalendar();
    renderPracticeList();
  }

  // Init
  async function init() {
    // Render tabs
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

    // Quick add
    document.getElementById('quick-add-btn')?.addEventListener('click', quickAdd);
    document.getElementById('quick-duration')?.addEventListener('keypress', e => {
      if (e.key === 'Enter') quickAdd();
    });
    document.getElementById('quick-content')?.addEventListener('keypress', e => {
      if (e.key === 'Enter') quickAdd();
    });

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

    // Load
    await loadData();
  }

  async function loadData() {
    await fetchData();
    if (practiceData) renderAll();
  }

  init();
})();