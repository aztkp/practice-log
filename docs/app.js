// Practice Log Web App
(function() {
  'use strict';

  const GITHUB_REPO = 'aztkp/practice-log';
  const STORAGE_KEY = 'practice_log_token';

  // Categories configuration - add new categories here
  const CATEGORIES = [
    { id: 'english', label: 'English', emoji: '📚' },
    { id: 'guitar', label: 'Guitar', emoji: '🎸' },
    { id: 'piano', label: 'Piano', emoji: '🎹' }
  ];

  let practiceData = null;
  let dataSha = null;
  let currentCategory = 'english';
  let currentYear = new Date().getFullYear();
  let currentMonth = new Date().getMonth();

  // English learning state
  let currentEnglishSubtab = 'phrases';
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

  // Phrase study mode state
  let studyMode = null; // 'chapter', 'random', 'weak'
  let questionStyle = 'japanese'; // 'situation' or 'japanese'
  let studyPhrases = [];
  let studyIndex = 0;
  let studyResults = []; // { phraseId, result: 'ok' | 'partial' | 'ng' }
  let studyStartTime = null;
  let selectedTextbookId = null;
  let selectedChapter = null;
  // Remember last study settings
  let lastStudyMode = 'chapter';
  let lastStudyTextbook = '';
  let lastStudyChapters = []; // array of selected chapters
  let lastStudyCount = 'all';
  let lastQuestionStyle = 'japanese';
  let phraseFilterTextbook = '';
  let phraseFilterChapter = '';
  let phraseFilterMastery = '';
  let phraseSearchQuery = '';
  let activeStudyContainerId = 'study-mode-container';
  let studyTabSelectedTextbook = null;
  let studyTabSelectedChapter = '';

  // Utils
  function b64decode(str) {
    const binary = atob(str.replace(/\n/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
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

  // Day boundary: 5 AM - practice before this counts as previous day
  const DAY_BOUNDARY_HOUR = 5;

  function getEffectiveDate(date = new Date()) {
    const d = new Date(date);
    // If current hour is before boundary, treat as previous day
    if (d.getHours() < DAY_BOUNDARY_HOUR) {
      d.setDate(d.getDate() - 1);
    }
    return d;
  }

  function getTodayKey() {
    return getDateKey(getEffectiveDate(new Date()));
  }

  function getYesterdayKey() {
    const effective = getEffectiveDate(new Date());
    effective.setDate(effective.getDate() - 1);
    return getDateKey(effective);
  }

  // Audio playback for phrases
  // Quick Response textbook: audio/ch{chapter}/phrase_{n}.mp3
  const AUDIO_CHAPTERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48', '49', '50', '51', '52', '53', '54', '55', '56', '57'];
  // Study textbooks: audio/study/{name}/phrase_{n}.mp3
  const STUDY_AUDIO = {
    '1743897600000': 'self-intro',
    '1743984000000': 'azatoi'
  };

  function getPhraseAudioPath(phrase) {
    if (!phrase || !phrase.chapter) return null;

    const studyDir = STUDY_AUDIO[phrase.textbookId];
    if (studyDir) {
      const tbPhrases = practiceData.english.phrases
        .filter(p => p.textbookId === phrase.textbookId);
      const idx = tbPhrases.findIndex(p => p.id === phrase.id);
      if (idx === -1) return null;
      return `audio/study/${studyDir}/phrase_${idx + 1}.mp3`;
    }

    if (!AUDIO_CHAPTERS.includes(phrase.chapter)) return null;

    // Get all phrases in this chapter (keep original order from data.json)
    const chapterPhrases = practiceData.english.phrases
      .filter(p => p.chapter === phrase.chapter);

    const phraseIndex = chapterPhrases.findIndex(p => p.id === phrase.id);
    if (phraseIndex === -1) return null;

    return `audio/ch${phrase.chapter}/phrase_${phraseIndex + 1}.mp3`;
  }

  let currentAudio = null;

  function playPhraseAudio(phrase) {
    const audioPath = getPhraseAudioPath(phrase);
    if (!audioPath) {
      showToast('音声ファイルがありません', 'error');
      return;
    }

    // Stop any currently playing audio
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    currentAudio = new Audio(audioPath);
    currentAudio.play().catch(err => {
      console.error('Audio playback error:', err);
      showToast('音声の再生に失敗しました', 'error');
    });
  }

  function playPhraseAudioByIndex(index) {
    const phrases = practiceData?.english?.phrases || [];
    if (index >= 0 && index < phrases.length) {
      playPhraseAudio(phrases[index]);
    }
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
      if (!practiceData.english.textbooks) practiceData.english.textbooks = [];
      if (!practiceData.english.studyRecords) practiceData.english.studyRecords = [];
      if (!practiceData.english.pronunciation) practiceData.english.pronunciation = [];
      if (!practiceData.english.dictation) practiceData.english.dictation = [];
      if (!practiceData.english.meetingPhrases) practiceData.english.meetingPhrases = [];

      // Initialize Piano learning data
      if (!practiceData.piano) practiceData.piano = {};
      if (!practiceData.piano.textbooks) practiceData.piano.textbooks = [];

      // Initialize Guitar learning data
      if (!practiceData.guitar) practiceData.guitar = {};
      if (!practiceData.guitar.textbooks) practiceData.guitar.textbooks = [];

      // Migrate existing phrases to include new fields
      practiceData.english.phrases = practiceData.english.phrases.map(phrase => ({
        ...phrase,
        textbookId: phrase.textbookId || null,
        chapter: phrase.chapter || null,
        masteryLevel: phrase.masteryLevel ?? 0,
        lastStudied: phrase.lastStudied || null,
        studyCount: phrase.studyCount || 0,
        createdAt: phrase.createdAt || new Date().toISOString().split('T')[0]
      }));

      return practiceData;
    } catch (e) {
      showToast('Failed to load data', 'error');
      return null;
    }
  }

  async function saveData(retryCount = 0) {
    const token = getToken();
    if (!token || !practiceData) {
      console.error('Save failed: no token or practiceData');
      return false;
    }

    const MAX_RETRIES = 3;

    try {
      // Always get fresh SHA before saving to avoid conflicts
      const latestRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`, {
        headers: { 'Authorization': `token ${token}` }
      });
      if (latestRes.ok) {
        const latestData = await latestRes.json();
        const remoteSha = latestData.sha;

        // If SHA changed, we need to merge
        if (dataSha && remoteSha !== dataSha) {
          console.log('SHA mismatch detected, merging data...');
          const remoteData = JSON.parse(b64decode(latestData.content));

          // Merge: keep remote phrases/phonemes, but update with local study progress
          if (remoteData.english && practiceData.english) {
            // Merge phrases: use remote as base, update study data from local
            const localPhraseMap = {};
            (practiceData.english.phrases || []).forEach(p => { localPhraseMap[p.id] = p; });

            remoteData.english.phrases = (remoteData.english.phrases || []).map(rp => {
              const lp = localPhraseMap[rp.id];
              if (lp && (lp.lastStudied || lp.studyCount > 0)) {
                return { ...rp, lastStudied: lp.lastStudied, studyCount: lp.studyCount, masteryLevel: lp.masteryLevel };
              }
              return rp;
            });

            // Merge pronunciation
            const localPhonemeMap = {};
            (practiceData.english.pronunciation || []).forEach(p => { localPhonemeMap[p.id] = p; });

            remoteData.english.pronunciation = (remoteData.english.pronunciation || []).map(rp => {
              const lp = localPhonemeMap[rp.id];
              if (lp && lp.practicedWords) {
                return { ...rp, practicedWords: lp.practicedWords };
              }
              return rp;
            });

            // Merge studyRecords (combine both, avoid duplicates by id)
            const remoteStudyRecords = remoteData.english.studyRecords || [];
            const localStudyRecords = practiceData.english.studyRecords || [];
            const studyRecordMap = {};
            remoteStudyRecords.forEach(r => { studyRecordMap[r.id] = r; });
            localStudyRecords.forEach(r => { studyRecordMap[r.id] = r; }); // local overwrites remote
            remoteData.english.studyRecords = Object.values(studyRecordMap);

            // Merge dictationMaterials
            const remoteDictation = remoteData.english.dictationMaterials || [];
            const localDictation = practiceData.english.dictationMaterials || [];
            const dictationMap = {};
            remoteDictation.forEach(d => { dictationMap[d.id] = d; });
            localDictation.forEach(d => { dictationMap[d.id] = d; });
            remoteData.english.dictationMaterials = Object.values(dictationMap);
          }

          // Merge records
          if (practiceData.records) {
            remoteData.records = { ...remoteData.records, ...practiceData.records };
          }

          // Update local practiceData with merged data
          practiceData = remoteData;
        }

        dataSha = remoteSha;
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
        // Conflict: retry with fresh data
        console.log(`409 conflict, retry ${retryCount + 1}/${MAX_RETRIES}`);
        if (retryCount < MAX_RETRIES) {
          dataSha = null; // Force refresh SHA on next attempt
          return saveData(retryCount + 1);
        } else {
          console.error('Max retries reached for 409 conflict');
          showToast('Failed to save (conflict)', 'error');
          return false;
        }
      }

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Save failed:', res.status, errorText);
        throw new Error(`Failed: ${res.status}`);
      }

      const data = await res.json();
      dataSha = data.content.sha;
      console.log('Save successful, new SHA:', dataSha);
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

  // Contribution Graph (shared across all categories)
  function renderContribGraph() {
    if (!practiceData) return;

    const container = document.getElementById('contrib-graph');
    if (!container) return;

    // Combine records from all categories
    const checksByDate = {};
    let totalPlans = 0;

    CATEGORIES.forEach(cat => {
      const records = practiceData.records[cat.id] || [];
      let plans;
      if (cat.id === 'english') {
        const textbooks = practiceData.english.textbooks || [];
        const pronunciation = practiceData.english.pronunciation || [];
        const dictation = practiceData.english.dictation || [];
        plans = [
          ...textbooks.map(tb => tb.name),
          ...pronunciation.map(p => p.name),
          ...dictation.map(d => d.name)
        ];
      } else {
        plans = practiceData.plans[cat.id] || [];
      }
      totalPlans += plans.length;

      records.forEach(record => {
        const count = (record.completed || []).length;
        checksByDate[record.date] = (checksByDate[record.date] || 0) + count;
      });
    });

    const maxChecks = totalPlans || 1;
    const days = [];
    const today = new Date();
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = getDateKey(d);
      const checks = checksByDate[key] || 0;
      let level = 0;
      if (checks > 0) level = 1;
      if (checks >= maxChecks * 0.33) level = 2;
      if (checks >= maxChecks * 0.66) level = 3;
      if (checks >= maxChecks) level = 4;
      days.push({ key, checks, level });
    }

    container.innerHTML = `
      <div class="contrib-row">
        ${days.map(d => `<div class="contrib-day level-${d.level}" title="${d.key}: ${d.checks}項目"></div>`).join('')}
      </div>
    `;
  }

  // Calendar (shared across all categories)
  function renderCalendar() {
    if (!practiceData) return;

    const monthEl = document.getElementById('calendar-month');
    const gridEl = document.getElementById('calendar-grid');
    if (!monthEl || !gridEl) return;

    monthEl.textContent = `${currentYear}/${currentMonth + 1}`;

    // Combine records from all categories
    const checksByDate = {};
    const categoryByDate = {}; // Track which categories practiced each day

    CATEGORIES.forEach(cat => {
      const records = practiceData.records[cat.id] || [];
      records.forEach(record => {
        const count = (record.completed || []).length;
        if (count > 0) {
          checksByDate[record.date] = (checksByDate[record.date] || 0) + count;
          if (!categoryByDate[record.date]) categoryByDate[record.date] = [];
          if (!categoryByDate[record.date].includes(cat.id)) {
            categoryByDate[record.date].push(cat.id);
          }
        }
      });
    });

    // Add English practice data (Phrases, Pronunciation, Dictation)
    if (practiceData.english) {
      // StudyRecords (Phrases)
      (practiceData.english.studyRecords || []).forEach(r => {
        if (r.date) {
          checksByDate[r.date] = (checksByDate[r.date] || 0) + (r.phraseCount || 1);
          if (!categoryByDate[r.date]) categoryByDate[r.date] = [];
          if (!categoryByDate[r.date].includes('english')) {
            categoryByDate[r.date].push('english');
          }
        }
      });

      // Pronunciation
      (practiceData.english.pronunciation || []).forEach(p => {
        if (p.lastPracticed) {
          checksByDate[p.lastPracticed] = (checksByDate[p.lastPracticed] || 0) + 1;
          if (!categoryByDate[p.lastPracticed]) categoryByDate[p.lastPracticed] = [];
          if (!categoryByDate[p.lastPracticed].includes('english')) {
            categoryByDate[p.lastPracticed].push('english');
          }
        }
        (p.practicedWords || []).forEach(w => {
          if (w.date) {
            checksByDate[w.date] = (checksByDate[w.date] || 0) + 1;
            if (!categoryByDate[w.date]) categoryByDate[w.date] = [];
            if (!categoryByDate[w.date].includes('english')) {
              categoryByDate[w.date].push('english');
            }
          }
        });
      });

      // Dictation
      (practiceData.english.dictationMaterials || []).forEach(m => {
        if (m.lastPracticed) {
          checksByDate[m.lastPracticed] = (checksByDate[m.lastPracticed] || 0) + 1;
          if (!categoryByDate[m.lastPracticed]) categoryByDate[m.lastPracticed] = [];
          if (!categoryByDate[m.lastPracticed].includes('english')) {
            categoryByDate[m.lastPracticed].push('english');
          }
        }
      });
    }

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
      const categories = categoryByDate[dateKey] || [];

      html += `
        <div class="calendar-day ${isToday ? 'today' : ''} ${hasPractice ? 'has-practice' : ''}" data-date="${dateKey}">
          <span class="calendar-day-num">${day}</span>
          ${hasPractice ? `<span class="calendar-day-duration">${checks}✓</span>` : ''}
          ${hasPractice ? `<div class="calendar-day-cats">${categories.map(c => CATEGORIES.find(cat => cat.id === c)?.emoji || '').join('')}</div>` : ''}
        </div>
      `;
    }

    gridEl.innerHTML = html;

    gridEl.querySelectorAll('.calendar-day:not(.empty)').forEach(dayEl => {
      dayEl.addEventListener('click', () => {
        openDayModal(dayEl.dataset.date);
      });
    });

    // Update streak stats
    renderStreakStats();
  }

  // Calculate and render streak statistics
  function renderStreakStats() {
    if (!practiceData) return;

    // Collect all practice dates from all categories
    const practiceDates = new Set();
    CATEGORIES.forEach(cat => {
      const records = practiceData.records[cat.id] || [];
      records.forEach(record => {
        if ((record.completed || []).length > 0) {
          practiceDates.add(record.date);
        }
      });
    });

    // Also include English study records (Quick Response)
    const studyRecords = practiceData.english?.studyRecords || [];
    studyRecords.forEach(record => {
      if (record.date) {
        practiceDates.add(record.date);
      }
    });

    const sortedDates = Array.from(practiceDates).sort().reverse();
    const todayKey = getTodayKey();
    const today = new Date(todayKey);

    // Calculate current streak
    let currentStreak = 0;
    let checkDate = new Date(today);

    // Check if practiced today
    if (practiceDates.has(todayKey)) {
      currentStreak = 1;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      // If not practiced today, start counting from yesterday
      checkDate.setDate(checkDate.getDate() - 1);
    }

    // Count consecutive days backwards
    while (true) {
      const dateKey = getDateKey(checkDate);
      if (practiceDates.has(dateKey)) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    // Calculate best streak
    let bestStreak = 0;
    let tempStreak = 0;
    let prevDate = null;

    sortedDates.reverse().forEach(dateStr => {
      const date = new Date(dateStr);
      if (prevDate) {
        const diffDays = Math.round((date - prevDate) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          tempStreak++;
        } else {
          bestStreak = Math.max(bestStreak, tempStreak);
          tempStreak = 1;
        }
      } else {
        tempStreak = 1;
      }
      prevDate = date;
    });
    bestStreak = Math.max(bestStreak, tempStreak, currentStreak);

    // Count this month's practice days
    const monthStart = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
    const monthEnd = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-31`;
    const monthDays = sortedDates.filter(d => d >= monthStart && d <= monthEnd).length;

    // Total practice days
    const totalDays = practiceDates.size;

    // Update UI
    const currentStreakEl = document.getElementById('current-streak');
    const bestStreakEl = document.getElementById('best-streak');
    const monthDaysEl = document.getElementById('month-days');
    const totalDaysEl = document.getElementById('total-days');
    const messageEl = document.getElementById('streak-message');

    if (currentStreakEl) currentStreakEl.textContent = currentStreak;
    if (bestStreakEl) bestStreakEl.textContent = bestStreak;
    if (monthDaysEl) monthDaysEl.textContent = monthDays;
    if (totalDaysEl) totalDaysEl.textContent = totalDays;

    // Motivational message
    if (messageEl) {
      let message = '';
      if (currentStreak === 0) {
        message = '今日も練習して連続記録を始めよう！ 💪';
      } else if (currentStreak >= 30) {
        message = `🎉 素晴らしい！${currentStreak}日連続達成！`;
      } else if (currentStreak >= 7) {
        message = `🔥 1週間以上継続中！この調子！`;
      } else if (currentStreak >= 3) {
        message = `✨ ${currentStreak}日連続！習慣になってきた！`;
      } else {
        message = `🌱 ${currentStreak}日連続！続けていこう！`;
      }
      messageEl.textContent = message;
    }
  }

  // Today's Checklist
  function renderTodayChecklist() {
    if (!practiceData) return;

    const container = document.getElementById('today-checklist');
    if (!container) return;

    // For English category, use textbooks, pronunciation, and dictation as plans
    let plans;
    if (currentCategory === 'english') {
      const textbooks = practiceData.english.textbooks || [];
      const pronunciation = practiceData.english.pronunciation || [];
      const dictation = practiceData.english.dictation || [];
      plans = [
        ...textbooks.map(tb => tb.name),
        ...pronunciation.map(p => p.name),
        ...dictation.map(d => d.name)
      ];
    } else {
      plans = practiceData.plans[currentCategory] || [];
    }

    const todayKey = getTodayKey();
    const record = getRecord(todayKey) || { date: todayKey, completed: [] };
    const completed = record.completed || [];

    if (plans.length === 0) {
      if (currentCategory === 'english') {
        container.innerHTML = `
          <div class="empty">
            教材がありません。<br>
            <button class="btn btn-primary" id="add-first-textbook" style="margin-top:12px;">教材を追加</button>
          </div>
        `;
        document.getElementById('add-first-textbook')?.addEventListener('click', openTextbookModal);
      } else {
        container.innerHTML = `
          <div class="empty">
            プランがありません。<br>
            <button class="btn btn-primary" id="add-first-plan" style="margin-top:12px;">プランを追加</button>
          </div>
        `;
        document.getElementById('add-first-plan')?.addEventListener('click', openPlansModal);
      }
      return;
    }

    container.innerHTML = `
      <div class="status-list">
        ${plans.map(plan => {
          const isDone = completed.includes(plan);
          return `
            <div class="status-item ${isDone ? 'done' : ''}" data-plan="${plan}">
              <span class="status-badge ${isDone ? 'done' : 'pending'}">${isDone ? '✓' : '-'}</span>
              <span class="status-label">${plan}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;

    container.querySelectorAll('.status-item').forEach(item => {
      item.addEventListener('click', async () => {
        const plan = item.dataset.plan;
        let records = practiceData.records[currentCategory];
        let record = records.find(r => r.date === todayKey);

        if (!record) {
          record = { date: todayKey, completed: [] };
          records.push(record);
        }

        const isDone = record.completed.includes(plan);
        if (isDone) {
          record.completed = record.completed.filter(p => p !== plan);
        } else {
          record.completed.push(plan);
        }

        await saveData();
        renderStats();
        renderContribGraph();
        renderCalendar();
        renderTodayChecklist();
      });
    });
  }

  // Recent Records
  function renderRecentRecords() {
    if (!practiceData) return;

    const container = document.getElementById('practice-list');
    if (!container) return;

    // Combine records from all categories
    const allRecords = [];
    CATEGORIES.forEach(cat => {
      const records = practiceData.records[cat.id] || [];
      records.forEach(record => {
        if ((record.completed || []).length > 0) {
          allRecords.push({
            ...record,
            categoryId: cat.id,
            categoryEmoji: cat.emoji
          });
        }
      });
    });

    allRecords.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recentRecords = allRecords.slice(0, 10);

    if (recentRecords.length === 0) {
      container.innerHTML = '<div class="empty">まだ記録がありません</div>';
      return;
    }

    container.innerHTML = recentRecords.map(record => `
      <div class="practice-item">
        <div class="practice-date">${record.categoryEmoji} ${formatDate(record.date)}</div>
        <div class="practice-content">
          <div class="practice-checks">${(record.completed || []).map(p => `<span class="check-tag">✓ ${p}</span>`).join('')}</div>
        </div>
        <button class="btn btn-sm btn-delete record-delete" data-date="${record.date}" data-category="${record.categoryId}">×</button>
      </div>
    `).join('');

    // Add delete handlers
    container.querySelectorAll('.record-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const date = btn.dataset.date;
        const catId = btn.dataset.category;
        if (!confirm(`${formatDate(date)}の記録を削除しますか？`)) return;

        const records = practiceData.records[catId];
        const idx = records.findIndex(r => r.date === date);
        if (idx >= 0) {
          records.splice(idx, 1);
          await saveData();
          renderAll();
        }
      });
    });
  }

  // Day Modal (for past dates) - shows all categories
  function openDayModal(dateKey) {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    title.textContent = formatDate(dateKey);

    const renderModalContent = () => {
      let html = '';

      CATEGORIES.forEach(cat => {
        let plans;
        if (cat.id === 'english') {
          const textbooks = practiceData.english.textbooks || [];
          const pronunciation = practiceData.english.pronunciation || [];
          const dictation = practiceData.english.dictation || [];
          plans = [
            ...textbooks.map(tb => tb.name),
            ...pronunciation.map(p => p.name),
            ...dictation.map(d => d.name)
          ];
        } else {
          plans = practiceData.plans[cat.id] || [];
        }

        if (plans.length === 0) return;

        const records = practiceData.records[cat.id] || [];
        const record = records.find(r => r.date === dateKey) || { date: dateKey, completed: [] };
        const completed = record.completed || [];

        html += `
          <div class="modal-category-section">
            <div class="modal-category-title">${cat.emoji} ${cat.label}</div>
            <div class="status-list">
              ${plans.map(plan => {
                const isDone = completed.includes(plan);
                return `
                  <div class="status-item ${isDone ? 'done' : ''}" data-plan="${plan}" data-category="${cat.id}">
                    <span class="status-badge ${isDone ? 'done' : 'pending'}">${isDone ? '✓' : '-'}</span>
                    <span class="status-label">${plan}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      });

      if (!html) {
        html = '<div class="empty">プランがありません</div>';
      }

      content.innerHTML = html;

      content.querySelectorAll('.status-item').forEach(item => {
        item.addEventListener('click', async () => {
          const plan = item.dataset.plan;
          const catId = item.dataset.category;
          let records = practiceData.records[catId];
          let record = records.find(r => r.date === dateKey);

          if (!record) {
            record = { date: dateKey, completed: [] };
            records.push(record);
          }

          const isDone = record.completed.includes(plan);
          if (isDone) {
            record.completed = record.completed.filter(p => p !== plan);
          } else {
            record.completed.push(plan);
          }

          await saveData();
          renderModalContent();
          renderAll();
        });
      });
    };

    modal.classList.add('show');
    renderModalContent();
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
  function updateCategoryUI() {
    const subtabs = document.getElementById('english-subtabs');
    const statsRow = document.getElementById('stats-row');
    const contribGraph = document.getElementById('contrib-graph');
    const todaySection = document.querySelector('.today-section');
    const calendarHeader = document.querySelector('.calendar-header');
    const calendarGrid = document.getElementById('calendar-grid');
    const recentTitle = document.getElementById('recent-title');
    const practiceList = document.getElementById('practice-list');
    const plansBtn = document.getElementById('btn-plans');

    // Category-specific sections
    const phrasesSection = document.getElementById('phrases-section');
    const pianoSection = document.getElementById('piano-section');
    const guitarSection = document.getElementById('guitar-section');

    // Hide all category-specific sections first
    subtabs?.classList.remove('show');
    phrasesSection?.classList.remove('show');
    document.getElementById('pronunciation-section')?.classList.remove('show');
    document.getElementById('dictation-section')?.classList.remove('show');
    pianoSection?.classList.remove('show');
    guitarSection?.classList.remove('show');

    if (currentCategory === 'english') {
      subtabs?.classList.add('show');
      if (plansBtn) plansBtn.textContent = '教材';
      showEnglishSubtab(currentEnglishSubtab);
    } else if (currentCategory === 'piano') {
      if (plansBtn) plansBtn.textContent = '教材';
      // Hide standard UI, show piano section
      [statsRow, contribGraph, todaySection, recentTitle, practiceList].forEach(el => {
        if (el) el.style.display = 'none';
      });
      // Keep calendar visible
      if (calendarHeader) calendarHeader.style.display = '';
      if (calendarGrid) calendarGrid.style.display = '';
      pianoSection?.classList.add('show');
      renderPianoTextbooks();
    } else if (currentCategory === 'guitar') {
      if (plansBtn) plansBtn.textContent = '教材';
      // Hide standard UI, show guitar section
      [statsRow, contribGraph, todaySection, recentTitle, practiceList].forEach(el => {
        if (el) el.style.display = 'none';
      });
      // Keep calendar visible
      if (calendarHeader) calendarHeader.style.display = '';
      if (calendarGrid) calendarGrid.style.display = '';
      guitarSection?.classList.add('show');
      renderGuitarTextbooks();
    } else {
      if (plansBtn) plansBtn.textContent = 'Plans';
      // Show standard practice log UI
      statsRow.style.display = '';
      contribGraph.style.display = '';
      todaySection.style.display = '';
      calendarHeader.style.display = '';
      calendarGrid.style.display = '';
      recentTitle.style.display = '';
      practiceList.style.display = '';
    }
  }

  // Alias for backwards compatibility
  function updateEnglishUI() {
    updateCategoryUI();
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
    const pronunciationSection = document.getElementById('pronunciation-section');
    const dictationSection = document.getElementById('dictation-section');
    const meetingSection = document.getElementById('meeting-section');
    const studySection = document.getElementById('study-section');

    // Hide all sections first (hide Today section for English)
    [statsRow, contribGraph, todaySection, calendarHeader, calendarGrid, recentTitle, practiceList].forEach(el => {
      if (el) el.style.display = 'none';
    });
    phrasesSection?.classList.remove('show');
    pronunciationSection?.classList.remove('show');
    dictationSection?.classList.remove('show');
    meetingSection?.classList.remove('show');
    studySection?.classList.remove('show');

    // Update subtab active state
    document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.sub-tab[data-subtab="${subtab}"]`)?.classList.add('active');

    // Show relevant section (English tabs don't show Today/Calendar)
    if (subtab === 'phrases') {
      phrasesSection?.classList.add('show');
      renderPhrases();
    } else if (subtab === 'pronunciation') {
      pronunciationSection?.classList.add('show');
      renderPronunciationLinks();
      renderPronunciation();
    } else if (subtab === 'dictation') {
      dictationSection?.classList.add('show');
      renderMaterials('dictation');
      initDictationPractice();
    } else if (subtab === 'meeting') {
      meetingSection?.classList.add('show');
      renderMeetingPhrases();
      initMeetingPractice();
    } else if (subtab === 'study') {
      studySection?.classList.add('show');
      renderStudyTab();
    }
  }

  // ==================== STUDY TAB ====================

  function renderStudyTab() {
    if (!practiceData) return;

    const studyTextbooks = (practiceData.english.textbooks || []).filter(tb => tb.type === 'study');
    const allPhrases = practiceData.english.phrases || [];

    // Auto-select first textbook if none selected
    if (!studyTabSelectedTextbook && studyTextbooks.length > 0) {
      studyTabSelectedTextbook = studyTextbooks[0].id;
    }

    // Render textbook tabs
    const tabsContainer = document.getElementById('study-textbook-tabs');
    if (tabsContainer) {
      tabsContainer.innerHTML = studyTextbooks.map(tb => {
        const count = allPhrases.filter(p => p.textbookId === tb.id).length;
        return `<button class="study-textbook-tab ${studyTabSelectedTextbook === tb.id ? 'active' : ''}" data-id="${tb.id}">${tb.name} <span style="color:var(--text-muted);font-size:11px;">(${count})</span></button>`;
      }).join('');

      tabsContainer.querySelectorAll('.study-textbook-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          studyTabSelectedTextbook = btn.dataset.id;
          studyTabSelectedChapter = '';
          renderStudyTab();
        });
      });
    }

    // Get phrases for selected textbook
    const tbPhrases = allPhrases.filter(p => p.textbookId === studyTabSelectedTextbook);

    // Get unique chapters
    const chapters = [...new Set(tbPhrases.filter(p => p.chapter).map(p => p.chapter))]
      .sort((a, b) => Number(a) - Number(b));

    // Render chapter nav
    const chapterNav = document.getElementById('study-chapter-nav');
    if (chapterNav && chapters.length > 1) {
      // Find chapter names from the textbook data if available
      const selectedTb = studyTextbooks.find(tb => tb.id === studyTabSelectedTextbook);
      chapterNav.innerHTML = `
        <button class="study-chapter-btn ${!studyTabSelectedChapter ? 'active' : ''}" data-ch="">All</button>
        ${chapters.map(ch => `<button class="study-chapter-btn ${studyTabSelectedChapter === ch ? 'active' : ''}" data-ch="${ch}">Ch.${ch}</button>`).join('')}
      `;
      chapterNav.querySelectorAll('.study-chapter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          studyTabSelectedChapter = btn.dataset.ch;
          renderStudyTab();
        });
      });
    } else if (chapterNav) {
      chapterNav.innerHTML = '';
    }

    // Filter by chapter
    let displayPhrases = tbPhrases;
    if (studyTabSelectedChapter) {
      displayPhrases = tbPhrases.filter(p => p.chapter === studyTabSelectedChapter);
    }

    // Render phrase list
    const listContainer = document.getElementById('study-phrases-list');
    if (listContainer) {
      if (displayPhrases.length === 0) {
        listContainer.innerHTML = '<div class="empty">フレーズがありません</div>';
      } else {
        listContainer.innerHTML = displayPhrases.map(p => {
          const stars = '★'.repeat(p.masteryLevel || 0) + '☆'.repeat(5 - (p.masteryLevel || 0));
          const audioPath = getPhraseAudioPath(p);
          const audioBtn = audioPath ? `<button class="btn-audio study-audio-btn" data-id="${p.id}" title="Play audio">🔊</button>` : '';
          const textbook = studyTextbooks.find(tb => tb.id === p.textbookId);
          const source = textbook ? `${textbook.name}${p.chapter ? ' Ch.' + p.chapter : ''}` : '';
          return `
            <div class="vocab-item">
              <div class="vocab-content">
                <div class="mastery-stars" style="font-size:11px;margin-bottom:2px;">${stars}</div>
                <div class="vocab-japanese">${p.japanese}</div>
                <div class="vocab-english">${p.english}</div>
                ${source ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${source}</div>` : ''}
              </div>
              <div class="vocab-actions">
                ${audioBtn}
              </div>
            </div>
          `;
        }).join('');

        // Audio button handlers
        listContainer.querySelectorAll('.study-audio-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const phrase = allPhrases.find(p => p.id === btn.dataset.id);
            if (phrase) playPhraseAudio(phrase);
          });
        });
      }
    }
  }

  function openStudyTabStudyModal() {
    if (!studyTabSelectedTextbook) {
      showToast('テキストブックを選択してください', 'error');
      return;
    }

    const allPhrases = practiceData.english.phrases || [];
    const tbPhrases = allPhrases.filter(p => p.textbookId === studyTabSelectedTextbook);
    const chapters = [...new Set(tbPhrases.filter(p => p.chapter).map(p => p.chapter))]
      .sort((a, b) => Number(a) - Number(b));
    const textbook = (practiceData.english.textbooks || []).find(tb => tb.id === studyTabSelectedTextbook);

    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    title.textContent = `${textbook?.name || 'Study'} - 暗記モード`;

    let selectedChapters = studyTabSelectedChapter ? [studyTabSelectedChapter] : [];

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">チャプター <span style="font-size:11px;color:var(--text-muted);">(複数選択可)</span></label>
        <div id="study-tab-chapter-chips" style="display:flex;flex-wrap:wrap;gap:8px;min-height:36px;"></div>
      </div>
      <div class="form-group">
        <label class="form-label">出題数</label>
        <select class="form-select" id="study-tab-count">
          <option value="8">8問</option>
          <option value="16">16問</option>
          <option value="all" selected>すべて</option>
        </select>
      </div>
      <div class="study-preview" id="study-tab-preview">対象フレーズ: ${tbPhrases.length}件</div>
      <button class="btn btn-primary" id="study-tab-start" style="width:100%;margin-top:16px;">開始</button>
    `;

    modal.classList.add('show');

    // Render chapter chips
    const chipsContainer = document.getElementById('study-tab-chapter-chips');
    if (chapters.length > 0) {
      chipsContainer.innerHTML = `
        <button type="button" class="chapter-chip ${selectedChapters.length === 0 ? 'selected' : ''}" data-chapter="all">すべて</button>
        ${chapters.map(ch => `<button type="button" class="chapter-chip ${selectedChapters.includes(ch) ? 'selected' : ''}" data-chapter="${ch}">Ch.${ch}</button>`).join('')}
      `;

      const updatePreview = () => {
        let filtered = tbPhrases;
        if (selectedChapters.length > 0) {
          filtered = filtered.filter(p => selectedChapters.includes(p.chapter));
        }
        document.getElementById('study-tab-preview').textContent = `対象フレーズ: ${filtered.length}件`;
      };

      chipsContainer.querySelectorAll('.chapter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const ch = chip.dataset.chapter;
          if (ch === 'all') {
            selectedChapters = [];
            chipsContainer.querySelectorAll('.chapter-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
          } else {
            chipsContainer.querySelector('[data-chapter="all"]')?.classList.remove('selected');
            const idx = selectedChapters.indexOf(ch);
            if (idx >= 0) {
              selectedChapters.splice(idx, 1);
              chip.classList.remove('selected');
              if (selectedChapters.length === 0) {
                chipsContainer.querySelector('[data-chapter="all"]')?.classList.add('selected');
              }
            } else {
              selectedChapters.push(ch);
              chip.classList.add('selected');
            }
          }
          updatePreview();
        });
      });
    }

    document.getElementById('study-tab-start').addEventListener('click', () => {
      activeStudyContainerId = 'study-study-container';
      startStudyMode('chapter', studyTabSelectedTextbook, selectedChapters, document.getElementById('study-tab-count').value, 'japanese');
      modal.classList.remove('show');
    });
  }

  // ==================== DICTATION PRACTICE ====================

  let dictationSegments = [];
  let currentDictationIndex = 0;
  let currentMaterialId = null;

  function initDictationPractice() {
    renderDictationMaterials();

    const saveBtn = document.getElementById('save-material-btn');
    const checkBtn = document.getElementById('check-answer-btn');
    const replayBtn = document.getElementById('replay-btn');
    const prevBtn = document.getElementById('prev-segment-btn');
    const nextBtn = document.getElementById('next-segment-btn');
    const closeBtn = document.getElementById('close-player-btn');

    saveBtn?.addEventListener('click', saveDictationMaterial);
    checkBtn?.addEventListener('click', checkDictationAnswer);
    replayBtn?.addEventListener('click', replayCurrentSegment);
    prevBtn?.addEventListener('click', () => navigateSegment(-1));
    nextBtn?.addEventListener('click', () => navigateSegment(1));
    closeBtn?.addEventListener('click', closeDictationPlayer);
  }

  function renderDictationMaterials() {
    const container = document.getElementById('dictation-saved-list');
    if (!container || !practiceData) return;

    const materials = practiceData.english.dictationMaterials || [];

    if (materials.length === 0) {
      container.innerHTML = '<p class="empty">動画を追加して練習を始めよう</p>';
      return;
    }

    container.innerHTML = materials.map((m, idx) => {
      const videoId = extractVideoId(m.url);
      const thumb = videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : '';
      const practiceCount = m.practiceCount || 0;
      const lastPracticed = m.lastPracticed ? new Date(m.lastPracticed).toLocaleDateString() : '-';

      return `
        <div class="dictation-material-card" onclick="loadDictationMaterial(${idx})">
          <div class="material-thumb">
            ${thumb ? `<img src="${thumb}" alt="">` : ''}
          </div>
          <div class="material-info">
            <div class="material-title">${m.title || 'Untitled'}</div>
            <div class="material-meta">${m.segments?.length || 0} segments • ${practiceCount}回練習 • ${lastPracticed}</div>
          </div>
          <div class="material-actions">
            <button class="btn-icon" onclick="event.stopPropagation(); deleteDictationMaterial(${idx})" title="削除">🗑</button>
          </div>
        </div>
      `;
    }).join('');
  }

  window.loadDictationMaterial = function(index) {
    const materials = practiceData.english.dictationMaterials || [];
    const material = materials[index];
    if (!material) return;

    currentMaterialId = index;
    dictationSegments = material.segments || [];
    currentDictationIndex = 0;

    const videoId = extractVideoId(material.url);
    if (!videoId) {
      showToast('Invalid video URL', 'error');
      return;
    }

    const container = document.getElementById('youtube-player-container');
    const playerSection = document.getElementById('dictation-player');
    const titleEl = document.getElementById('current-material-title');

    container.innerHTML = `<iframe
      id="yt-iframe"
      src="https://www.youtube.com/embed/${videoId}?enablejsapi=1&origin=${window.location.origin}"
      frameborder="0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen></iframe>`;

    titleEl.textContent = material.title || 'Untitled';
    playerSection.style.display = 'block';
    updateSegmentDisplay();

    // Update practice count
    material.practiceCount = (material.practiceCount || 0) + 1;
    material.lastPracticed = getTodayKey();
    saveData();
  };

  window.deleteDictationMaterial = async function(index) {
    if (!confirm('この動画を削除しますか？')) return;

    const materials = practiceData.english.dictationMaterials || [];
    materials.splice(index, 1);
    await saveData();
    renderDictationMaterials();
    showToast('削除しました');
  };

  async function saveDictationMaterial() {
    const titleInput = document.getElementById('new-video-title');
    const urlInput = document.getElementById('youtube-url-input');
    const transcriptInput = document.getElementById('transcript-input');

    const title = titleInput?.value.trim();
    const url = urlInput?.value.trim();
    const transcript = transcriptInput?.value.trim();

    if (!url) {
      showToast('URLを入力してください', 'error');
      return;
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      showToast('無効なYouTube URL', 'error');
      return;
    }

    if (!transcript) {
      showToast('字幕を入力してください', 'error');
      return;
    }

    // Parse transcript
    const segments = parseTranscriptText(transcript);
    if (segments.length === 0) {
      showToast('字幕を解析できませんでした', 'error');
      return;
    }

    // Initialize array if needed
    if (!practiceData.english.dictationMaterials) {
      practiceData.english.dictationMaterials = [];
    }

    // Add material
    practiceData.english.dictationMaterials.push({
      id: Date.now().toString(),
      title: title || `Video ${practiceData.english.dictationMaterials.length + 1}`,
      url: url,
      segments: segments,
      practiceCount: 0,
      lastPracticed: null,
      createdAt: new Date().toISOString()
    });

    await saveData();

    // Clear inputs
    if (titleInput) titleInput.value = '';
    if (urlInput) urlInput.value = '';
    if (transcriptInput) transcriptInput.value = '';

    // Close details
    document.getElementById('dictation-add-new')?.removeAttribute('open');

    renderDictationMaterials();
    showToast(`${segments.length}セグメントを保存しました`);
  }

  function parseTranscriptText(text) {
    const lines = text.split(/[\n\r]+/).filter(line => line.trim());
    const hasTimestamps = lines.some(line => /^\[?\d{1,2}:\d{2}\]?/.test(line.trim()));

    let segments = [];

    if (hasTimestamps) {
      let currentText = '';
      let currentTime = 0;

      lines.forEach(line => {
        const timeMatch = line.match(/^\[?(\d{1,2}):(\d{2})\]?\s*(.*)/);
        if (timeMatch) {
          if (currentText) {
            segments.push({ start: currentTime, text: currentText.trim() });
          }
          currentTime = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
          currentText = timeMatch[3] || '';
        } else {
          currentText += ' ' + line;
        }
      });
      if (currentText) {
        segments.push({ start: currentTime, text: currentText.trim() });
      }
    } else {
      const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
      segments = sentences.map((s, i) => ({
        start: 0,
        text: s.trim()
      })).filter(s => s.text);
    }

    return segments;
  }

  function extractVideoId(url) {
    if (!url) return null;
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\?\/]+)/,
      /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  function updateSegmentDisplay() {
    const segmentLabel = document.getElementById('current-segment');
    if (segmentLabel && dictationSegments.length > 0) {
      segmentLabel.textContent = `${currentDictationIndex + 1} / ${dictationSegments.length}`;
    }

    const input = document.getElementById('dictation-input');
    const result = document.getElementById('dictation-result');
    if (input) input.value = '';
    if (result) result.style.display = 'none';
  }

  function navigateSegment(direction) {
    const newIndex = currentDictationIndex + direction;
    if (newIndex >= 0 && newIndex < dictationSegments.length) {
      currentDictationIndex = newIndex;
      updateSegmentDisplay();
    }
  }

  function checkDictationAnswer() {
    const input = document.getElementById('dictation-input');
    const resultDiv = document.getElementById('dictation-result');
    const correctDiv = document.getElementById('correct-answer');
    const scoreDiv = document.getElementById('result-score');

    if (!dictationSegments.length || currentDictationIndex >= dictationSegments.length) {
      showToast('No segment to check', 'error');
      return;
    }

    const userAnswer = input.value.trim().toLowerCase();
    const correctAnswer = dictationSegments[currentDictationIndex].text;
    const correctLower = correctAnswer.toLowerCase().replace(/[^\w\s']/g, '');

    const userWords = userAnswer.split(/\s+/).filter(w => w);
    const correctWords = correctLower.split(/\s+/).filter(w => w);

    let matches = 0;
    userWords.forEach(word => {
      if (correctWords.includes(word.replace(/[^\w']/g, ''))) matches++;
    });

    const score = correctWords.length > 0 ? Math.round((matches / correctWords.length) * 100) : 0;

    correctDiv.textContent = correctAnswer;
    scoreDiv.textContent = `${score}% (${matches}/${correctWords.length})`;
    scoreDiv.style.color = score >= 80 ? '#4ade80' : score >= 50 ? '#fbbf24' : '#ef4444';
    resultDiv.style.display = 'block';
  }

  function replayCurrentSegment() {
    const iframe = document.getElementById('yt-iframe');
    if (!iframe || !dictationSegments.length) return;

    const segment = dictationSegments[currentDictationIndex];
    const videoId = iframe.src.match(/embed\/([^?]+)/)?.[1];
    if (videoId && segment) {
      const start = segment.start > 0 ? segment.start : 0;
      iframe.src = `https://www.youtube.com/embed/${videoId}?start=${start}&autoplay=1&enablejsapi=1`;
    }
  }

  function closeDictationPlayer() {
    document.getElementById('dictation-player').style.display = 'none';
    document.getElementById('youtube-player-container').innerHTML = '';
    currentMaterialId = null;
    dictationSegments = [];
    currentDictationIndex = 0;
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

  function getStudyTextbookIds() {
    return (practiceData.english.textbooks || [])
      .filter(tb => tb.type === 'study')
      .map(tb => tb.id);
  }

  function renderPhrases() {
    if (!practiceData) return;

    const studyIds = getStudyTextbookIds();
    const phrases = (practiceData.english.phrases || [])
      .filter(p => !studyIds.includes(p.textbookId));
    renderPhraseStats();
    renderPhraseHeatmap();
    renderTextbookList();
    renderPhraseFilters();

    // Apply filters
    let filteredPhrases = phrases;

    // Search filter
    if (phraseSearchQuery) {
      const query = phraseSearchQuery.toLowerCase();
      filteredPhrases = filteredPhrases.filter(p =>
        p.japanese.toLowerCase().includes(query) ||
        p.english.toLowerCase().includes(query)
      );
    }

    // Textbook filter
    if (phraseFilterTextbook) {
      if (phraseFilterTextbook === 'free') {
        filteredPhrases = filteredPhrases.filter(p => !p.textbookId);
      } else {
        filteredPhrases = filteredPhrases.filter(p => p.textbookId === phraseFilterTextbook);
      }
    }

    // Chapter filter
    if (phraseFilterChapter) {
      filteredPhrases = filteredPhrases.filter(p => p.chapter === phraseFilterChapter);
    }

    // Mastery filter
    if (phraseFilterMastery) {
      if (phraseFilterMastery === 'weak') {
        filteredPhrases = filteredPhrases.filter(p => (p.masteryLevel || 0) <= 2);
      } else if (phraseFilterMastery === 'learning') {
        filteredPhrases = filteredPhrases.filter(p => (p.masteryLevel || 0) >= 3 && (p.masteryLevel || 0) <= 4);
      } else if (phraseFilterMastery === 'mastered') {
        filteredPhrases = filteredPhrases.filter(p => (p.masteryLevel || 0) >= 5);
      }
    }

    renderPhrasesList(filteredPhrases);
  }

  // Calculate streak days (includes all English practice: Phrases, Pronunciation, etc.)
  function calculateStreak() {
    const practiceDates = new Set();

    // Add studyRecords dates (Phrases)
    const studyRecords = practiceData.english.studyRecords || [];
    studyRecords.forEach(r => {
      if (r.date) practiceDates.add(r.date);
    });

    // Add pronunciation practice dates
    const pronunciation = practiceData.english.pronunciation || [];
    pronunciation.forEach(p => {
      if (p.lastPracticed) practiceDates.add(p.lastPracticed);
      (p.practicedWords || []).forEach(w => {
        if (w.date) practiceDates.add(w.date);
      });
    });

    // Add dictation practice dates
    const dictationMaterials = practiceData.english.dictationMaterials || [];
    dictationMaterials.forEach(m => {
      if (m.lastPracticed) {
        // Handle both ISO format (legacy) and YYYY-MM-DD format
        const dateStr = m.lastPracticed.length > 10 ? m.lastPracticed.substring(0, 10) : m.lastPracticed;
        practiceDates.add(dateStr);
      }
    });

    if (practiceDates.size === 0) return 0;

    const dates = [...practiceDates].sort().reverse();
    let streak = 0;
    const today = getTodayKey();
    const yesterday = getYesterdayKey();

    // Check if studied today or yesterday
    if (dates[0] !== today && dates[0] !== yesterday) return 0;

    let checkDate = dates[0] === today ? getEffectiveDate(new Date()) : getEffectiveDate(new Date(Date.now() - 86400000));

    for (const dateStr of dates) {
      const expectedDate = getDateKey(checkDate);
      if (dateStr === expectedDate) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (dateStr < expectedDate) {
        break;
      }
    }

    return streak;
  }

  // Calculate monthly phrase count
  function calculateMonthlyPhraseCount() {
    const records = practiceData.english.studyRecords || [];
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    return records
      .filter(r => {
        const d = new Date(r.date);
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .reduce((sum, r) => sum + (r.phraseCount || 0), 0);
  }

  // Calculate mastery rate
  function calculateMasteryRate() {
    const phrases = practiceData.english.phrases || [];
    if (phrases.length === 0) return 0;

    const masteredCount = phrases.filter(p => (p.masteryLevel || 0) >= 4).length;
    return Math.round((masteredCount / phrases.length) * 100);
  }

  // Calculate today's study count
  function calculateTodayStudyCount() {
    const records = practiceData.english.studyRecords || [];
    const today = getTodayKey();
    return records
      .filter(r => r.date === today)
      .reduce((sum, r) => sum + (r.phraseCount || 0), 0);
  }

  // Calculate total study count (all time)
  function calculateTotalStudyCount() {
    const records = practiceData.english.studyRecords || [];
    return records.reduce((sum, r) => sum + (r.phraseCount || 0), 0);
  }

  // Calculate user level based on total study count
  function calculateLevel() {
    const total = calculateTotalStudyCount();
    if (total >= 5000) return { level: 10, title: 'Master', next: null };
    if (total >= 3000) return { level: 9, title: 'Expert', next: 5000 };
    if (total >= 2000) return { level: 8, title: 'Advanced', next: 3000 };
    if (total >= 1500) return { level: 7, title: 'Skilled', next: 2000 };
    if (total >= 1000) return { level: 6, title: 'Intermediate', next: 1500 };
    if (total >= 700) return { level: 5, title: 'Learner', next: 1000 };
    if (total >= 500) return { level: 4, title: 'Explorer', next: 700 };
    if (total >= 300) return { level: 3, title: 'Starter', next: 500 };
    if (total >= 100) return { level: 2, title: 'Beginner', next: 300 };
    return { level: 1, title: 'Rookie', next: 100 };
  }

  // Get motivation message based on streak and study status
  function getMotivationMessage(streak, todayCount) {
    // Messages for starting the day
    if (todayCount === 0) {
      const startMessages = [
        "Let's start today's practice!",
        "Ready to learn something new?",
        "Every phrase counts!",
        "Small steps lead to big progress!",
        "Your future self will thank you!"
      ];
      return startMessages[Math.floor(Math.random() * startMessages.length)];
    }

    // Messages based on streak
    if (streak >= 30) return "🏆 Amazing! 30+ day streak! You're unstoppable!";
    if (streak >= 14) return "🌟 2 weeks strong! Keep the momentum!";
    if (streak >= 7) return "🔥 One week streak! Fantastic dedication!";
    if (streak >= 3) return "✨ Great work! Day " + streak + " streak!";
    if (streak >= 1) return "👍 Nice! Keep it going tomorrow!";

    // General encouragement
    const generalMessages = [
      "Great progress today!",
      "You're doing amazing!",
      "Keep up the excellent work!",
      "Practice makes perfect!"
    ];
    return generalMessages[Math.floor(Math.random() * generalMessages.length)];
  }

  function renderPhraseStats() {
    const container = document.getElementById('phrase-stats');
    if (!container) return;

    const streak = calculateStreak();
    const todayCount = calculateTodayStudyCount();
    const totalStudy = calculateTotalStudyCount();
    const levelInfo = calculateLevel();
    const phrases = practiceData.english.phrases || [];
    const weakCount = phrases.filter(p => (p.masteryLevel || 0) <= 2).length;
    const motivationMsg = getMotivationMessage(streak, todayCount);

    // Daily goal: 24 phrases (3 chapters/day for ~3 weeks completion)
    const dailyGoal = 24;
    const goalProgress = Math.min(100, Math.round((todayCount / dailyGoal) * 100));
    const goalComplete = todayCount >= dailyGoal;

    container.innerHTML = `
      <div class="phrase-stat-badge motivation-badge" style="flex: 2; min-width: 200px;">
        <div style="display: flex; flex-direction: column; width: 100%;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <span class="stat-icon">🎯</span>
            <span style="font-size: 14px; font-weight: 600;">Today: ${todayCount}/${dailyGoal}</span>
            ${goalComplete ? '<span style="color: var(--accent);">Complete!</span>' : ''}
          </div>
          <div style="background: var(--bg-tertiary); height: 6px; border-radius: 3px; overflow: hidden;">
            <div style="width: ${goalProgress}%; height: 100%; background: ${goalComplete ? 'var(--accent)' : 'var(--english)'}; transition: width 0.3s;"></div>
          </div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 8px;">${motivationMsg}</div>
        </div>
      </div>
      <div class="phrase-stat-badge">
        <span class="stat-icon ${streak >= 7 ? 'streak-fire' : ''}">🔥</span>
        <span class="stat-num">${streak}</span>
        <span class="stat-text">Streak</span>
      </div>
      <div class="phrase-stat-badge">
        <span class="stat-icon">⚡</span>
        <span class="stat-num">Lv.${levelInfo.level}</span>
        <span class="stat-text">${levelInfo.title}</span>
      </div>
      <div class="phrase-stat-badge">
        <span class="stat-icon">💪</span>
        <span class="stat-num">${weakCount}</span>
        <span class="stat-text">Weak</span>
      </div>
    `;
  }

  function renderPhraseHeatmap() {
    const container = document.getElementById('phrase-heatmap');
    if (!container) return;

    const records = practiceData.english.studyRecords || [];

    // Build phrase count by date
    const countByDate = {};
    records.forEach(rec => {
      if (!countByDate[rec.date]) countByDate[rec.date] = 0;
      countByDate[rec.date] += rec.phraseCount || 0;
    });

    // Find max for scaling
    const maxCount = Math.max(...Object.values(countByDate), 1);

    // Generate last 90 days
    const days = [];
    const today = new Date();
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = getDateKey(d);
      const count = countByDate[key] || 0;

      let level = 0;
      if (count > 0) level = 1;
      if (count >= maxCount * 0.33) level = 2;
      if (count >= maxCount * 0.66) level = 3;
      if (count >= maxCount) level = 4;

      days.push({ key, count, level });
    }

    container.innerHTML = days.map(d =>
      `<div class="phrase-heatmap-day level-${d.level}" title="${d.key}: ${d.count}フレーズ"></div>`
    ).join('');
  }

  function renderTextbookList() {
    const container = document.getElementById('textbook-list');
    if (!container) return;

    const textbooks = (practiceData.english.textbooks || []).filter(tb => tb.type !== 'study');
    const studyIds = getStudyTextbookIds();
    const phrases = (practiceData.english.phrases || []).filter(p => !studyIds.includes(p.textbookId));

    // Count phrases per textbook
    const freePhraseCount = phrases.filter(p => !p.textbookId).length;

    container.innerHTML = `
      ${textbooks.map(tb => {
        const count = phrases.filter(p => p.textbookId === tb.id).length;
        return `
          <div class="textbook-item" data-id="${tb.id}">
            <span class="textbook-name">${tb.name}</span>
            <span class="textbook-count">(${count})</span>
          </div>
        `;
      }).join('')}
      ${freePhraseCount > 0 ? `
        <div class="textbook-item" data-id="free">
          <span class="textbook-name">自由入力</span>
          <span class="textbook-count">(${freePhraseCount})</span>
        </div>
      ` : ''}
    `;
  }

  function renderPhraseFilters() {
    const textbookSelect = document.getElementById('phrase-filter-textbook');
    const chapterSelect = document.getElementById('phrase-filter-chapter');
    if (!textbookSelect || !chapterSelect) return;

    const textbooks = (practiceData.english.textbooks || []).filter(tb => tb.type !== 'study');
    const studyIds = getStudyTextbookIds();
    const phrases = (practiceData.english.phrases || []).filter(p => !studyIds.includes(p.textbookId));

    // Update textbook filter options
    textbookSelect.innerHTML = `
      <option value="">すべて</option>
      ${textbooks.map(tb => `<option value="${tb.id}" ${phraseFilterTextbook === tb.id ? 'selected' : ''}>${tb.name}</option>`).join('')}
      <option value="free" ${phraseFilterTextbook === 'free' ? 'selected' : ''}>自由入力</option>
    `;

    // Update chapter filter based on selected textbook
    if (phraseFilterTextbook && phraseFilterTextbook !== 'free') {
      // Get unique chapters from phrases for this textbook
      const chapters = [...new Set(
        phrases
          .filter(p => p.textbookId === phraseFilterTextbook && p.chapter)
          .map(p => p.chapter)
      )].sort((a, b) => Number(a) - Number(b));

      chapterSelect.innerHTML = `
        <option value="">すべて</option>
        ${chapters.map(ch => `<option value="${ch}" ${phraseFilterChapter === ch ? 'selected' : ''}>Ch.${ch}</option>`).join('')}
      `;
      chapterSelect.disabled = chapters.length === 0;
    } else {
      chapterSelect.innerHTML = '<option value="">すべて</option>';
      chapterSelect.disabled = true;
      phraseFilterChapter = '';
    }
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

    const allPhrases = practiceData.english.phrases || [];
    const textbooks = practiceData.english.textbooks || [];

    container.innerHTML = phrases.map((phrase) => {
      const realIndex = allPhrases.findIndex(p => p.id === phrase.id);
      const textbook = textbooks.find(tb => tb.id === phrase.textbookId);
      const masteryLevel = phrase.masteryLevel || 0;
      const masteryStars = '★'.repeat(masteryLevel) + '☆'.repeat(5 - masteryLevel);
      const audioPath = getPhraseAudioPath(phrase);

      // Build source label
      let sourceLabel = '';
      if (textbook) {
        sourceLabel = textbook.name + (phrase.chapter ? ` - Ch.${phrase.chapter}` : '');
      } else if (phrase.chapter) {
        sourceLabel = `Ch.${phrase.chapter}`;
      }

      return `
        <div class="vocab-item">
          <div class="phrase-mastery" title="習熟度: ${masteryLevel}/5">${masteryStars}</div>
          <div class="vocab-content">
            <div class="vocab-meaning">${phrase.japanese}</div>
            <div class="vocab-example">${phrase.english}</div>
            ${sourceLabel ? `<div class="phrase-source">${sourceLabel}</div>` : ''}
          </div>
          <div class="vocab-actions">
            ${audioPath ? `<button class="btn btn-sm btn-audio" onclick="playPhraseAudioByIndex(${realIndex})" title="音声を再生">🔊</button>` : ''}
            <button class="btn btn-sm" onclick="editPhrase(${realIndex})">編集</button>
            <button class="btn btn-sm btn-delete" onclick="deletePhrase(${realIndex})">×</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Textbook management modal
  function openTextbookModal() {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    const textbooks = practiceData.english.textbooks || [];
    const phrases = practiceData.english.phrases || [];

    title.textContent = '教材を管理';

    content.innerHTML = `
      <div class="textbooks-manage-list" id="textbooks-manage-list">
        ${textbooks.map((tb, i) => {
          const phraseCount = phrases.filter(p => p.textbookId === tb.id).length;
          return `
            <div class="textbook-manage-item">
              <div class="textbook-manage-info">
                <span class="textbook-manage-name">${tb.name}</span>
                <span class="textbook-manage-chapters">${phraseCount}件のフレーズ</span>
              </div>
              <div class="vocab-actions">
                <button class="btn btn-sm" onclick="editTextbook(${i})">編集</button>
                <button class="btn btn-sm btn-delete" onclick="deleteTextbook(${i})">×</button>
              </div>
            </div>
          `;
        }).join('')}
        ${textbooks.length === 0 ? '<div class="empty">教材がありません</div>' : ''}
      </div>
      <div class="add-plan-row" style="margin-top: 16px;">
        <input type="text" class="form-input" id="new-textbook-name" placeholder="新しい教材名...">
        <button class="btn btn-primary" id="add-textbook-btn">追加</button>
      </div>
    `;

    modal.classList.add('show');

    document.getElementById('add-textbook-btn').addEventListener('click', addTextbook);
    document.getElementById('new-textbook-name').addEventListener('keypress', e => {
      if (e.key === 'Enter') addTextbook();
    });
  }

  async function addTextbook() {
    const input = document.getElementById('new-textbook-name');
    const name = input.value.trim();
    if (!name) return;

    const newTextbook = {
      id: Date.now().toString(),
      name,
      createdAt: getTodayKey()
    };

    practiceData.english.textbooks.push(newTextbook);
    await saveData();
    openTextbookModal(); // Refresh modal
    renderPhrases();
  }

  function openEditTextbookModal(textbook, index) {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    title.textContent = '教材名を編集';

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">教材名</label>
        <input type="text" class="form-input" id="edit-textbook-name" value="${textbook.name}">
      </div>
      <button class="btn btn-primary" id="save-textbook" style="width:100%;margin-top:16px;">保存</button>
    `;

    modal.classList.add('show');

    document.getElementById('save-textbook').addEventListener('click', async () => {
      const name = document.getElementById('edit-textbook-name').value.trim();
      if (!name) {
        showToast('教材名を入力してください', 'error');
        return;
      }

      textbook.name = name;
      practiceData.english.textbooks[index] = textbook;
      await saveData();
      modal.classList.remove('show');
      renderPhrases();
    });
  }

  // Global functions for textbook management
  window.editTextbook = function(index) {
    const textbook = practiceData.english.textbooks[index];
    openEditTextbookModal(textbook, index);
  };

  window.deleteTextbook = async function(index) {
    const textbook = practiceData.english.textbooks[index];
    const phraseCount = (practiceData.english.phrases || []).filter(p => p.textbookId === textbook.id).length;

    let msg = `「${textbook.name}」を削除しますか？`;
    if (phraseCount > 0) {
      msg += `\n\n※ この教材に関連する${phraseCount}件のフレーズは「自由入力」として残ります。`;
    }

    if (!confirm(msg)) return;

    // Update phrases to remove textbook reference
    practiceData.english.phrases = practiceData.english.phrases.map(p => {
      if (p.textbookId === textbook.id) {
        return { ...p, textbookId: null };
      }
      return p;
    });

    practiceData.english.textbooks.splice(index, 1);
    await saveData();
    openTextbookModal();
    renderPhrases();
  };

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

    const textbooks = practiceData.english.textbooks || [];
    const selectedTextbook = textbooks.find(tb => tb.id === phrase?.textbookId);

    title.textContent = phrase ? 'フレーズを編集' : 'フレーズを追加';

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">教材</label>
        <select class="form-select" id="phrase-textbook">
          <option value="">自由入力</option>
          ${textbooks.map(tb => `<option value="${tb.id}" ${phrase?.textbookId === tb.id ? 'selected' : ''}>${tb.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">チャプター</label>
        <input type="number" class="form-input" id="phrase-chapter" value="${phrase?.chapter || ''}" placeholder="1" min="1">
      </div>
      <div class="form-group">
        <label class="form-label">日本語</label>
        <input type="text" class="form-input" id="phrase-japanese" value="${phrase?.japanese || ''}" placeholder="日本語フレーズ">
      </div>
      <div class="form-group">
        <label class="form-label">English</label>
        <input type="text" class="form-input" id="phrase-english" value="${phrase?.english || ''}" placeholder="English phrase">
      </div>
      <button class="btn btn-primary" id="save-phrase" style="width:100%;margin-top:16px;">保存</button>
    `;

    modal.classList.add('show');

    document.getElementById('save-phrase').addEventListener('click', async () => {
      const japanese = document.getElementById('phrase-japanese').value.trim();
      const english = document.getElementById('phrase-english').value.trim();
      const textbookId = document.getElementById('phrase-textbook').value || null;
      const chapter = document.getElementById('phrase-chapter').value.trim() || null;

      if (!japanese || !english) {
        showToast('日本語と英語を入力してください', 'error');
        return;
      }

      const newPhrase = {
        id: phrase?.id || Date.now().toString(),
        japanese,
        english,
        textbookId,
        chapter,
        masteryLevel: phrase?.masteryLevel || 0,
        lastStudied: phrase?.lastStudied || null,
        studyCount: phrase?.studyCount || 0,
        createdAt: phrase?.createdAt || getTodayKey()
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

  // Bulk phrase add modal
  function openBulkPhraseModal() {
    const modal = document.getElementById('edit-modal');
    const modalBox = modal.querySelector('.modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    const textbooks = practiceData.english.textbooks || [];

    // Use wide modal for bulk add
    modalBox.classList.add('wide');

    title.textContent = 'フレーズ一括追加';

    content.innerHTML = `
      <div style="display: flex; gap: 12px; margin-bottom: 12px;">
        <div class="form-group" style="flex: 1; margin-bottom: 0;">
          <label class="form-label">教材</label>
          <select class="form-select" id="bulk-textbook">
            <option value="">自由入力</option>
            ${textbooks.map(tb => `<option value="${tb.id}">${tb.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="width: 100px; margin-bottom: 0;">
          <label class="form-label">Chapter</label>
          <input type="number" class="form-input" id="bulk-chapter" placeholder="1" min="1">
        </div>
      </div>
      <div style="display: flex; gap: 12px;">
        <div class="form-group" style="flex: 1;">
          <label class="form-label">日本語（1行1フレーズ）</label>
          <textarea class="form-textarea" id="bulk-japanese" style="height: 280px; font-size: 13px;" placeholder="彼は会議に遅刻した
それは私には関係ない
できるだけ早く"></textarea>
        </div>
        <div class="form-group" style="flex: 1;">
          <label class="form-label">English（1行1フレーズ）</label>
          <textarea class="form-textarea" id="bulk-english" style="height: 280px; font-size: 13px;" placeholder="He was late for the meeting
It's none of my business
as soon as possible"></textarea>
        </div>
      </div>
      <div class="bulk-preview" id="bulk-preview" style="margin-bottom: 12px;"></div>
      <button class="btn btn-primary" id="save-bulk" style="width:100%;">追加</button>
    `;

    modal.classList.add('show');

    const updatePreview = () => {
      const jpLines = document.getElementById('bulk-japanese').value.split('\n').filter(line => line.trim());
      const enLines = document.getElementById('bulk-english').value.split('\n').filter(line => line.trim());

      const jpCount = jpLines.length;
      const enCount = enLines.length;
      const matchCount = Math.min(jpCount, enCount);

      let previewHtml = `<span style="color: var(--accent);">${matchCount}件</span> 追加可能`;
      if (jpCount !== enCount) {
        previewHtml += ` <span style="color: var(--today);">（日本語: ${jpCount}行, 英語: ${enCount}行）</span>`;
      }
      document.getElementById('bulk-preview').innerHTML = previewHtml;
    };

    document.getElementById('bulk-japanese').addEventListener('input', updatePreview);
    document.getElementById('bulk-english').addEventListener('input', updatePreview);

    document.getElementById('save-bulk').addEventListener('click', async () => {
      const textbookId = document.getElementById('bulk-textbook').value || null;
      const chapter = document.getElementById('bulk-chapter').value || null;
      const jpLines = document.getElementById('bulk-japanese').value.split('\n').filter(line => line.trim());
      const enLines = document.getElementById('bulk-english').value.split('\n').filter(line => line.trim());

      const newPhrases = [];
      const count = Math.min(jpLines.length, enLines.length);

      for (let i = 0; i < count; i++) {
        newPhrases.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          japanese: jpLines[i].trim(),
          english: enLines[i].trim(),
          textbookId,
          chapter,
          masteryLevel: 0,
          lastStudied: null,
          studyCount: 0,
          createdAt: getTodayKey()
        });
      }

      if (newPhrases.length === 0) {
        showToast('追加できるフレーズがありません', 'error');
        return;
      }

      practiceData.english.phrases.push(...newPhrases);
      await saveData();
      modal.classList.remove('show');
      modalBox.classList.remove('wide');
      shuffledPhrases = [...practiceData.english.phrases];
      currentPhraseIndex = 0;
      isCardFlipped = false;
      renderPhrases();
      showToast(`${newPhrases.length}件のフレーズを追加しました`);
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

  window.playPhraseAudioByIndex = function(index) {
    playPhraseAudioByIndex(index);
  };

  // ==================== STUDY MODE FUNCTIONS ====================

  // Get start study motivational message
  function getStartStudyMessage() {
    const streak = calculateStreak();
    const todayCount = calculateTodayStudyCount();
    const levelInfo = calculateLevel();

    if (todayCount === 0) {
      const messages = [
        "Ready to learn? Let's go!",
        "Time to power up your English!",
        "Every phrase makes you stronger!",
        "Today's journey starts now!"
      ];
      return messages[Math.floor(Math.random() * messages.length)];
    }

    if (streak >= 7) {
      return `${streak} day streak! Keep the fire burning!`;
    }

    const messages = [
      `Already studied ${todayCount} today! Keep going!`,
      "Great momentum! Let's learn more!",
      `Level ${levelInfo.level} ${levelInfo.title} - aim higher!`
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  function openStudyModeModal() {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    const studyIds = getStudyTextbookIds();
    const textbooks = (practiceData.english.textbooks || []).filter(tb => tb.type !== 'study');
    const phrases = (practiceData.english.phrases || []).filter(p => !studyIds.includes(p.textbookId));
    const startMessage = getStartStudyMessage();
    const streak = calculateStreak();
    const todayCount = calculateTodayStudyCount();

    title.textContent = '暗記モード設定';

    content.innerHTML = `
      <div style="background: linear-gradient(135deg, rgba(0, 188, 212, 0.1) 0%, rgba(0, 188, 212, 0.05) 100%); border-radius: 10px; padding: 14px; margin-bottom: 16px; text-align: center;">
        <div style="font-size: 18px; margin-bottom: 4px;">${startMessage}</div>
        <div style="font-size: 12px; color: var(--text-muted);">🔥 ${streak} day streak · 📚 ${todayCount} studied today</div>
      </div>
      <div class="form-group">
        <label class="form-label">学習モード</label>
        <div class="study-mode-options">
          <label class="study-mode-option ${lastStudyMode === 'chapter' ? 'selected' : ''}" data-mode="chapter">
            <input type="radio" name="study-mode" value="chapter" ${lastStudyMode === 'chapter' ? 'checked' : ''}>
            <span class="study-mode-icon">📖</span>
            <div class="study-mode-info">
              <div class="study-mode-name">チャプター別</div>
              <div class="study-mode-desc">特定の教材・チャプターから出題</div>
            </div>
          </label>
          <label class="study-mode-option ${lastStudyMode === 'random' ? 'selected' : ''}" data-mode="random">
            <input type="radio" name="study-mode" value="random" ${lastStudyMode === 'random' ? 'checked' : ''}>
            <span class="study-mode-icon">🔀</span>
            <div class="study-mode-info">
              <div class="study-mode-name">ランダム</div>
              <div class="study-mode-desc">全てのフレーズからランダム出題</div>
            </div>
          </label>
          <label class="study-mode-option ${lastStudyMode === 'weak' ? 'selected' : ''}" data-mode="weak">
            <input type="radio" name="study-mode" value="weak" ${lastStudyMode === 'weak' ? 'checked' : ''}>
            <span class="study-mode-icon">💪</span>
            <div class="study-mode-info">
              <div class="study-mode-name">苦手優先</div>
              <div class="study-mode-desc">習熟度が低いものを優先</div>
            </div>
          </label>
        </div>
      </div>
      <div class="form-group" id="textbook-select-group" style="${lastStudyMode !== 'chapter' ? 'display:none' : ''}">
        <label class="form-label">教材</label>
        <select class="form-select" id="study-textbook">
          <option value="" ${lastStudyTextbook === '' ? 'selected' : ''}>すべて</option>
          ${textbooks.map(tb => `<option value="${tb.id}" ${lastStudyTextbook === tb.id ? 'selected' : ''}>${tb.name}</option>`).join('')}
          <option value="free" ${lastStudyTextbook === 'free' ? 'selected' : ''}>自由入力</option>
        </select>
      </div>
      <div class="form-group" id="chapter-select-group" style="${lastStudyMode !== 'chapter' ? 'display:none' : ''}">
        <label class="form-label">チャプター <span style="font-size:11px;color:var(--text-muted);">(複数選択可)</span></label>
        <div id="chapter-chips" style="display:flex;flex-wrap:wrap;gap:8px;min-height:36px;"></div>
      </div>
      <div class="form-group">
        <label class="form-label">出題数</label>
        <select class="form-select" id="study-count">
          <option value="8" ${lastStudyCount === '8' ? 'selected' : ''}>8問 (1チャプター)</option>
          <option value="16" ${lastStudyCount === '16' ? 'selected' : ''}>16問 (2チャプター)</option>
          <option value="24" ${lastStudyCount === '24' ? 'selected' : ''}>24問 (3チャプター)</option>
          <option value="32" ${lastStudyCount === '32' ? 'selected' : ''}>32問 (4チャプター)</option>
          <option value="all" ${lastStudyCount === 'all' ? 'selected' : ''}>すべて</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">出題形式</label>
        <div class="study-mode-options">
          <label class="study-mode-option ${lastQuestionStyle === 'situation' ? 'selected' : ''}" data-style="situation">
            <input type="radio" name="question-style" value="situation" ${lastQuestionStyle === 'situation' ? 'checked' : ''}>
            <span class="study-mode-icon">📍</span>
            <div class="study-mode-info">
              <div class="study-mode-name">シチュエーション</div>
              <div class="study-mode-desc">場面から英語を考える</div>
            </div>
          </label>
          <label class="study-mode-option ${lastQuestionStyle === 'japanese' ? 'selected' : ''}" data-style="japanese">
            <input type="radio" name="question-style" value="japanese" ${lastQuestionStyle === 'japanese' ? 'checked' : ''}>
            <span class="study-mode-icon">🇯🇵</span>
            <div class="study-mode-info">
              <div class="study-mode-name">日本語</div>
              <div class="study-mode-desc">日本語から英語に翻訳</div>
            </div>
          </label>
        </div>
      </div>
      <div class="study-preview" id="study-preview">
        対象フレーズ: ${phrases.length}件
      </div>
      <button class="btn btn-primary" id="start-study" style="width:100%;margin-top:16px;">開始</button>
    `;

    modal.classList.add('show');

    // Track selected chapters
    let selectedChapters = [...lastStudyChapters];

    // Update preview count (defined first so updateChapterChips can call it)
    const updatePreview = () => {
      const mode = document.querySelector('input[name="study-mode"]:checked').value;
      const textbookId = document.getElementById('study-textbook').value;

      let filtered = [...phrases];

      if (mode === 'chapter') {
        if (textbookId === 'free') {
          filtered = filtered.filter(p => !p.textbookId);
        } else if (textbookId) {
          filtered = filtered.filter(p => p.textbookId === textbookId);
        }
        // Apply chapter filter (works for both specific textbook and "すべて")
        if (selectedChapters.length > 0) {
          filtered = filtered.filter(p => selectedChapters.includes(p.chapter));
        }
      } else if (mode === 'weak') {
        filtered = filtered.filter(p => (p.masteryLevel || 0) < 4);
        filtered.sort((a, b) => (a.masteryLevel || 0) - (b.masteryLevel || 0));
      }

      document.getElementById('study-preview').textContent = `対象フレーズ: ${filtered.length}件`;
    };

    // Update chapter chips when textbook changes
    const updateChapterChips = () => {
      const textbookId = document.getElementById('study-textbook').value;
      const chipsContainer = document.getElementById('chapter-chips');

      if (textbookId !== 'free') {
        // Get unique chapters from phrases for this textbook (or all if no textbook selected)
        const chapters = [...new Set(
          phrases
            .filter(p => {
              if (!p.chapter) return false;
              if (textbookId === '') return true; // Show all chapters when "すべて" is selected
              return p.textbookId === textbookId;
            })
            .map(p => p.chapter)
        )].sort((a, b) => Number(a) - Number(b));

        if (chapters.length > 0) {
          chipsContainer.innerHTML = `
            <button type="button" class="chapter-chip ${selectedChapters.length === 0 ? 'selected' : ''}" data-chapter="all">すべて</button>
            ${chapters.map(ch => `<button type="button" class="chapter-chip ${selectedChapters.includes(ch) ? 'selected' : ''}" data-chapter="${ch}">Ch.${ch}</button>`).join('')}
          `;

          // Add click handlers
          chipsContainer.querySelectorAll('.chapter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
              const chapter = chip.dataset.chapter;
              if (chapter === 'all') {
                selectedChapters.length = 0; // Clear array in place
                chipsContainer.querySelectorAll('.chapter-chip').forEach(c => c.classList.remove('selected'));
                chip.classList.add('selected');
              } else {
                // Remove 'all' selection
                chipsContainer.querySelector('[data-chapter="all"]')?.classList.remove('selected');
                // Toggle this chapter
                const idx = selectedChapters.indexOf(chapter);
                if (idx >= 0) {
                  selectedChapters.splice(idx, 1); // Remove in place
                  chip.classList.remove('selected');
                  // If none selected, select 'all'
                  if (selectedChapters.length === 0) {
                    chipsContainer.querySelector('[data-chapter="all"]')?.classList.add('selected');
                  }
                } else {
                  selectedChapters.push(chapter);
                  chip.classList.add('selected');
                }
              }
              updatePreview();
            });
          });
        } else {
          chipsContainer.innerHTML = '<span style="color:var(--text-muted);font-size:13px;">チャプターなし</span>';
        }
      } else {
        chipsContainer.innerHTML = '';
        selectedChapters.length = 0; // Clear array in place
      }
      updatePreview();
    };

    // Initialize chapter chips
    updateChapterChips();

    // Mode selection (chapter/random/weak)
    content.querySelectorAll('.study-mode-option[data-mode]').forEach(option => {
      option.addEventListener('click', () => {
        // Only affect options with data-mode attribute
        content.querySelectorAll('.study-mode-option[data-mode]').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        option.querySelector('input').checked = true;

        const mode = option.dataset.mode;
        const textbookGroup = document.getElementById('textbook-select-group');
        const chapterGroup = document.getElementById('chapter-select-group');

        if (mode === 'chapter') {
          textbookGroup.style.display = '';
          chapterGroup.style.display = '';
        } else {
          textbookGroup.style.display = 'none';
          chapterGroup.style.display = 'none';
        }

        updatePreview();
      });
    });

    document.getElementById('study-textbook').addEventListener('change', () => {
      selectedChapters.length = 0; // Clear array in place
      updateChapterChips();
    });

    // Question style option listeners (situation/japanese)
    content.querySelectorAll('.study-mode-option[data-style]').forEach(option => {
      option.addEventListener('click', () => {
        // Only affect options with data-style attribute
        content.querySelectorAll('.study-mode-option[data-style]').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        option.querySelector('input').checked = true;
      });
    });

    document.getElementById('start-study').addEventListener('click', () => {
      const mode = document.querySelector('input[name="study-mode"]:checked').value;
      const textbookId = document.getElementById('study-textbook').value;
      const chapters = [...selectedChapters];
      const countValue = document.getElementById('study-count').value;
      const style = document.querySelector('input[name="question-style"]:checked').value;

      activeStudyContainerId = 'study-mode-container';
      startStudyMode(mode, textbookId, chapters, countValue, style);
      modal.classList.remove('show');
    });
  }

  function startStudyMode(mode, textbookId, chapters, countValue, style = 'japanese') {
    // Save settings for next time
    lastStudyMode = mode;
    lastStudyTextbook = textbookId;
    lastStudyChapters = Array.isArray(chapters) ? chapters : [];
    lastStudyCount = countValue;
    lastQuestionStyle = style;
    questionStyle = style;

    const phrases = practiceData.english.phrases || [];
    let filtered = [...phrases];

    // Apply filters based on mode
    if (mode === 'chapter') {
      if (textbookId === 'free') {
        filtered = filtered.filter(p => !p.textbookId);
      } else if (textbookId) {
        filtered = filtered.filter(p => p.textbookId === textbookId);
      }
      // Apply chapter filter (works for both specific textbook and "すべて")
      if (chapters && chapters.length > 0) {
        filtered = filtered.filter(p => chapters.includes(p.chapter));
      }
    } else if (mode === 'weak') {
      filtered = filtered.filter(p => (p.masteryLevel || 0) < 4);
      filtered.sort((a, b) => (a.masteryLevel || 0) - (b.masteryLevel || 0));
    }

    if (filtered.length === 0) {
      showToast('対象のフレーズがありません', 'error');
      return;
    }

    // Apply count limit
    let count = countValue === 'all' ? filtered.length : parseInt(countValue);
    count = Math.min(count, filtered.length);

    // Shuffle and slice
    if (mode !== 'weak') {
      filtered = shuffleArray(filtered);
    }
    filtered = filtered.slice(0, count);

    // Set study state
    studyMode = mode;
    studyPhrases = filtered;
    studyIndex = 0;
    studyResults = [];
    studyStartTime = Date.now();
    selectedTextbookId = textbookId;
    selectedChapter = chapters.length > 0 ? chapters.join(',') : null;

    // Show motivational toast
    const startMessages = [
      "Let's do this!",
      "You've got this!",
      "Time to level up!",
      "Focus mode: ON!"
    ];
    showToast(startMessages[Math.floor(Math.random() * startMessages.length)]);

    // Show study mode UI
    renderStudyMode();
  }

  function renderStudyMode() {
    const container = document.getElementById(activeStudyContainerId);
    if (!container) return;

    const phrase = studyPhrases[studyIndex];
    const progress = ((studyIndex) / studyPhrases.length) * 100;
    const textbook = practiceData.english.textbooks?.find(tb => tb.id === phrase?.textbookId);
    const isFlipped = isCardFlipped;

    let modeTitle = '暗記モード';
    if (studyMode === 'chapter' && textbook) {
      modeTitle = textbook.name + (phrase.chapter ? ` - Ch.${phrase.chapter}` : '');
    } else if (studyMode === 'weak') {
      modeTitle = '苦手優先モード';
    } else if (studyMode === 'random') {
      modeTitle = 'ランダムモード';
    }

    // Determine what to show based on question style and flip state
    const isSituationMode = questionStyle === 'situation';
    const questionText = isSituationMode
      ? (phrase.situation || phrase.japanese)  // fallback to japanese if no situation
      : phrase.japanese;
    const questionIcon = isSituationMode ? '📍' : '';
    const frontHint = isSituationMode ? 'この場面で使う英語は？' : 'タップして英語を見る';
    const backHint = 'タップして問題に戻る';

    // Get audio path for this phrase
    const audioPath = getPhraseAudioPath(phrase);

    container.innerHTML = `
      <div class="study-header">
        <div class="study-title">${modeTitle}</div>
        <button class="btn btn-sm" id="exit-study">✕ 終了</button>
      </div>
      <div class="study-progress-bar">
        <div class="study-progress-fill" style="width: ${progress}%"></div>
      </div>
      <div class="study-card-container">
        <div class="study-card ${isFlipped ? 'flipped' : ''}" id="study-card">
          ${isFlipped ? `
            <div class="study-card-text">${phrase.english}</div>
            ${audioPath ? `<button class="btn audio-play-btn" id="play-audio" title="音声を再生">🔊</button>` : ''}
            <div style="font-size: 14px; color: var(--text-muted); margin-top: 16px;">${phrase.japanese}</div>
          ` : `
            <div style="font-size: 16px; margin-bottom: 12px;">${questionIcon}</div>
            <div class="study-card-text">${questionText}</div>
          `}
          <div class="study-card-hint">${isFlipped ? backHint : frontHint}</div>
          <div class="study-card-meta">${studyIndex + 1} / ${studyPhrases.length}</div>
        </div>
        <div class="study-buttons">
          <button class="btn study-btn ng" id="study-ng">✗ 覚えてない</button>
          <button class="btn study-btn partial" id="study-partial">△ 曖昧</button>
          <button class="btn study-btn ok" id="study-ok">○ OK</button>
        </div>
      </div>
    `;

    container.style.display = 'block';

    // Event listeners
    document.getElementById('study-card').addEventListener('click', (e) => {
      // Don't flip if clicking the audio button
      if (e.target.id === 'play-audio') return;
      isCardFlipped = !isCardFlipped;
      renderStudyMode();
    });

    // Audio play button
    const playBtn = document.getElementById('play-audio');
    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playPhraseAudio(phrase);
      });
    }

    document.getElementById('study-ng').addEventListener('click', () => submitStudyAnswer('ng'));
    document.getElementById('study-partial').addEventListener('click', () => submitStudyAnswer('partial'));
    document.getElementById('study-ok').addEventListener('click', () => submitStudyAnswer('ok'));
    document.getElementById('exit-study').addEventListener('click', exitStudyMode);
  }

  async function submitStudyAnswer(result) {
    const phrase = studyPhrases[studyIndex];
    if (!phrase) return; // Already finished or invalid index

    // Record result
    studyResults.push({
      phraseId: phrase.id,
      result
    });

    // Update phrase mastery
    const phraseIndex = practiceData.english.phrases.findIndex(p => p.id === phrase.id);
    if (phraseIndex >= 0) {
      const p = practiceData.english.phrases[phraseIndex];
      let masteryDelta = 0;
      if (result === 'ok') masteryDelta = 1;
      else if (result === 'partial') masteryDelta = 0;
      else if (result === 'ng') masteryDelta = -1;

      p.masteryLevel = Math.max(0, Math.min(5, (p.masteryLevel || 0) + masteryDelta));
      p.lastStudied = getTodayKey();
      p.studyCount = (p.studyCount || 0) + 1;
    }

    // Move to next or show results
    studyIndex++;
    isCardFlipped = false;

    if (studyIndex >= studyPhrases.length) {
      await finishStudyMode();
    } else {
      renderStudyMode();
    }
  }

  async function finishStudyMode() {
    const duration = Math.round((Date.now() - studyStartTime) / 1000);

    // Count results
    const okCount = studyResults.filter(r => r.result === 'ok').length;
    const partialCount = studyResults.filter(r => r.result === 'partial').length;
    const ngCount = studyResults.filter(r => r.result === 'ng').length;

    // Save study record
    const record = {
      id: Date.now().toString(),
      date: getTodayKey(),
      mode: studyMode,
      textbookId: selectedTextbookId || null,
      chapter: selectedChapter || null,
      phraseCount: studyPhrases.length,
      correctCount: okCount,
      duration
    };

    practiceData.english.studyRecords.push(record);
    await saveData();

    // Show results
    renderStudyResults(okCount, partialCount, ngCount, duration);
  }

  // Get celebration message based on performance
  function getCelebrationMessage(percentage, streak) {
    if (percentage === 100) {
      const perfectMessages = [
        "🎉 Perfect! You're on fire!",
        "💯 Flawless! Absolutely amazing!",
        "🌟 100%! You're a superstar!",
        "🏆 Perfect score! Incredible!"
      ];
      return perfectMessages[Math.floor(Math.random() * perfectMessages.length)];
    }
    if (percentage >= 80) {
      const greatMessages = [
        "🎊 Excellent work!",
        "⭐ Great job!",
        "🙌 Awesome performance!",
        "💪 You're getting stronger!"
      ];
      return greatMessages[Math.floor(Math.random() * greatMessages.length)];
    }
    if (percentage >= 60) {
      const goodMessages = [
        "👍 Good effort!",
        "📈 You're improving!",
        "✨ Keep practicing!",
        "💡 Almost there!"
      ];
      return goodMessages[Math.floor(Math.random() * goodMessages.length)];
    }
    const encourageMessages = [
      "🌱 Every practice counts!",
      "💪 Don't give up!",
      "📚 Review and try again!",
      "🎯 Focus on the weak ones!"
    ];
    return encourageMessages[Math.floor(Math.random() * encourageMessages.length)];
  }

  function renderStudyResults(okCount, partialCount, ngCount, duration) {
    const container = document.getElementById(activeStudyContainerId);
    if (!container) return;

    const total = studyPhrases.length;
    const percentage = Math.round((okCount / total) * 100);
    const streak = calculateStreak();
    const celebrationMsg = getCelebrationMessage(percentage, streak);
    const todayTotal = calculateTodayStudyCount();
    const levelInfo = calculateLevel();

    // Get phrases that need review (ng and partial)
    const reviewPhrases = studyResults
      .filter(r => r.result !== 'ok')
      .map(r => {
        const phrase = studyPhrases.find(p => p.id === r.phraseId);
        return { ...phrase, result: r.result };
      });

    container.innerHTML = `
      <div class="study-header">
        <div class="study-title">学習完了</div>
        <button class="btn btn-sm" id="close-results">✕ 閉じる</button>
      </div>
      <div class="study-result">
        <div class="study-result-header">
          <div style="font-size: 24px; margin-bottom: 12px;">${celebrationMsg}</div>
          <div class="study-result-score">${percentage}%</div>
          <div class="study-result-label">${total}問中 ${okCount}問正解</div>
          <div style="margin-top: 12px; display: flex; gap: 16px; justify-content: center;">
            <span style="font-size: 13px; color: var(--text-muted);">🔥 ${streak} Day Streak</span>
            <span style="font-size: 13px; color: var(--text-muted);">📚 Today: ${todayTotal}</span>
            <span style="font-size: 13px; color: var(--text-muted);">⚡ Lv.${levelInfo.level}</span>
          </div>
        </div>
        <div class="study-result-stats">
          <div class="study-result-stat">
            <div class="study-result-stat-value ok">${okCount}</div>
            <div class="study-result-stat-label">覚えた</div>
          </div>
          <div class="study-result-stat">
            <div class="study-result-stat-value partial">${partialCount}</div>
            <div class="study-result-stat-label">曖昧</div>
          </div>
          <div class="study-result-stat">
            <div class="study-result-stat-value ng">${ngCount}</div>
            <div class="study-result-stat-label">覚えてない</div>
          </div>
        </div>
        <div class="study-result-label" style="text-align: center; margin-bottom: 20px;">
          学習時間: ${Math.floor(duration / 60)}分${duration % 60}秒
        </div>
        ${reviewPhrases.length > 0 ? `
          <div class="section-title">復習リスト</div>
          <div class="study-result-list">
            ${reviewPhrases.map(p => `
              <div class="study-result-item">
                <span class="study-result-icon">${p.result === 'ng' ? '✗' : '△'}</span>
                <div class="study-result-content">
                  <div class="study-result-jp">${p.japanese}</div>
                  <div class="study-result-en">${p.english}</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
        <button class="btn btn-primary" id="study-again" style="width:100%;margin-top:20px;">もう一度学習</button>
      </div>
    `;

    document.getElementById('close-results').addEventListener('click', exitStudyMode);
    document.getElementById('study-again').addEventListener('click', () => {
      exitStudyMode();
      openStudyModeModal();
    });
  }

  function exitStudyMode() {
    const container = document.getElementById(activeStudyContainerId);
    if (container) {
      container.style.display = 'none';
    }

    // Reset state
    const wasStudyTab = activeStudyContainerId === 'study-study-container';
    studyMode = null;
    studyPhrases = [];
    studyIndex = 0;
    studyResults = [];
    studyStartTime = null;
    isCardFlipped = false;
    activeStudyContainerId = 'study-mode-container';

    // Refresh display
    if (wasStudyTab) {
      renderStudyTab();
    } else {
      renderPhrases();
    }
  }

  // ==================== PHONEME PRONUNCIATION FUNCTIONS ====================

  // Complete 48 phonemes: 24 vowels + 24 consonants
  // Based on https://hatuonpls.com/minikouza/hatsuon/
  const PHONEME_PRESETS = {
    vowels: [
      // Short vowels (7)
      { phoneme: '/ɑ/', name: 'ɑ (hot)', examples: ['hot', 'pot', 'stop'] },
      { phoneme: '/æ/', name: 'æ (cat)', examples: ['cat', 'hat', 'map'] },
      { phoneme: '/ʌ/', name: 'ʌ (cup)', examples: ['cup', 'but', 'sun'] },
      { phoneme: '/ə/', name: 'ə (about)', examples: ['about', 'sofa', 'banana'] },
      { phoneme: '/ɪ/', name: 'ɪ (sit)', examples: ['sit', 'bit', 'hit'] },
      { phoneme: '/ʊ/', name: 'ʊ (look)', examples: ['look', 'book', 'put'] },
      { phoneme: '/e/', name: 'e (bed)', examples: ['bed', 'best', 'egg'] },
      // Long vowels (5)
      { phoneme: '/iː/', name: 'iː (eat)', examples: ['eat', 'see', 'feet'] },
      { phoneme: '/uː/', name: 'uː (soon)', examples: ['soon', 'too', 'food'] },
      { phoneme: '/ɔː/', name: 'ɔː (walk)', examples: ['walk', 'call', 'law'] },
      { phoneme: '/ɜː/', name: 'ɜː (bird)', examples: ['bird', 'word', 'learn'] },
      { phoneme: '/ɑː/', name: 'ɑː (star)', examples: ['star', 'car', 'far'] },
      // Diphthongs (6)
      { phoneme: '/aɪ/', name: 'aɪ (my)', examples: ['my', 'nice', 'time'] },
      { phoneme: '/eɪ/', name: 'eɪ (day)', examples: ['day', 'may', 'say'] },
      { phoneme: '/ɔɪ/', name: 'ɔɪ (boy)', examples: ['boy', 'oil', 'coin'] },
      { phoneme: '/aʊ/', name: 'aʊ (now)', examples: ['now', 'how', 'out'] },
      { phoneme: '/oʊ/', name: 'oʊ (go)', examples: ['go', 'know', 'show'] },
      { phoneme: '/ju/', name: 'ju (use)', examples: ['use', 'new', 'few'] },
      // R-colored vowels (6)
      { phoneme: '/ɑːr/', name: 'ɑːr (car)', examples: ['car', 'star', 'far'] },
      { phoneme: '/ɔːr/', name: 'ɔːr (door)', examples: ['door', 'more', 'floor'] },
      { phoneme: '/ɜːr/', name: 'ɜːr (word)', examples: ['word', 'work', 'first'] },
      { phoneme: '/ɪr/', name: 'ɪr (near)', examples: ['near', 'hear', 'beer'] },
      { phoneme: '/ʊr/', name: 'ʊr (tour)', examples: ['tour', 'poor', 'sure'] },
      { phoneme: '/er/', name: 'er (care)', examples: ['care', 'where', 'air'] },
    ],
    consonants: [
      // Plosives (6)
      { phoneme: '/p/', name: 'p', examples: ['pen', 'stop', 'top'] },
      { phoneme: '/b/', name: 'b', examples: ['bad', 'cab', 'big'] },
      { phoneme: '/t/', name: 't', examples: ['ten', 'top', 'cat'] },
      { phoneme: '/d/', name: 'd', examples: ['day', 'did', 'bad'] },
      { phoneme: '/k/', name: 'k', examples: ['cat', 'back', 'kick'] },
      { phoneme: '/g/', name: 'g', examples: ['got', 'big', 'go'] },
      // Fricatives (9)
      { phoneme: '/f/', name: 'f', examples: ['fish', 'life', 'fat'] },
      { phoneme: '/v/', name: 'v', examples: ['very', 'love', 'have'] },
      { phoneme: '/θ/', name: 'θ (think)', examples: ['think', 'three', 'bath'] },
      { phoneme: '/ð/', name: 'ð (this)', examples: ['this', 'that', 'the'] },
      { phoneme: '/s/', name: 's', examples: ['see', 'bus', 'miss'] },
      { phoneme: '/z/', name: 'z', examples: ['zoo', 'buzz', 'is'] },
      { phoneme: '/ʃ/', name: 'ʃ (she)', examples: ['she', 'show', 'fish'] },
      { phoneme: '/ʒ/', name: 'ʒ (vision)', examples: ['vision', 'measure', 'pleasure'] },
      { phoneme: '/h/', name: 'h', examples: ['hat', 'hot', 'who'] },
      // Affricates (2)
      { phoneme: '/tʃ/', name: 'tʃ (church)', examples: ['church', 'watch', 'much'] },
      { phoneme: '/dʒ/', name: 'dʒ (judge)', examples: ['judge', 'job', 'age'] },
      // Nasals (3)
      { phoneme: '/m/', name: 'm', examples: ['man', 'mom', 'swim'] },
      { phoneme: '/n/', name: 'n', examples: ['no', 'sun', 'win'] },
      { phoneme: '/ŋ/', name: 'ŋ (sing)', examples: ['sing', 'ring', 'long'] },
      // Approximants (4)
      { phoneme: '/l/', name: 'l', examples: ['light', 'ball', 'feel'] },
      { phoneme: '/r/', name: 'r', examples: ['red', 'right', 'car'] },
      { phoneme: '/w/', name: 'w', examples: ['water', 'we', 'away'] },
      { phoneme: '/j/', name: 'j (yes)', examples: ['yes', 'you', 'yellow'] },
    ]
  };

  function getYouGlishUrl(word) {
    return `https://youglish.com/pronounce/${encodeURIComponent(word)}/english`;
  }

  // Pronunciation Links (pinned resources)
  function renderPronunciationLinks() {
    if (!practiceData) return;

    const links = practiceData.english.pronunciationLinks || [];
    const container = document.getElementById('pronunciation-links');
    if (!container) return;

    if (links.length === 0) {
      container.innerHTML = `
        <div class="pinned-links-header">
          <span class="pinned-links-title">📌 参考サイト</span>
          <button class="btn btn-sm" onclick="toggleAddLinkForm()">+ 追加</button>
        </div>
        <div class="add-link-form" id="add-link-form" style="display: none;">
          <input type="text" class="form-input" id="new-link-name" placeholder="サイト名">
          <input type="url" class="form-input" id="new-link-url" placeholder="URL">
          <button class="btn btn-primary btn-sm" onclick="addPronunciationLink()">追加</button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="pinned-links-header">
        <span class="pinned-links-title">📌 参考サイト</span>
        <button class="btn btn-sm" onclick="toggleAddLinkForm()">+ 追加</button>
      </div>
      <div class="pinned-links-list">
        ${links.map((link, i) => `
          <div class="pinned-link-item">
            <a href="${link.url}" target="_blank">${link.name}</a>
            <button class="btn-icon" onclick="removePronunciationLink(${i})" title="削除">×</button>
          </div>
        `).join('')}
      </div>
      <div class="add-link-form" id="add-link-form" style="display: none;">
        <input type="text" class="form-input" id="new-link-name" placeholder="サイト名">
        <input type="url" class="form-input" id="new-link-url" placeholder="URL">
        <button class="btn btn-primary btn-sm" onclick="addPronunciationLink()">追加</button>
      </div>
    `;
  }

  window.toggleAddLinkForm = function() {
    const form = document.getElementById('add-link-form');
    if (form) {
      form.style.display = form.style.display === 'none' ? 'flex' : 'none';
      if (form.style.display === 'flex') {
        document.getElementById('new-link-name')?.focus();
      }
    }
  };

  window.addPronunciationLink = async function() {
    const nameInput = document.getElementById('new-link-name');
    const urlInput = document.getElementById('new-link-url');
    const name = nameInput?.value.trim();
    const url = urlInput?.value.trim();

    if (!name || !url) {
      showToast('サイト名とURLを入力してください', 'error');
      return;
    }

    if (!practiceData.english.pronunciationLinks) {
      practiceData.english.pronunciationLinks = [];
    }

    practiceData.english.pronunciationLinks.push({
      id: Date.now().toString(),
      name,
      url
    });

    await saveData();
    renderPronunciationLinks();
    showToast('リンクを追加しました', 'success');
  };

  window.removePronunciationLink = async function(index) {
    if (!confirm('このリンクを削除しますか？')) return;

    practiceData.english.pronunciationLinks.splice(index, 1);
    await saveData();
    renderPronunciationLinks();
  };

  function renderPronunciation() {
    if (!practiceData) return;

    const phonemes = practiceData.english.pronunciation || [];
    const container = document.getElementById('pronunciation-list');
    const progressContainer = document.getElementById('phoneme-progress');
    if (!container) return;

    // Categorize phonemes
    const vowels = phonemes.filter(p => p.category === 'vowel');
    const consonants = phonemes.filter(p => p.category === 'consonant');
    const uncategorized = phonemes.filter(p => !p.category);

    // Helper to count mastery based on practiced words
    const isMastered = (p) => (p.practicedWords || []).length >= 10;
    const totalWords = phonemes.reduce((sum, p) => sum + (p.practicedWords || []).length, 0);

    // Render progress bar
    if (progressContainer && phonemes.length > 0) {
      const vowelMastered = vowels.filter(isMastered).length;
      const consonantMastered = consonants.filter(isMastered).length;
      const totalMastered = phonemes.filter(isMastered).length;
      const percentage = Math.round((totalMastered / phonemes.length) * 100);

      progressContainer.innerHTML = `
        <div class="phoneme-progress-bar">
          <div class="phoneme-progress-fill" style="width: ${percentage}%"></div>
        </div>
        <div class="phoneme-progress-text">
          <span>🎯 ${totalMastered}/${phonemes.length} 習得 (${totalWords}単語)</span>
          <span>母音 ${vowelMastered}/${vowels.length} ・ 子音 ${consonantMastered}/${consonants.length}</span>
        </div>
      `;
    } else if (progressContainer) {
      progressContainer.innerHTML = '';
    }

    if (phonemes.length === 0) {
      container.innerHTML = '<div class="empty">音素を追加して練習を始めよう！</div>';
      return;
    }

    // Keep sortOrder - no re-sorting by practice records

    const renderCard = (p) => {
      const realIndex = phonemes.findIndex(ph => ph.id === p.id);
      const practicedWords = p.practicedWords || [];
      const wordCount = practicedWords.length;
      const masteryClass = wordCount >= 10 ? 'mastery-3' : wordCount >= 5 ? 'mastery-2' : wordCount >= 1 ? 'mastery-1' : 'mastery-0';
      const masteryLabels = ['未学習', '練習中', '定着中', '習得'];
      const masteryLevel = wordCount >= 10 ? 3 : wordCount >= 5 ? 2 : wordCount >= 1 ? 1 : 0;
      const recentWords = practicedWords.slice(-3).reverse();

      return `
        <div class="phoneme-card ${masteryClass}" data-index="${realIndex}">
          <div class="phoneme-header" onclick="togglePhonemeExpand(${realIndex})">
            <div class="phoneme-symbol">${p.phoneme.replace(/\//g, '')}${p.important ? '<span class="important-mark">★</span>' : ''}</div>
            <div class="phoneme-info">
              <div class="phoneme-name">${p.name}</div>
              <div class="phoneme-word-count">${wordCount}単語マスター</div>
            </div>
            <div class="phoneme-expand-icon">▼</div>
          </div>
          <div class="phoneme-body" id="phoneme-body-${realIndex}">
            <div class="phoneme-word-input">
              <input type="text" class="form-input" id="word-input-${realIndex}"
                placeholder="単語を入力..."
                onkeypress="if(event.key==='Enter')addPracticedWord(${realIndex})">
              <button class="btn btn-primary btn-sm" onclick="addPracticedWord(${realIndex})">追加</button>
            </div>
            ${practicedWords.length > 0 ? `
              <div class="phoneme-word-list">
                ${practicedWords.slice().reverse().map((w, i) => `
                  <div class="phoneme-word-item">
                    <a href="${getYouGlishUrl(w.word)}" target="_blank">${w.word}</a>
                    <span class="phoneme-word-date">${w.date}</span>
                    <button class="btn-icon" onclick="removePracticedWord(${realIndex}, ${practicedWords.length - 1 - i})">×</button>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div class="phoneme-empty-words">
                例: ${(p.examples || []).map(ex =>
                  `<a href="${getYouGlishUrl(ex)}" target="_blank">${ex}</a>`
                ).join(', ')}
              </div>
            `}
          </div>
          <div class="phoneme-footer">
            <span class="phoneme-mastery-badge ${masteryClass}">${masteryLabels[masteryLevel]}</span>
            ${recentWords.length > 0 ? `<span class="phoneme-recent">最近: ${recentWords.map(w => w.word).join(', ')}</span>` : ''}
            <button class="btn-icon" onclick="event.stopPropagation(); editPhoneme(${realIndex})" title="編集">✏️</button>
          </div>
        </div>
      `;
    };

    // Group phonemes by row and render as table
    const renderTable = (items, maxCols) => {
      const rows = {};
      items.forEach(p => {
        const row = p.row || 1;
        if (!rows[row]) rows[row] = [];
        rows[row].push(p);
      });

      const sortedRowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);

      return sortedRowNums.map(rowNum => {
        const rowItems = rows[rowNum].sort((a, b) => (a.col || 0) - (b.col || 0));
        const cells = [];

        // Build cells with gaps
        let lastCol = -1;
        rowItems.forEach(p => {
          const col = p.col || 0;
          // Add empty cells for gaps
          for (let i = lastCol + 1; i < col; i++) {
            cells.push('<div class="phoneme-cell empty"></div>');
          }
          cells.push(`<div class="phoneme-cell">${renderCard(p)}</div>`);
          lastCol = col;
        });

        // Fill remaining cells to reach maxCols
        for (let i = lastCol + 1; i < maxCols; i++) {
          cells.push('<div class="phoneme-cell empty"></div>');
        }

        return `<div class="phoneme-row">${cells.join('')}</div>`;
      }).join('');
    };

    let html = '';

    if (consonants.length > 0) {
      html += `
        <div class="phoneme-category-header">🗣️ 子音 (${consonants.length})</div>
        <div class="phoneme-table consonant-table">
          ${renderTable(consonants, 5)}
        </div>
      `;
    }

    if (vowels.length > 0) {
      html += `
        <div class="phoneme-category-header">🔊 母音 (${vowels.length})</div>
        <div class="phoneme-table vowel-table">
          ${renderTable(vowels, 5)}
        </div>
      `;
    }

    if (uncategorized.length > 0) {
      html += `
        <div class="phoneme-category-header">📝 その他 (${uncategorized.length})</div>
        <div class="phoneme-table">
          ${renderTable(uncategorized, 5)}
        </div>
      `;
    }

    container.innerHTML = html;
  }

  function openPhonemeModal(phoneme = null, index = -1) {
    const modal = document.getElementById('edit-modal');
    const modalBox = modal.querySelector('.modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    title.textContent = phoneme ? '音素を編集' : '音素を追加';

    const existingPhonemes = (practiceData.english.pronunciation || []).map(p => p.phoneme);

    // Filter available presets
    const availableVowels = PHONEME_PRESETS.vowels.filter(p =>
      phoneme || !existingPhonemes.includes(p.phoneme)
    );
    const availableConsonants = PHONEME_PRESETS.consonants.filter(p =>
      phoneme || !existingPhonemes.includes(p.phoneme)
    );
    const hasPresets = availableVowels.length > 0 || availableConsonants.length > 0;

    // Use wide modal for preset selection
    if (!phoneme && hasPresets) {
      modalBox.classList.add('wide');
    }

    content.innerHTML = `
      ${!phoneme && hasPresets ? `
        <div class="form-group">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label class="form-label" style="margin:0;">母音 (${availableVowels.length}/24)</label>
            <button class="btn btn-sm" id="add-all-vowels">全て追加</button>
          </div>
          <div class="phoneme-preset-grid">
            ${availableVowels.map((p, i) => `
              <div class="phoneme-preset" data-type="vowel" data-preset="${i}">
                <div class="phoneme-preset-symbol">${p.phoneme}</div>
                <div class="phoneme-preset-name">${p.name}</div>
              </div>
            `).join('')}
            ${availableVowels.length === 0 ? '<div style="color:var(--text-muted);font-size:12px;">全て追加済み</div>' : ''}
          </div>
        </div>
        <div class="form-group">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label class="form-label" style="margin:0;">子音 (${availableConsonants.length}/24)</label>
            <button class="btn btn-sm" id="add-all-consonants">全て追加</button>
          </div>
          <div class="phoneme-preset-grid">
            ${availableConsonants.map((p, i) => `
              <div class="phoneme-preset" data-type="consonant" data-preset="${i}">
                <div class="phoneme-preset-symbol">${p.phoneme}</div>
                <div class="phoneme-preset-name">${p.name}</div>
              </div>
            `).join('')}
            ${availableConsonants.length === 0 ? '<div style="color:var(--text-muted);font-size:12px;">全て追加済み</div>' : ''}
          </div>
        </div>
        <div style="text-align: center; color: var(--text-muted); margin: 12px 0;">または手動入力</div>
      ` : ''}
      <div class="form-group">
        <label class="form-label">音素記号 (IPA)</label>
        <input type="text" class="form-input" id="phoneme-symbol" value="${phoneme?.phoneme || ''}" placeholder="/θ/">
      </div>
      <div class="form-group">
        <label class="form-label">名前</label>
        <input type="text" class="form-input" id="phoneme-name" value="${phoneme?.name || ''}" placeholder="th (voiceless)">
      </div>
      <div class="form-group">
        <label class="form-label">例単語 (カンマ区切り)</label>
        <input type="text" class="form-input" id="phoneme-examples" value="${(phoneme?.examples || []).join(', ')}" placeholder="think, three, bath">
      </div>
      <div class="form-group">
        <label class="form-label">メモ (任意)</label>
        <input type="text" class="form-input" id="phoneme-notes" value="${phoneme?.notes || ''}" placeholder="舌を歯の間に挟む">
      </div>
      ${phoneme ? `
        <div class="form-group">
          <label class="form-label">習熟度</label>
          <select class="form-input" id="phoneme-mastery">
            <option value="0" ${phoneme.masteryLevel === 0 ? 'selected' : ''}>未学習</option>
            <option value="1" ${phoneme.masteryLevel === 1 ? 'selected' : ''}>練習中</option>
            <option value="2" ${phoneme.masteryLevel === 2 ? 'selected' : ''}>定着中</option>
            <option value="3" ${phoneme.masteryLevel === 3 ? 'selected' : ''}>習得</option>
          </select>
        </div>
      ` : ''}
      <div style="display: flex; gap: 8px; margin-top: 16px;">
        <button class="btn btn-primary" id="save-phoneme" style="flex:1;">保存</button>
        ${phoneme ? `<button class="btn btn-delete" id="delete-phoneme">削除</button>` : ''}
      </div>
    `;

    modal.classList.add('show');

    // Track selected preset category
    let selectedCategory = phoneme?.category || null;

    // Preset selection
    content.querySelectorAll('.phoneme-preset').forEach(el => {
      el.addEventListener('click', () => {
        content.querySelectorAll('.phoneme-preset').forEach(p => p.classList.remove('selected'));
        el.classList.add('selected');
        const type = el.dataset.type;
        const presetIdx = parseInt(el.dataset.preset);
        const preset = type === 'vowel' ? availableVowels[presetIdx] : availableConsonants[presetIdx];
        selectedCategory = type; // Save the category
        document.getElementById('phoneme-symbol').value = preset.phoneme;
        document.getElementById('phoneme-name').value = preset.name;
        document.getElementById('phoneme-examples').value = preset.examples.join(', ');
      });
    });

    // Add all vowels
    document.getElementById('add-all-vowels')?.addEventListener('click', async () => {
      for (const preset of availableVowels) {
        const newPhoneme = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          phoneme: preset.phoneme,
          name: preset.name,
          examples: preset.examples,
          notes: null,
          practicedWords: [],
          lastPracticed: null,
          createdAt: getTodayKey(),
          category: 'vowel'
        };
        practiceData.english.pronunciation.push(newPhoneme);
      }
      await saveData();
      modal.classList.remove('show');
      modalBox.classList.remove('wide');
      renderPronunciation();
      showToast(`母音${availableVowels.length}個を追加しました`, 'success');
    });

    // Add all consonants
    document.getElementById('add-all-consonants')?.addEventListener('click', async () => {
      for (const preset of availableConsonants) {
        const newPhoneme = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          phoneme: preset.phoneme,
          name: preset.name,
          examples: preset.examples,
          notes: null,
          practicedWords: [],
          lastPracticed: null,
          createdAt: getTodayKey(),
          category: 'consonant'
        };
        practiceData.english.pronunciation.push(newPhoneme);
      }
      await saveData();
      modal.classList.remove('show');
      modalBox.classList.remove('wide');
      renderPronunciation();
      showToast(`子音${availableConsonants.length}個を追加しました`, 'success');
    });

    // Save handler
    document.getElementById('save-phoneme').addEventListener('click', async () => {
      const symbol = document.getElementById('phoneme-symbol').value.trim();
      const name = document.getElementById('phoneme-name').value.trim();
      const examplesStr = document.getElementById('phoneme-examples').value.trim();
      const notes = document.getElementById('phoneme-notes').value.trim();
      const masteryEl = document.getElementById('phoneme-mastery');

      if (!symbol || !name) {
        showToast('音素記号と名前を入力してください', 'error');
        return;
      }

      const examples = examplesStr ? examplesStr.split(',').map(e => e.trim()).filter(e => e) : [];

      const newPhoneme = {
        id: phoneme?.id || Date.now().toString(),
        phoneme: symbol,
        name,
        examples,
        notes: notes || null,
        practicedWords: phoneme?.practicedWords || [],
        lastPracticed: phoneme?.lastPracticed || null,
        createdAt: phoneme?.createdAt || getTodayKey(),
        category: selectedCategory
      };

      if (index >= 0) {
        practiceData.english.pronunciation[index] = newPhoneme;
      } else {
        practiceData.english.pronunciation.push(newPhoneme);
      }

      await saveData();
      modal.classList.remove('show');
      modalBox.classList.remove('wide');
      renderPronunciation();
    });

    // Delete handler
    if (phoneme) {
      document.getElementById('delete-phoneme')?.addEventListener('click', async () => {
        if (!confirm(`「${phoneme.phoneme}」を削除しますか？`)) return;
        practiceData.english.pronunciation.splice(index, 1);
        await saveData();
        modal.classList.remove('show');
        modalBox.classList.remove('wide');
        renderPronunciation();
      });
    }
  }

  // Global functions for phoneme management
  window.togglePhonemeExpand = function(index) {
    const body = document.getElementById(`phoneme-body-${index}`);
    const card = body?.closest('.phoneme-card');
    if (body && card) {
      card.classList.toggle('expanded');
    }
  };

  window.addPracticedWord = async function(index) {
    const input = document.getElementById(`word-input-${index}`);
    const word = input?.value.trim();
    if (!word) return;

    const phoneme = practiceData.english.pronunciation[index];
    if (!phoneme.practicedWords) phoneme.practicedWords = [];

    // Check if word already exists
    if (phoneme.practicedWords.some(w => w.word.toLowerCase() === word.toLowerCase())) {
      showToast('この単語は既に追加されています', 'error');
      return;
    }

    phoneme.practicedWords.push({
      word,
      date: getTodayKey()
    });
    phoneme.lastPracticed = getTodayKey();

    // Also record in calendar
    const todayKey = getTodayKey();
    let records = practiceData.records.english;
    let record = records.find(r => r.date === todayKey);
    if (!record) {
      record = { date: todayKey, completed: [] };
      records.push(record);
    }
    if (!record.completed.includes(phoneme.name)) {
      record.completed.push(phoneme.name);
    }

    // Show milestone messages
    const wordCount = phoneme.practicedWords.length;
    if (wordCount === 10) {
      showToast(`🎉 ${phoneme.phoneme} を習得しました！（10単語達成）`, 'success');
    } else if (wordCount === 5) {
      showToast(`✨ ${phoneme.phoneme} が定着してきました！（5単語達成）`, 'success');
    } else if (wordCount === 1) {
      showToast(`🔥 ${phoneme.phoneme} の練習を開始！`, 'success');
    } else {
      showToast(`"${word}" を追加しました`, 'success');
    }

    await saveData();
    renderPronunciation();
    renderCalendar();
    renderTodayChecklist();

    // Re-expand the card and focus input
    setTimeout(() => {
      const card = document.querySelector(`[data-index="${index}"]`);
      if (card) card.classList.add('expanded');
      const newInput = document.getElementById(`word-input-${index}`);
      if (newInput) newInput.focus();
    }, 50);
  };

  window.removePracticedWord = async function(phonemeIndex, wordIndex) {
    const phoneme = practiceData.english.pronunciation[phonemeIndex];
    if (!phoneme.practicedWords) return;

    const word = phoneme.practicedWords[wordIndex];
    if (!confirm(`"${word.word}" を削除しますか？`)) return;

    phoneme.practicedWords.splice(wordIndex, 1);
    await saveData();
    renderPronunciation();

    // Re-expand the card
    setTimeout(() => {
      const card = document.querySelector(`[data-index="${phonemeIndex}"]`);
      if (card) card.classList.add('expanded');
    }, 50);
  };

  window.editPhoneme = function(index) {
    const phoneme = practiceData.english.pronunciation[index];
    openPhonemeModal(phoneme, index);
  };

  // ==================== PIANO FUNCTIONS ====================

  function renderPianoTextbooks() {
    if (!practiceData || !practiceData.piano) return;

    const container = document.getElementById('piano-textbooks');
    if (!container) return;

    const textbooks = practiceData.piano.textbooks || [];

    if (textbooks.length === 0) {
      container.innerHTML = '<div class="empty">教材を追加して練習を始めよう！</div>';
      return;
    }

    container.innerHTML = textbooks.map((tb, tbIndex) => {
      const pieces = tb.pieces || [];
      const completedPieces = tb.completedPieces || [];
      const completedCount = completedPieces.length;
      const totalCount = pieces.length;
      const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

      return `
        <div class="piano-textbook" data-textbook="${tbIndex}">
          <div class="piano-textbook-header">
            <div class="piano-textbook-name">${tb.name}</div>
            <button class="btn-icon" onclick="editPianoTextbook(${tbIndex})" title="編集">✏️</button>
          </div>
          <div class="piano-textbook-progress">
            <div class="piano-progress-bar">
              <div class="piano-progress-fill" style="width: ${percentage}%"></div>
            </div>
            <div class="piano-progress-text">
              <span>🎹 ${completedCount}/${totalCount} 曲完了</span>
              <span>${percentage}%</span>
            </div>
          </div>
          <div class="piano-pieces-list">
            ${pieces.map((piece, pieceIndex) => {
              const isCompleted = completedPieces.some(cp => cp.name === piece.name);
              const completedInfo = completedPieces.find(cp => cp.name === piece.name);
              const hasComment = piece.comment && piece.comment.length > 0;
              return `
                <div class="piano-piece-item ${isCompleted ? 'completed' : ''} ${hasComment ? 'has-comment' : ''}" data-piece="${pieceIndex}">
                  <div class="piano-piece-check" onclick="event.stopPropagation(); togglePianoPiece(${tbIndex}, ${pieceIndex})">
                    ${isCompleted ? '✓' : ''}
                  </div>
                  <div class="piano-piece-content" onclick="${hasComment ? `togglePieceComment(this)` : ''}">
                    <div class="piano-piece-header">
                      <span class="piano-piece-name">${piece.name}</span>
                      ${piece.rating ? `<span class="piano-piece-rating ${piece.rating}">${piece.rating}</span>` : ''}
                      ${isCompleted && completedInfo?.date ? `<span class="piano-piece-date">${completedInfo.date}</span>` : ''}
                      ${hasComment ? `<span class="piano-piece-expand">▼</span>` : ''}
                    </div>
                    ${hasComment ? `<div class="piano-piece-comment">${piece.comment}</div>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  window.togglePieceComment = function(element) {
    const item = element.closest('.piano-piece-item');
    if (item) {
      item.classList.toggle('expanded');
    }
  };

  window.togglePianoPiece = async function(textbookIndex, pieceIndex) {
    const textbook = practiceData.piano.textbooks[textbookIndex];
    if (!textbook) return;

    const piece = textbook.pieces[pieceIndex];
    if (!piece) return;

    if (!textbook.completedPieces) textbook.completedPieces = [];

    const existingIndex = textbook.completedPieces.findIndex(cp => cp.name === piece.name);

    if (existingIndex >= 0) {
      // Remove from completed
      textbook.completedPieces.splice(existingIndex, 1);
      showToast(`「${piece.name}」を未完了に戻しました`, 'success');
    } else {
      // Add to completed
      const todayKey = getTodayKey();
      textbook.completedPieces.push({
        name: piece.name,
        date: todayKey
      });

      // Also record in calendar
      let records = practiceData.records.piano;
      let record = records.find(r => r.date === todayKey);
      if (!record) {
        record = { date: todayKey, completed: [] };
        records.push(record);
      }
      if (!record.completed.includes(textbook.name)) {
        record.completed.push(textbook.name);
      }

      showToast(`🎉「${piece.name}」を完了！`, 'success');
    }

    await saveData();
    renderPianoTextbooks();
    renderCalendar();
  };

  window.editPianoTextbook = function(index) {
    const textbook = practiceData.piano.textbooks[index];
    openPianoTextbookModal(textbook, index);
  };

  function openPianoTextbookModal(textbook = null, index = -1) {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    title.textContent = textbook ? '教材を編集' : '教材を追加';

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">教材名</label>
        <input type="text" class="form-input" id="piano-textbook-name" value="${textbook?.name || ''}" placeholder="トンプソン 現代ピアノ教本 1">
      </div>
      <div class="form-group">
        <label class="form-label">曲目 (1行に1曲、または改行区切り)</label>
        <textarea class="form-input" id="piano-textbook-pieces" rows="10" placeholder="ピアノのくに&#10;きちんとね&#10;さらさら小川">${(textbook?.pieces || []).map(p => p.name).join('\n')}</textarea>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 16px;">
        <button class="btn btn-primary" id="save-piano-textbook" style="flex:1;">保存</button>
        ${textbook ? `<button class="btn btn-delete" id="delete-piano-textbook">削除</button>` : ''}
      </div>
    `;

    modal.classList.add('show');

    document.getElementById('save-piano-textbook').addEventListener('click', async () => {
      const name = document.getElementById('piano-textbook-name').value.trim();
      const piecesText = document.getElementById('piano-textbook-pieces').value.trim();

      if (!name) {
        showToast('教材名を入力してください', 'error');
        return;
      }

      const pieceNames = piecesText.split('\n').map(p => p.trim()).filter(p => p);
      const pieces = pieceNames.map(pName => {
        // Preserve existing piece data if editing
        const existingPiece = textbook?.pieces?.find(p => p.name === pName);
        return existingPiece || { name: pName };
      });

      const newTextbook = {
        id: textbook?.id || Date.now().toString(),
        name,
        pieces,
        completedPieces: textbook?.completedPieces || [],
        createdAt: textbook?.createdAt || getTodayKey()
      };

      if (index >= 0) {
        practiceData.piano.textbooks[index] = newTextbook;
      } else {
        practiceData.piano.textbooks.push(newTextbook);
      }

      await saveData();
      modal.classList.remove('show');
      renderPianoTextbooks();
    });

    if (textbook) {
      document.getElementById('delete-piano-textbook')?.addEventListener('click', async () => {
        if (!confirm(`「${textbook.name}」を削除しますか？`)) return;
        practiceData.piano.textbooks.splice(index, 1);
        await saveData();
        modal.classList.remove('show');
        renderPianoTextbooks();
      });
    }
  }

  // ==================== GUITAR FUNCTIONS ====================

  function renderGuitarTextbooks() {
    if (!practiceData || !practiceData.guitar) return;

    const container = document.getElementById('guitar-textbooks');
    if (!container) return;

    const textbooks = practiceData.guitar.textbooks || [];

    if (textbooks.length === 0) {
      container.innerHTML = '<div class="empty">教材を追加して練習を始めよう！</div>';
      return;
    }

    container.innerHTML = textbooks.map((tb, tbIndex) => {
      const pieces = tb.pieces || [];
      const completedPieces = tb.completedPieces || [];
      const completedCount = completedPieces.length;
      const totalCount = pieces.length;
      const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

      return `
        <div class="guitar-textbook" data-textbook="${tbIndex}">
          <div class="guitar-textbook-header">
            <div class="guitar-textbook-name">${tb.name}</div>
            <button class="btn-icon" onclick="editGuitarTextbook(${tbIndex})" title="編集">✏️</button>
          </div>
          <div class="guitar-textbook-progress">
            <div class="guitar-progress-bar">
              <div class="guitar-progress-fill" style="width: ${percentage}%"></div>
            </div>
            <div class="guitar-progress-text">
              <span>🎸 ${completedCount}/${totalCount} 曲完了</span>
              <span>${percentage}%</span>
            </div>
          </div>
          <div class="guitar-pieces-list">
            ${pieces.map((piece, pieceIndex) => {
              const isCompleted = completedPieces.some(cp => cp.name === piece.name);
              const completedInfo = completedPieces.find(cp => cp.name === piece.name);
              const hasComment = piece.comment && piece.comment.length > 0;
              return `
                <div class="guitar-piece-item ${isCompleted ? 'completed' : ''} ${hasComment ? 'has-comment' : ''}" data-piece="${pieceIndex}">
                  <div class="guitar-piece-check" onclick="event.stopPropagation(); toggleGuitarPiece(${tbIndex}, ${pieceIndex})">
                    ${isCompleted ? '✓' : ''}
                  </div>
                  <div class="guitar-piece-content" onclick="${hasComment ? `toggleGuitarPieceComment(this)` : ''}">
                    <div class="guitar-piece-header">
                      <span class="guitar-piece-name">${piece.name}</span>
                      ${isCompleted && completedInfo?.date ? `<span class="guitar-piece-date">${completedInfo.date}</span>` : ''}
                      ${hasComment ? `<span class="guitar-piece-expand">▼</span>` : ''}
                    </div>
                    ${hasComment ? `<div class="guitar-piece-comment">${piece.comment}</div>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  window.toggleGuitarPieceComment = function(element) {
    const item = element.closest('.guitar-piece-item');
    if (item) {
      item.classList.toggle('expanded');
    }
  };

  window.toggleGuitarPiece = async function(textbookIndex, pieceIndex) {
    const textbook = practiceData.guitar.textbooks[textbookIndex];
    if (!textbook) return;

    const piece = textbook.pieces[pieceIndex];
    if (!piece) return;

    if (!textbook.completedPieces) textbook.completedPieces = [];

    const existingIndex = textbook.completedPieces.findIndex(cp => cp.name === piece.name);

    if (existingIndex >= 0) {
      // Remove from completed
      textbook.completedPieces.splice(existingIndex, 1);
      showToast(`「${piece.name}」を未完了に戻しました`, 'success');
    } else {
      // Add to completed
      const todayKey = getTodayKey();
      textbook.completedPieces.push({
        name: piece.name,
        date: todayKey
      });

      // Also record in calendar
      let records = practiceData.records.guitar;
      let record = records.find(r => r.date === todayKey);
      if (!record) {
        record = { date: todayKey, completed: [] };
        records.push(record);
      }
      if (!record.completed.includes(textbook.name)) {
        record.completed.push(textbook.name);
      }

      showToast(`🎉「${piece.name}」を完了！`, 'success');
    }

    await saveData();
    renderGuitarTextbooks();
    renderCalendar();
  };

  window.editGuitarTextbook = function(index) {
    const textbook = practiceData.guitar.textbooks[index];
    openGuitarTextbookModal(textbook, index);
  };

  function openGuitarTextbookModal(textbook = null, index = -1) {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    title.textContent = textbook ? '教材を編集' : '教材を追加';

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">教材名</label>
        <input type="text" class="form-input" id="guitar-textbook-name" value="${textbook?.name || ''}" placeholder="ギター教本名">
      </div>
      <div class="form-group">
        <label class="form-label">曲目 (1行に1曲)</label>
        <textarea class="form-input" id="guitar-textbook-pieces" rows="10" placeholder="コード C&#10;コード G&#10;基本ストローク">${(textbook?.pieces || []).map(p => p.name).join('\n')}</textarea>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 16px;">
        <button class="btn btn-primary" id="save-guitar-textbook" style="flex:1;">保存</button>
        ${textbook ? `<button class="btn btn-delete" id="delete-guitar-textbook">削除</button>` : ''}
      </div>
    `;

    modal.classList.add('show');

    document.getElementById('save-guitar-textbook').addEventListener('click', async () => {
      const name = document.getElementById('guitar-textbook-name').value.trim();
      const piecesText = document.getElementById('guitar-textbook-pieces').value.trim();

      if (!name) {
        showToast('教材名を入力してください', 'error');
        return;
      }

      const pieceNames = piecesText.split('\n').map(p => p.trim()).filter(p => p);
      const pieces = pieceNames.map(pName => {
        // Preserve existing piece data if editing
        const existingPiece = textbook?.pieces?.find(p => p.name === pName);
        return existingPiece || { name: pName };
      });

      const newTextbook = {
        id: textbook?.id || Date.now().toString(),
        name,
        pieces,
        completedPieces: textbook?.completedPieces || [],
        createdAt: textbook?.createdAt || getTodayKey()
      };

      if (index >= 0) {
        practiceData.guitar.textbooks[index] = newTextbook;
      } else {
        practiceData.guitar.textbooks.push(newTextbook);
      }

      await saveData();
      modal.classList.remove('show');
      renderGuitarTextbooks();
    });

    if (textbook) {
      document.getElementById('delete-guitar-textbook')?.addEventListener('click', async () => {
        if (!confirm(`「${textbook.name}」を削除しますか？`)) return;
        practiceData.guitar.textbooks.splice(index, 1);
        await saveData();
        modal.classList.remove('show');
        renderGuitarTextbooks();
      });
    }
  }

  // ==================== MATERIALS FUNCTIONS (Dictation) ====================

  function renderMaterials(type) {
    if (!practiceData) return;

    const materials = practiceData.english[type] || [];
    const container = document.getElementById(`${type}-list`);
    if (!container) return;

    if (materials.length === 0) {
      container.innerHTML = '<div class="empty">No materials yet. Add your first one!</div>';
      return;
    }

    // Sort: active first, then by name
    const sorted = [...materials].sort((a, b) => {
      if (a.active && !b.active) return -1;
      if (!a.active && b.active) return 1;
      return a.name.localeCompare(b.name);
    });

    container.innerHTML = sorted.map((mat) => {
      const realIndex = materials.findIndex(m => m.id === mat.id);
      return `
        <div class="material-item ${mat.active ? 'active' : ''}">
          <div class="material-status" onclick="toggleMaterialActive('${type}', ${realIndex})" title="Toggle active">
            ${mat.active ? '🔥' : '○'}
          </div>
          <div class="material-info">
            <div class="material-name">${mat.name}</div>
            <div class="material-meta">
              ${mat.url ? `<a href="${mat.url}" target="_blank" class="material-link">Open ↗</a>` : ''}
              ${mat.notes ? `<span style="margin-left: 8px; color: var(--text-muted);">${mat.notes}</span>` : ''}
            </div>
          </div>
          <div class="vocab-actions">
            <button class="btn btn-sm" onclick="editMaterial('${type}', ${realIndex})">Edit</button>
            <button class="btn btn-sm btn-delete" onclick="deleteMaterial('${type}', ${realIndex})">×</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Toggle material active status
  window.toggleMaterialActive = async function(type, index) {
    const material = practiceData.english[type][index];
    material.active = !material.active;
    await saveData();
    renderMaterials(type);
  };

  function openMaterialModal(type, material = null, index = -1) {
    const modal = document.getElementById('edit-modal');
    const content = document.getElementById('modal-content');
    const title = document.querySelector('.modal-title');

    const typeLabel = type === 'pronunciation' ? 'Pronunciation' : 'Dictation';
    title.textContent = material ? `Edit ${typeLabel} Material` : `Add ${typeLabel} Material`;

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">Name</label>
        <input type="text" class="form-input" id="material-name" value="${material?.name || ''}" placeholder="e.g., Rachel's English - TH Sound">
      </div>
      <div class="form-group">
        <label class="form-label">URL (optional)</label>
        <input type="url" class="form-input" id="material-url" value="${material?.url || ''}" placeholder="https://youtube.com/...">
      </div>
      <div class="form-group">
        <label class="form-label">Notes (optional)</label>
        <input type="text" class="form-input" id="material-notes" value="${material?.notes || ''}" placeholder="e.g., Focus on tongue position">
      </div>
      <button class="btn btn-primary" id="save-material" style="width:100%;margin-top:16px;">Save</button>
    `;

    modal.classList.add('show');

    document.getElementById('save-material').addEventListener('click', async () => {
      const name = document.getElementById('material-name').value.trim();
      const url = document.getElementById('material-url').value.trim();
      const notes = document.getElementById('material-notes').value.trim();

      if (!name) {
        showToast('Please enter a name', 'error');
        return;
      }

      const newMaterial = {
        id: material?.id || Date.now().toString(),
        name,
        url: url || null,
        notes: notes || null,
        createdAt: material?.createdAt || getTodayKey()
      };

      if (index >= 0) {
        practiceData.english[type][index] = newMaterial;
      } else {
        practiceData.english[type].push(newMaterial);
      }

      await saveData();
      modal.classList.remove('show');
      renderMaterials(type);
    });
  }

  // Global functions for material management
  window.editMaterial = function(type, index) {
    const material = practiceData.english[type][index];
    openMaterialModal(type, material, index);
  };

  window.deleteMaterial = async function(type, index) {
    const material = practiceData.english[type][index];
    if (!confirm(`Delete "${material.name}"?`)) return;

    practiceData.english[type].splice(index, 1);
    await saveData();
    renderMaterials(type);
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

  // ==================== MEETING ENGLISH FUNCTIONS ====================

  let meetingStudyPhrases = [];
  let meetingStudyIndex = 0;
  let isMeetingCardFlipped = false;

  function initMeetingPractice() {
    document.getElementById('start-meeting-study-btn')?.addEventListener('click', startMeetingStudyMode);
  }

  function renderMeetingPhrases() {
    if (!practiceData) return;

    const phrases = practiceData.english.meetingPhrases || [];
    const container = document.getElementById('meeting-phrases-list');
    const statsContainer = document.getElementById('meeting-stats');

    if (!container) return;

    // Render stats
    const masteredCount = phrases.filter(p => p.mastered).length;
    const totalCount = phrases.length;
    const percentage = totalCount > 0 ? Math.round((masteredCount / totalCount) * 100) : 0;

    if (statsContainer) {
      statsContainer.innerHTML = `
        <div class="phrase-stat-badge" style="flex: 2;">
          <div style="display: flex; flex-direction: column; width: 100%;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span class="stat-icon">💼</span>
              <span style="font-size: 14px; font-weight: 600;">Progress: ${masteredCount}/${totalCount}</span>
              ${percentage === 100 ? '<span style="color: var(--accent);">Complete!</span>' : ''}
            </div>
            <div style="background: var(--bg-tertiary); height: 6px; border-radius: 3px; overflow: hidden;">
              <div style="width: ${percentage}%; height: 100%; background: var(--accent); transition: width 0.3s;"></div>
            </div>
          </div>
        </div>
        <div class="phrase-stat-badge">
          <span class="stat-icon">✅</span>
          <span class="stat-num">${masteredCount}</span>
          <span class="stat-text">Mastered</span>
        </div>
        <div class="phrase-stat-badge">
          <span class="stat-icon">📚</span>
          <span class="stat-num">${totalCount - masteredCount}</span>
          <span class="stat-text">To Learn</span>
        </div>
        ${totalCount > 0 ? `<button class="btn btn-sm btn-delete" onclick="deleteAllMeetingPhrases()" style="margin-left: auto;">全削除</button>` : ''}
      `;
    }

    if (phrases.length === 0) {
      container.innerHTML = '<div class="empty">ミーティング用フレーズがありません</div>';
      return;
    }

    container.innerHTML = phrases.map((phrase, index) => `
      <div class="meeting-phrase-item ${phrase.mastered ? 'mastered' : ''}" data-index="${index}">
        <div class="meeting-phrase-check" onclick="toggleMeetingPhraseMastery(${index})">
          ${phrase.mastered ? '✓' : ''}
        </div>
        <div class="meeting-phrase-content" onclick="toggleMeetingPhraseExpand(${index})">
          <div class="meeting-phrase-en">${phrase.english}</div>
          <div class="meeting-phrase-jp">${phrase.japanese}</div>
          ${phrase.context ? `<div class="meeting-phrase-context" id="meeting-context-${index}">${phrase.context}</div>` : ''}
        </div>
        ${phrase.context ? `<span class="meeting-phrase-toggle">▼</span>` : ''}
        <button class="btn btn-sm btn-delete" onclick="deleteMeetingPhrase(${index})" title="削除">×</button>
      </div>
    `).join('');
  }

  window.toggleMeetingPhraseMastery = async function(index) {
    const phrases = practiceData.english.meetingPhrases || [];
    if (index < 0 || index >= phrases.length) return;

    phrases[index].mastered = !phrases[index].mastered;
    phrases[index].masteredAt = phrases[index].mastered ? getTodayKey() : null;

    await saveData();
    renderMeetingPhrases();

    if (phrases[index].mastered) {
      showToast('✅ Mastered!', 'success');
    }
  };

  window.toggleMeetingPhraseExpand = function(index) {
    const item = document.querySelector(`.meeting-phrase-item[data-index="${index}"]`);
    if (item) {
      item.classList.toggle('expanded');
    }
  };

  window.deleteMeetingPhrase = async function(index) {
    const phrases = practiceData.english.meetingPhrases || [];
    if (index < 0 || index >= phrases.length) return;

    if (!confirm('このフレーズを削除しますか？')) return;

    phrases.splice(index, 1);
    await saveData();
    renderMeetingPhrases();
    showToast('フレーズを削除しました', 'success');
  };

  window.deleteAllMeetingPhrases = async function() {
    const phrases = practiceData.english.meetingPhrases || [];
    if (phrases.length === 0) return;

    if (!confirm(`Meeting Englishの全${phrases.length}件のフレーズを削除しますか？`)) return;

    practiceData.english.meetingPhrases = [];
    await saveData();
    renderMeetingPhrases();
    showToast('全てのフレーズを削除しました', 'success');
  };

  function startMeetingStudyMode() {
    const phrases = practiceData.english.meetingPhrases || [];
    const unmastered = phrases.filter(p => !p.mastered);

    if (unmastered.length === 0) {
      showToast('🎉 All phrases mastered!', 'success');
      return;
    }

    meetingStudyPhrases = shuffleArray([...unmastered]);
    meetingStudyIndex = 0;
    isMeetingCardFlipped = false;

    const container = document.getElementById('meeting-study-container');
    if (container) {
      container.style.display = 'block';
      renderMeetingStudyCard();
    }
  }

  function renderMeetingStudyCard() {
    const container = document.getElementById('meeting-study-container');
    if (!container) return;

    if (meetingStudyIndex >= meetingStudyPhrases.length) {
      // Study complete
      container.innerHTML = `
        <div class="study-header">
          <span class="study-title">Meeting English - Complete!</span>
          <button class="btn" onclick="exitMeetingStudyMode()">✕ Close</button>
        </div>
        <div class="study-result">
          <div class="study-result-header">
            <div class="study-result-score">🎉</div>
            <div class="study-result-label">Practice Complete!</div>
          </div>
          <div style="text-align: center; margin-top: 20px;">
            <p>Reviewed ${meetingStudyPhrases.length} phrases</p>
            <button class="btn btn-primary" onclick="exitMeetingStudyMode()" style="margin-top: 20px;">Done</button>
          </div>
        </div>
      `;
      return;
    }

    const phrase = meetingStudyPhrases[meetingStudyIndex];
    const progress = Math.round(((meetingStudyIndex) / meetingStudyPhrases.length) * 100);

    container.innerHTML = `
      <div class="study-header">
        <span class="study-title">Meeting English (${meetingStudyIndex + 1}/${meetingStudyPhrases.length})</span>
        <button class="btn" onclick="exitMeetingStudyMode()">✕ Close</button>
      </div>
      <div class="study-progress-bar">
        <div class="study-progress-fill" style="width: ${progress}%"></div>
      </div>
      <div class="study-card-container">
        <div class="study-card ${isMeetingCardFlipped ? 'flipped' : ''}" onclick="flipMeetingCard()">
          <div class="study-card-text">
            ${isMeetingCardFlipped ? phrase.english : phrase.japanese}
          </div>
          <div class="study-card-hint">
            ${isMeetingCardFlipped ? 'Click for Japanese' : 'Click to reveal English'}
          </div>
        </div>
        <div class="study-buttons" style="${isMeetingCardFlipped ? '' : 'visibility: hidden;'}">
          <button class="study-btn ng" onclick="meetingStudyNext(false)">もう一度</button>
          <button class="study-btn ok" onclick="meetingStudyNext(true)">OK ✓</button>
        </div>
      </div>
    `;
  }

  window.flipMeetingCard = function() {
    isMeetingCardFlipped = !isMeetingCardFlipped;
    renderMeetingStudyCard();
  };

  window.meetingStudyNext = async function(mastered) {
    const phrase = meetingStudyPhrases[meetingStudyIndex];

    if (mastered) {
      // Find and update the original phrase
      const phrases = practiceData.english.meetingPhrases || [];
      const originalIndex = phrases.findIndex(p => p.id === phrase.id);
      if (originalIndex >= 0) {
        phrases[originalIndex].mastered = true;
        phrases[originalIndex].masteredAt = getTodayKey();
      }
      await saveData();
    }

    meetingStudyIndex++;
    isMeetingCardFlipped = false;
    renderMeetingStudyCard();
  };

  window.exitMeetingStudyMode = function() {
    const container = document.getElementById('meeting-study-container');
    if (container) {
      container.style.display = 'none';
    }
    meetingStudyPhrases = [];
    meetingStudyIndex = 0;
    isMeetingCardFlipped = false;
    renderMeetingPhrases();
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

    // Plans button (opens textbook modal for English category)
    document.getElementById('btn-plans')?.addEventListener('click', () => {
      if (currentCategory === 'english') {
        openTextbookModal();
      } else {
        openPlansModal();
      }
    });

    // Modals
    document.getElementById('modal-close')?.addEventListener('click', () => {
      const modal = document.getElementById('edit-modal');
      modal.classList.remove('show');
      modal.querySelector('.modal')?.classList.remove('wide');
    });

    document.getElementById('edit-modal')?.addEventListener('click', e => {
      if (e.target.id === 'edit-modal') {
        const modal = document.getElementById('edit-modal');
        modal.classList.remove('show');
        modal.querySelector('.modal')?.classList.remove('wide');
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
    document.getElementById('bulk-add-phrase-btn')?.addEventListener('click', openBulkPhraseModal);
    document.getElementById('manage-textbooks-btn')?.addEventListener('click', openTextbookModal);
    document.getElementById('start-study-btn')?.addEventListener('click', openStudyModeModal);
    document.getElementById('start-study-study-btn')?.addEventListener('click', openStudyTabStudyModal);

    // English: Pronunciation & Dictation
    document.getElementById('add-pronunciation-btn')?.addEventListener('click', () => openPhonemeModal());
    document.getElementById('add-dictation-btn')?.addEventListener('click', () => openMaterialModal('dictation'));

    // Piano
    document.getElementById('add-piano-textbook-btn')?.addEventListener('click', () => openPianoTextbookModal());

    // Guitar
    document.getElementById('add-guitar-textbook-btn')?.addEventListener('click', () => openGuitarTextbookModal());

    document.getElementById('phrase-search')?.addEventListener('input', (e) => {
      phraseSearchQuery = e.target.value;
      renderPhrases();
    });
    document.getElementById('phrase-filter-textbook')?.addEventListener('change', (e) => {
      phraseFilterTextbook = e.target.value;
      phraseFilterChapter = '';
      renderPhrases();
    });
    document.getElementById('phrase-filter-chapter')?.addEventListener('change', (e) => {
      phraseFilterChapter = e.target.value;
      renderPhrases();
    });
    document.getElementById('phrase-filter-mastery')?.addEventListener('change', (e) => {
      phraseFilterMastery = e.target.value;
      renderPhrases();
    });
    document.getElementById('quick-study-btn')?.addEventListener('click', () => {
      // Quick study: weak phrases, all questions, japanese mode
      activeStudyContainerId = 'study-mode-container';
      startStudyMode('weak', '', '', 'all', 'japanese');
    });

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
