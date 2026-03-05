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

  // English learning state
  let currentEnglishSubtab = 'records';
  let currentPhraseIndex = 0;
  let shuffledPhrases = [];
  let isCardFlipped = false;
  let currentPresentation = null;
  let timerInterval = null;
  let timerSeconds = 0;
  let isRecording = false;
  let mediaRecorder = null;
  let audioChunks = [];
  let quizWords = [];
  let currentQuizIndex = 0;
  let quizScore = { correct: 0, total: 0 };

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

      // Initialize English learning data
      if (!practiceData.english) practiceData.english = {};
      if (!practiceData.english.phrases) practiceData.english.phrases = [];
      if (!practiceData.english.vocabulary) practiceData.english.vocabulary = [];
      if (!practiceData.english.presentations) practiceData.english.presentations = [];

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
      <button class="tab ${cat.id} ${cat.id === currentCategory ? 'active' : ''}" data-category="${cat.id}">
        ${cat.emoji} ${cat.label}
      </button>
    `).join('');

    container.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentCategory = tab.dataset.category;
        updateEnglishUI();
        renderAll();
      });
    });

    // Initialize English subtabs
    initEnglishSubtabs();
  }

  // Update UI based on current category
  function updateEnglishUI() {
    const subtabs = document.getElementById('english-subtabs');
    const statsRow = document.getElementById('stats-row');
    const contribGraph = document.getElementById('contrib-graph');
    const todaySection = document.querySelector('.today-section');
    const calendarHeader = document.querySelector('.calendar-header');
    const calendarGrid = document.getElementById('calendar-grid');
    const recentTitle = document.getElementById('recent-title');
    const practiceList = document.getElementById('practice-list');

    // English sections
    const phrasesSection = document.getElementById('phrases-section');
    const vocabSection = document.getElementById('vocabulary-section');
    const presentationSection = document.getElementById('presentation-section');

    if (currentCategory === 'english') {
      subtabs?.classList.add('show');
      showEnglishSubtab(currentEnglishSubtab);
    } else {
      subtabs?.classList.remove('show');
      // Show standard practice log UI
      statsRow.style.display = '';
      contribGraph.style.display = '';
      todaySection.style.display = '';
      calendarHeader.style.display = '';
      calendarGrid.style.display = '';
      recentTitle.style.display = '';
      practiceList.style.display = '';
      phrasesSection?.classList.remove('show');
      vocabSection?.classList.remove('show');
      presentationSection?.classList.remove('show');
    }
  }

  // Show English subtab content
  function showEnglishSubtab(subtab) {
    currentEnglishSubtab = subtab;

    const statsRow = document.getElementById('stats-row');
    const contribGraph = document.getElementById('contrib-graph');
    const todaySection = document.querySelector('.today-section');
    const calendarHeader = document.querySelector('.calendar-header');
    const calendarGrid = document.getElementById('calendar-grid');
    const recentTitle = document.getElementById('recent-title');
    const practiceList = document.getElementById('practice-list');
    const phrasesSection = document.getElementById('phrases-section');
    const vocabSection = document.getElementById('vocabulary-section');
    const presentationSection = document.getElementById('presentation-section');

    // Hide all sections first
    [statsRow, contribGraph, todaySection, calendarHeader, calendarGrid, recentTitle, practiceList].forEach(el => {
      if (el) el.style.display = 'none';
    });
    phrasesSection?.classList.remove('show');
    vocabSection?.classList.remove('show');
    presentationSection?.classList.remove('show');

    // Update subtab active state
    document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.sub-tab[data-subtab="${subtab}"]`)?.classList.add('active');

    // Show relevant section
    if (subtab === 'records') {
      [statsRow, contribGraph, todaySection, calendarHeader, calendarGrid, recentTitle, practiceList].forEach(el => {
        if (el) el.style.display = '';
      });
    } else if (subtab === 'phrases') {
      phrasesSection?.classList.add('show');
      renderPhrases();
    } else if (subtab === 'vocabulary') {
      vocabSection?.classList.add('show');
      renderVocabulary();
    } else if (subtab === 'presentation') {
      presentationSection?.classList.add('show');
      renderPresentations();
    }
  }

  // Initialize English subtabs
  function initEnglishSubtabs() {
    const subtabs = document.getElementById('english-subtabs');
    if (!subtabs) return;

    subtabs.querySelectorAll('.sub-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        showEnglishSubtab(tab.dataset.subtab);
      });
    });
  }

  // ==================== PHRASES FUNCTIONS ====================

  function renderPhrases() {
    if (!practiceData) return;

    const phrases = practiceData.english.phrases || [];
    renderFlashcard();
    renderPhrasesList(phrases);
  }

  function renderFlashcard() {
    const phrases = practiceData.english.phrases || [];
    const flashcard = document.getElementById('flashcard');
    const textEl = document.getElementById('flashcard-text');
    const hintEl = document.getElementById('flashcard-hint');
    const categoryEl = document.getElementById('flashcard-category');
    const progressEl = document.getElementById('flashcard-progress');

    if (phrases.length === 0) {
      textEl.textContent = 'フレーズを追加してください';
      hintEl.textContent = '';
      categoryEl.textContent = '';
      progressEl.textContent = '';
      return;
    }

    if (shuffledPhrases.length === 0) {
      shuffledPhrases = [...phrases];
    }

    const phrase = shuffledPhrases[currentPhraseIndex];
    if (!phrase) return;

    if (isCardFlipped) {
      textEl.textContent = phrase.english;
      hintEl.textContent = 'クリックして日本語を見る';
      flashcard.classList.add('flipped');
    } else {
      textEl.textContent = phrase.japanese;
      hintEl.textContent = 'クリックして英語を見る';
      flashcard.classList.remove('flipped');
    }

    categoryEl.textContent = phrase.category || '';
    progressEl.textContent = `${currentPhraseIndex + 1} / ${shuffledPhrases.length}`;
  }

  function renderPhrasesList(phrases) {
    const container = document.getElementById('phrases-list');
    if (!container) return;

    if (phrases.length === 0) {
      container.innerHTML = '<div class="empty">フレーズがありません</div>';
      return;
    }

    container.innerHTML = phrases.map((phrase, i) => `
      <div class="vocab-item">
        <div class="vocab-content">
          <div class="vocab-meaning">${phrase.japanese}</div>
          <div class="vocab-example">${phrase.english}</div>
        </div>
        <span class="vocab-category-tag">${phrase.category || '-'}</span>
        <div class="vocab-actions">
          <button class="btn btn-sm" onclick="editPhrase(${i})">編集</button>
          <button class="btn btn-sm btn-delete" onclick="deletePhrase(${i})">×</button>
        </div>
      </div>
    `).join('');
  }

  function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function openPhraseModal(phrase = null, index = -1) {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    title.textContent = phrase ? 'フレーズを編集' : 'フレーズを追加';

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">日本語</label>
        <input type="text" class="form-input" id="phrase-japanese" value="${phrase?.japanese || ''}" placeholder="日本語フレーズ">
      </div>
      <div class="form-group">
        <label class="form-label">English</label>
        <input type="text" class="form-input" id="phrase-english" value="${phrase?.english || ''}" placeholder="English phrase">
      </div>
      <div class="form-group">
        <label class="form-label">カテゴリ</label>
        <select class="form-select" id="phrase-category">
          <option value="">なし</option>
          <option value="ビジネス" ${phrase?.category === 'ビジネス' ? 'selected' : ''}>ビジネス</option>
          <option value="日常" ${phrase?.category === '日常' ? 'selected' : ''}>日常</option>
          <option value="旅行" ${phrase?.category === '旅行' ? 'selected' : ''}>旅行</option>
          <option value="技術" ${phrase?.category === '技術' ? 'selected' : ''}>技術</option>
        </select>
      </div>
      <button class="btn btn-primary" id="save-phrase" style="width:100%;margin-top:16px;">保存</button>
    `;

    modal.classList.add('show');

    document.getElementById('save-phrase').addEventListener('click', async () => {
      const japanese = document.getElementById('phrase-japanese').value.trim();
      const english = document.getElementById('phrase-english').value.trim();
      const category = document.getElementById('phrase-category').value;

      if (!japanese || !english) {
        showToast('日本語と英語を入力してください', 'error');
        return;
      }

      const newPhrase = {
        id: phrase?.id || Date.now().toString(),
        japanese,
        english,
        category
      };

      if (index >= 0) {
        practiceData.english.phrases[index] = newPhrase;
      } else {
        practiceData.english.phrases.push(newPhrase);
      }

      await saveData();
      modal.classList.remove('show');
      shuffledPhrases = [...practiceData.english.phrases];
      currentPhraseIndex = 0;
      isCardFlipped = false;
      renderPhrases();
    });
  }

  // Global functions for phrase management
  window.editPhrase = function(index) {
    const phrase = practiceData.english.phrases[index];
    openPhraseModal(phrase, index);
  };

  window.deletePhrase = async function(index) {
    const phrase = practiceData.english.phrases[index];
    if (!confirm(`「${phrase.japanese}」を削除しますか？`)) return;

    practiceData.english.phrases.splice(index, 1);
    await saveData();
    shuffledPhrases = [...practiceData.english.phrases];
    currentPhraseIndex = 0;
    isCardFlipped = false;
    renderPhrases();
  };

  // ==================== VOCABULARY FUNCTIONS ====================

  function renderVocabulary() {
    if (!practiceData) return;

    const vocabulary = practiceData.english.vocabulary || [];
    const searchTerm = document.getElementById('vocab-search')?.value.toLowerCase() || '';
    const filterCategory = document.getElementById('vocab-filter')?.value || '';

    let filtered = vocabulary;

    if (searchTerm) {
      filtered = filtered.filter(v =>
        v.word.toLowerCase().includes(searchTerm) ||
        v.meaning.toLowerCase().includes(searchTerm) ||
        (v.example || '').toLowerCase().includes(searchTerm)
      );
    }

    if (filterCategory) {
      filtered = filtered.filter(v => v.category === filterCategory);
    }

    renderVocabList(filtered);
  }

  function renderVocabList(vocabulary) {
    const container = document.getElementById('vocab-list');
    if (!container) return;

    if (vocabulary.length === 0) {
      container.innerHTML = '<div class="empty">単語がありません</div>';
      return;
    }

    container.innerHTML = vocabulary.map((vocab, i) => {
      const realIndex = practiceData.english.vocabulary.findIndex(v => v.id === vocab.id);
      return `
        <div class="vocab-item">
          <div class="vocab-word">${vocab.word}</div>
          <div class="vocab-content">
            <div class="vocab-meaning">${vocab.meaning}</div>
            ${vocab.example ? `<div class="vocab-example">${vocab.example}</div>` : ''}
          </div>
          <span class="vocab-category-tag">${getCategoryLabel(vocab.category)}</span>
          <div class="vocab-actions">
            <button class="btn btn-sm" onclick="editVocab(${realIndex})">編集</button>
            <button class="btn btn-sm btn-delete" onclick="deleteVocab(${realIndex})">×</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function getCategoryLabel(cat) {
    const labels = {
      noun: '名詞',
      verb: '動詞',
      adjective: '形容詞',
      adverb: '副詞',
      phrase: 'フレーズ',
      other: 'その他'
    };
    return labels[cat] || cat || '-';
  }

  function openVocabModal(vocab = null, index = -1) {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    title.textContent = vocab ? '単語を編集' : '単語を追加';

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">単語</label>
        <input type="text" class="form-input" id="vocab-word" value="${vocab?.word || ''}" placeholder="English word">
      </div>
      <div class="form-group">
        <label class="form-label">意味</label>
        <input type="text" class="form-input" id="vocab-meaning" value="${vocab?.meaning || ''}" placeholder="日本語の意味">
      </div>
      <div class="form-group">
        <label class="form-label">例文</label>
        <input type="text" class="form-input" id="vocab-example" value="${vocab?.example || ''}" placeholder="Example sentence">
      </div>
      <div class="form-group">
        <label class="form-label">品詞</label>
        <select class="form-select" id="vocab-category">
          <option value="">選択...</option>
          <option value="noun" ${vocab?.category === 'noun' ? 'selected' : ''}>名詞</option>
          <option value="verb" ${vocab?.category === 'verb' ? 'selected' : ''}>動詞</option>
          <option value="adjective" ${vocab?.category === 'adjective' ? 'selected' : ''}>形容詞</option>
          <option value="adverb" ${vocab?.category === 'adverb' ? 'selected' : ''}>副詞</option>
          <option value="phrase" ${vocab?.category === 'phrase' ? 'selected' : ''}>フレーズ</option>
          <option value="other" ${vocab?.category === 'other' ? 'selected' : ''}>その他</option>
        </select>
      </div>
      <button class="btn btn-primary" id="save-vocab" style="width:100%;margin-top:16px;">保存</button>
    `;

    modal.classList.add('show');

    document.getElementById('save-vocab').addEventListener('click', async () => {
      const word = document.getElementById('vocab-word').value.trim();
      const meaning = document.getElementById('vocab-meaning').value.trim();
      const example = document.getElementById('vocab-example').value.trim();
      const category = document.getElementById('vocab-category').value;

      if (!word || !meaning) {
        showToast('単語と意味を入力してください', 'error');
        return;
      }

      const newVocab = {
        id: vocab?.id || Date.now().toString(),
        word,
        meaning,
        example,
        category
      };

      if (index >= 0) {
        practiceData.english.vocabulary[index] = newVocab;
      } else {
        practiceData.english.vocabulary.push(newVocab);
      }

      await saveData();
      modal.classList.remove('show');
      renderVocabulary();
    });
  }

  // Vocabulary Quiz
  function startVocabQuiz() {
    const vocabulary = practiceData.english.vocabulary || [];
    if (vocabulary.length === 0) {
      showToast('単語を追加してください', 'error');
      return;
    }

    quizWords = shuffleArray(vocabulary);
    currentQuizIndex = 0;
    quizScore = { correct: 0, total: 0 };

    document.getElementById('vocab-list').style.display = 'none';
    document.querySelector('.vocab-search').style.display = 'none';
    document.getElementById('vocab-quiz').style.display = 'block';

    showQuizQuestion();
  }

  function showQuizQuestion() {
    if (currentQuizIndex >= quizWords.length) {
      endVocabQuiz();
      return;
    }

    const vocab = quizWords[currentQuizIndex];
    document.getElementById('quiz-prompt').textContent = vocab.meaning;
    document.getElementById('quiz-answer').value = '';
    document.getElementById('quiz-result').textContent = '';
    document.getElementById('quiz-score').textContent = `スコア: ${quizScore.correct} / ${quizScore.total}`;
    document.getElementById('quiz-answer').focus();
  }

  function checkQuizAnswer() {
    const vocab = quizWords[currentQuizIndex];
    const answer = document.getElementById('quiz-answer').value.trim().toLowerCase();
    const correct = vocab.word.toLowerCase();
    const resultEl = document.getElementById('quiz-result');

    quizScore.total++;

    if (answer === correct) {
      quizScore.correct++;
      resultEl.textContent = '正解！ ✓';
      resultEl.className = 'quiz-result correct';
    } else {
      resultEl.textContent = `不正解。正解: ${vocab.word}`;
      resultEl.className = 'quiz-result incorrect';
    }

    document.getElementById('quiz-score').textContent = `スコア: ${quizScore.correct} / ${quizScore.total}`;

    setTimeout(() => {
      currentQuizIndex++;
      showQuizQuestion();
    }, 1500);
  }

  function skipQuizQuestion() {
    const vocab = quizWords[currentQuizIndex];
    const resultEl = document.getElementById('quiz-result');
    resultEl.textContent = `スキップ。正解: ${vocab.word}`;
    resultEl.className = 'quiz-result incorrect';

    quizScore.total++;

    setTimeout(() => {
      currentQuizIndex++;
      showQuizQuestion();
    }, 1500);
  }

  function endVocabQuiz() {
    document.getElementById('vocab-quiz').style.display = 'none';
    document.getElementById('vocab-list').style.display = '';
    document.querySelector('.vocab-search').style.display = '';

    const percentage = quizScore.total > 0 ? Math.round((quizScore.correct / quizScore.total) * 100) : 0;
    showToast(`クイズ終了！ ${quizScore.correct}/${quizScore.total} (${percentage}%)`);
  }

  // Global functions for vocabulary management
  window.editVocab = function(index) {
    const vocab = practiceData.english.vocabulary[index];
    openVocabModal(vocab, index);
  };

  window.deleteVocab = async function(index) {
    const vocab = practiceData.english.vocabulary[index];
    if (!confirm(`「${vocab.word}」を削除しますか？`)) return;

    practiceData.english.vocabulary.splice(index, 1);
    await saveData();
    renderVocabulary();
  };

  // ==================== PRESENTATION FUNCTIONS ====================

  function renderPresentations() {
    if (!practiceData) return;

    const presentations = practiceData.english.presentations || [];
    renderPresentationList(presentations);
    renderPresentationRecords();
    updateTimerTarget();
  }

  function renderPresentationList(presentations) {
    const container = document.getElementById('presentation-list');
    if (!container) return;

    if (presentations.length === 0) {
      container.innerHTML = '<div class="empty">テーマを追加してください</div>';
      return;
    }

    container.innerHTML = presentations.map((pres, i) => `
      <div class="presentation-item ${currentPresentation?.id === pres.id ? 'active' : ''}" data-index="${i}">
        <div>
          <div class="presentation-title">${pres.title}</div>
          <div class="presentation-meta">目標: ${pres.targetMinutes}分 | 練習回数: ${(pres.records || []).length}</div>
        </div>
        <div class="vocab-actions">
          <button class="btn btn-sm" onclick="editPresentation(${i}); event.stopPropagation();">編集</button>
          <button class="btn btn-sm btn-delete" onclick="deletePresentation(${i}); event.stopPropagation();">×</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.presentation-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        currentPresentation = presentations[index];
        renderPresentations();
      });
    });
  }

  function renderPresentationRecords() {
    const container = document.getElementById('presentation-records');
    if (!container) return;

    const presentations = practiceData.english.presentations || [];
    const allRecords = [];

    presentations.forEach(pres => {
      (pres.records || []).forEach(rec => {
        allRecords.push({
          title: pres.title,
          targetMinutes: pres.targetMinutes,
          ...rec
        });
      });
    });

    allRecords.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recent = allRecords.slice(0, 5);

    if (recent.length === 0) {
      container.innerHTML = '<div class="empty">まだ練習記録がありません</div>';
      return;
    }

    container.innerHTML = recent.map(rec => {
      const diff = rec.actualMinutes - rec.targetMinutes;
      const diffText = diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
      return `
        <div class="practice-item english">
          <div class="practice-date">${formatDate(rec.date)}</div>
          <div class="practice-content">
            <div style="font-size: 14px;">${rec.title}</div>
            <div style="font-size: 12px; color: var(--text-muted);">
              ${rec.actualMinutes.toFixed(1)}分 (目標: ${rec.targetMinutes}分, ${diffText}分)
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function updateTimerTarget() {
    const targetEl = document.getElementById('timer-target');
    if (currentPresentation) {
      targetEl.textContent = `目標: ${currentPresentation.targetMinutes}分 - ${currentPresentation.title}`;
    } else {
      targetEl.textContent = '目標: テーマを選択してください';
    }
  }

  function formatTimer(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function startTimer() {
    if (!currentPresentation) {
      showToast('テーマを選択してください', 'error');
      return;
    }

    timerSeconds = 0;
    document.getElementById('timer-display').textContent = formatTimer(timerSeconds);
    document.getElementById('timer-start').disabled = true;
    document.getElementById('timer-stop').disabled = false;

    timerInterval = setInterval(() => {
      timerSeconds++;
      document.getElementById('timer-display').textContent = formatTimer(timerSeconds);
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    document.getElementById('timer-start').disabled = false;
    document.getElementById('timer-stop').disabled = true;

    if (timerSeconds > 0 && currentPresentation) {
      const actualMinutes = timerSeconds / 60;

      // Add record to presentation
      const presIndex = practiceData.english.presentations.findIndex(p => p.id === currentPresentation.id);
      if (presIndex >= 0) {
        if (!practiceData.english.presentations[presIndex].records) {
          practiceData.english.presentations[presIndex].records = [];
        }
        practiceData.english.presentations[presIndex].records.push({
          date: getTodayKey(),
          actualMinutes: parseFloat(actualMinutes.toFixed(2))
        });
        saveData();
        currentPresentation = practiceData.english.presentations[presIndex];
        renderPresentations();
        showToast(`${actualMinutes.toFixed(1)}分の練習を記録しました`);
      }
    }

    // Stop recording if active
    if (isRecording) {
      stopRecording();
    }

    timerSeconds = 0;
    document.getElementById('timer-display').textContent = formatTimer(timerSeconds);
  }

  async function toggleRecording() {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = e => {
        audioChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        const a = document.createElement('a');
        a.href = audioUrl;
        a.download = `presentation_${getTodayKey()}_${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(audioUrl);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      isRecording = true;
      document.getElementById('recording-indicator').classList.add('show');
      document.getElementById('timer-record').textContent = '⏹';
    } catch (err) {
      showToast('マイクへのアクセスが拒否されました', 'error');
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    isRecording = false;
    document.getElementById('recording-indicator').classList.remove('show');
    document.getElementById('timer-record').textContent = '🎤';
  }

  function openPresentationModal(pres = null, index = -1) {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    title.textContent = pres ? 'テーマを編集' : 'テーマを追加';

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">テーマ名</label>
        <input type="text" class="form-input" id="pres-title" value="${pres?.title || ''}" placeholder="発表のテーマ">
      </div>
      <div class="form-group">
        <label class="form-label">目標時間（分）</label>
        <input type="number" class="form-input" id="pres-target" value="${pres?.targetMinutes || 5}" min="1" max="60">
      </div>
      <button class="btn btn-primary" id="save-pres" style="width:100%;margin-top:16px;">保存</button>
    `;

    modal.classList.add('show');

    document.getElementById('save-pres').addEventListener('click', async () => {
      const presTitle = document.getElementById('pres-title').value.trim();
      const targetMinutes = parseInt(document.getElementById('pres-target').value) || 5;

      if (!presTitle) {
        showToast('テーマ名を入力してください', 'error');
        return;
      }

      const newPres = {
        id: pres?.id || Date.now().toString(),
        title: presTitle,
        targetMinutes,
        records: pres?.records || []
      };

      if (index >= 0) {
        practiceData.english.presentations[index] = newPres;
      } else {
        practiceData.english.presentations.push(newPres);
      }

      await saveData();
      modal.classList.remove('show');
      currentPresentation = newPres;
      renderPresentations();
    });
  }

  // Global functions for presentation management
  window.editPresentation = function(index) {
    const pres = practiceData.english.presentations[index];
    openPresentationModal(pres, index);
  };

  window.deletePresentation = async function(index) {
    const pres = practiceData.english.presentations[index];
    if (!confirm(`「${pres.title}」を削除しますか？`)) return;

    practiceData.english.presentations.splice(index, 1);
    if (currentPresentation?.id === pres.id) {
      currentPresentation = null;
    }
    await saveData();
    renderPresentations();
  };

  // Render All
  function renderAll() {
    renderStats();
    renderContribGraph();
    renderTodayChecklist();
    renderCalendar();
    renderRecentRecords();
    updateEnglishUI();
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

    // English: Phrases
    document.getElementById('add-phrase-btn')?.addEventListener('click', () => openPhraseModal());

    document.getElementById('flashcard')?.addEventListener('click', () => {
      isCardFlipped = !isCardFlipped;
      renderFlashcard();
    });

    document.getElementById('prev-card')?.addEventListener('click', () => {
      if (shuffledPhrases.length === 0) return;
      currentPhraseIndex = (currentPhraseIndex - 1 + shuffledPhrases.length) % shuffledPhrases.length;
      isCardFlipped = false;
      renderFlashcard();
    });

    document.getElementById('next-card')?.addEventListener('click', () => {
      if (shuffledPhrases.length === 0) return;
      currentPhraseIndex = (currentPhraseIndex + 1) % shuffledPhrases.length;
      isCardFlipped = false;
      renderFlashcard();
    });

    document.getElementById('shuffle-cards')?.addEventListener('click', () => {
      const phrases = practiceData?.english?.phrases || [];
      if (phrases.length === 0) return;
      shuffledPhrases = shuffleArray(phrases);
      currentPhraseIndex = 0;
      isCardFlipped = false;
      renderFlashcard();
      showToast('シャッフルしました');
    });

    // English: Vocabulary
    document.getElementById('add-vocab-btn')?.addEventListener('click', () => openVocabModal());
    document.getElementById('vocab-search')?.addEventListener('input', renderVocabulary);
    document.getElementById('vocab-filter')?.addEventListener('change', renderVocabulary);
    document.getElementById('vocab-quiz-btn')?.addEventListener('click', startVocabQuiz);
    document.getElementById('quiz-check')?.addEventListener('click', checkQuizAnswer);
    document.getElementById('quiz-skip')?.addEventListener('click', skipQuizQuestion);
    document.getElementById('quiz-exit')?.addEventListener('click', endVocabQuiz);
    document.getElementById('quiz-answer')?.addEventListener('keypress', e => {
      if (e.key === 'Enter') checkQuizAnswer();
    });

    // English: Presentation
    document.getElementById('add-presentation-btn')?.addEventListener('click', () => openPresentationModal());
    document.getElementById('timer-start')?.addEventListener('click', startTimer);
    document.getElementById('timer-stop')?.addEventListener('click', stopTimer);
    document.getElementById('timer-record')?.addEventListener('click', toggleRecording);

    await loadData();
  }

  async function loadData() {
    await fetchData();
    if (practiceData) renderAll();
  }

  init();
})();
