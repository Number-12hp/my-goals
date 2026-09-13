/* My Goals —— 纯前端目标清单
   数据保存在浏览器 localStorage；支持中英文切换、深/浅色主题。 */

(() => {
  'use strict';

  // 用 window.xxx 兜底：避免某些环境下全局变量拿不到而静默中断脚本
  const W = typeof window !== 'undefined' ? window : {};
  const D = typeof document !== 'undefined' ? document : null;
  if (!D) return;

  const STORE_KEY = 'xiaomubiao.goals.v1';
  const THEME_KEY = 'xiaomubiao.theme.v1';
  const LANG_KEY  = 'xiaomubiao.lang.v1';

  const SCOPES = { year: {}, month: {}, week: {}, day: {} };
  const TYPES  = { main: {}, side: {} };

  // localStorage 可能被浏览器禁用（隐私模式 / 禁用站点数据 / 限制 file://）。
  // 依次退回 sessionStorage → 内存存储，保证基本功能永远可用。
  const storage = (() => {
    const test = (s) => {
      const k = '__t' + Math.random();
      s.setItem(k, '1');
      s.removeItem(k);
      return { get: key => s.getItem(key), set: (key, v) => s.setItem(key, v),
               level: s === W.localStorage ? 'local' : (s === W.sessionStorage ? 'session' : 'memory') };
    };
    try { return test(W.localStorage); } catch (e) { console.warn('localStorage unavailable', e); }
    try { return test(W.sessionStorage); } catch (e) { console.warn('sessionStorage unavailable', e); }
    const mem = new Map();
    console.warn('local storage blocked, falling back to memory');
    return { get: k => (mem.has(k) ? mem.get(k) : null), set: (k, v) => mem.set(k, v),
             level: 'memory' };
  })();

  /* ---------------- 文案字典 ---------------- */

  // 日期用到的常量必须先于字典定义（字典里的函数会引用它们）
  const MN = ['January', 'February', 'March', 'April', 'May', 'June',
              'July', 'August', 'September', 'October', 'November', 'December'];
  const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WD_ZH = ['日', '一', '二', '三', '四', '五', '六'];

  const STRINGS = {
    zh: {
      langAria: '切换语言', themeAria: '切换深色 / 浅色',
      ph: '想做点什么？', goalAria: '目标内容',
      lblScope: '周期', lblDate: '日期', lblType: '类型',
      gScope: '目标周期', gType: '主线或支线', gFilter: '筛选', dateAria: '日期',
      scYear: '年', scMonth: '月', scWeek: '周', scDay: '天',
      typeMain: '主线', typeSide: '支线',
      add: '添加', fAll: '全部', archive: '已完成', clearDone: '清空已完成',
      statActive: '进行中', statDone: '已完成', statAll: '全部',
      uYear: n => `${n}年`,
      uMonth: (y, m) => `${y}年${m}月`,
      uWeek: (y, w) => `${y}年第${w}周`,
      uDay: (m, d, wd) => `${m}月${d}日 周${wd}`,
      overdue: '已过期',
      justNow: '刚刚完成',
      minAgo: n => `${n} 分钟前完成`,
      todayAt: (h, m) => `今天 ${h}:${m} 完成`,
      doneOn: (m, d) => `${m}月${d}日 完成`,
      markDone: '标记完成', undoDone: '撤销完成',
      delLabel: '删除这个目标', delTitle: '删除',
      warnEmpty: '先写点什么吧～',
      tAdd: '已添加 ✨', tDone: '完成啦，真棒 🎉', tUndone: '已移回清单',
      tDeleted: t => `已删除「${t}」`, tCleared: n => `已清空 ${n} 条完成记录`,
      tUndo: '已撤销删除', tNoDone: '还没有已完成的目标',
      cDelete: t => `删除目标「${t}」？`, cClear: n => `确定清空这 ${n} 条完成记录吗？`,
      emptyNoGoals: '还没有目标。在上面写一个吧，比如「看一部电影」🎬',
      emptyAllDone: '这一批目标都完成啦，去下面的「已完成」里看看吧 🎉',
      emptyFiltered: '这个筛选下暂时没有目标，换个筛选看看～',
      saveFail: '⚠ 保存失败：浏览器禁止了本地存储，改动关掉页面就会丢',
      undo: '撤销', undoClose: '关闭',
      delText: '删除'
    },
    en: {
      langAria: 'Switch language', themeAria: 'Switch dark / light',
      ph: 'What do you want to do?', goalAria: 'Goal text',
      lblScope: 'Period', lblDate: 'Date', lblType: 'Type',
      gScope: 'Goal period', gType: 'Main or side', gFilter: 'Filter', dateAria: 'Date',
      scYear: 'Year', scMonth: 'Month', scWeek: 'Week', scDay: 'Day',
      typeMain: 'Main', typeSide: 'Side',
      add: 'Add', fAll: 'All', archive: 'Completed', clearDone: 'Clear completed',
      statActive: 'Active', statDone: 'Done', statAll: 'Total',
      uYear: n => `Year ${n}`,
      uMonth: (y, m) => `${MN[m - 1]} ${y}`,
      uWeek: (y, w) => `Week ${w}, ${y}`,
      uDay: (m, d, wd) => `${MN[m - 1]} ${d}, ${WD_EN[wd]}`,
      overdue: 'Overdue',
      justNow: 'just completed',
      minAgo: n => `completed ${n} min ago`,
      todayAt: (h, m) => `completed today ${h}:${m}`,
      doneOn: (m, d) => `completed ${MN[m - 1]} ${d}`,
      markDone: 'Mark as done', undoDone: 'Mark as not done',
      delLabel: 'Delete this goal', delTitle: 'Delete',
      warnEmpty: 'Write something first',
      tAdd: 'Added', tDone: 'Nice, done!', tUndone: 'Moved back to the list',
      tDeleted: t => `Deleted “${t}”`, tCleared: n => `Cleared ${n} completed`,
      tUndo: 'Deletion undone', tNoDone: 'Nothing completed yet',
      cDelete: t => `Delete “${t}”?`, cClear: n => `Clear all ${n} completed goals?`,
      emptyNoGoals: 'No goals yet. Add one above — like “Watch a movie”.',
      emptyAllDone: 'All done here. Check the Completed section below.',
      emptyFiltered: 'Nothing in this filter. Try another one.',
      saveFail: '⚠ Could not save: this browser blocks local storage, changes will be lost on close',
      undo: 'Undo', undoClose: 'Close',
      delText: 'Delete'
    }
  };

  let lang = 'zh';
  const t = (k, a, b, c) => {
    const v = (STRINGS[lang] && STRINGS[lang][k]);
    if (typeof v === 'function') return v(a, b, c);
    return v !== undefined ? v : (STRINGS.zh[k] || k);
  };

  // 尽量按访客的浏览器语言自动选择，其次中文
  const detectLang = () => {
    try {
      const saved = storage.get(LANG_KEY);
      if (saved === 'zh' || saved === 'en') return saved;
    } catch (e) {}
    const nav = (W.navigator && (W.navigator.language || W.navigator.userLanguage)) || 'zh';
    return /^zh/i.test(nav) ? 'zh' : 'en';
  };

  /* ---------------- DOM ---------------- */

  const board       = document.getElementById('board');
  const archiveList = document.getElementById('archiveList');
  const archiveBox  = document.getElementById('archiveBox');
  const archiveCount= document.getElementById('archiveCount');
  const statsEl     = document.getElementById('stats');
  const form        = document.getElementById('form');
  const titleInput  = document.getElementById('title');
  const dateInput   = document.getElementById('date');
  const hintEl      = document.getElementById('hint');
  const scopeSeg    = document.getElementById('scopeSeg');
  const typeSeg     = document.getElementById('typeSeg');
  const langSeg     = document.getElementById('langSeg');
  const filtersEl   = document.getElementById('filters');
  const themeBtn    = document.getElementById('themeBtn');
  const clearDoneBtn= document.getElementById('clearDone');
  const toastEl     = document.getElementById('toast');
  const undoEl      = document.getElementById('undo');
  const cloudHost   = document.getElementById('cloudHost');

  let goals   = [];
  let filter  = 'undone';   // 只显示未完成的目标
  let scope   = 'day';
  let type    = 'main';
  let toastTimer = null;

  /* ---------------- 日期与存储 ---------------- */

  const pad = n => String(n).padStart(2, '0');

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function load() {
    try {
      const raw = storage.get(STORE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr.filter(g => g && typeof g.title === 'string').map(g => ({
        id:       String(g.id || Math.random().toString(36).slice(2)),
        title:    g.title,
        scope:    SCOPES[g.scope] ? g.scope : 'day',
        type:     TYPES[g.type] ? g.type : 'side',
        date:     /^\d{4}-\d{2}-\d{2}$/.test(g.date) ? g.date : todayStr(),
        done:     !!g.done,
        doneAt:   g.doneAt || null,
        createdAt:g.createdAt || null
      }));
    } catch (e) {
      console.warn('load failed', e);
      return [];
    }
  }

  function save() {
    try {
      storage.set(STORE_KEY, JSON.stringify(goals));
    } catch (e) {
      console.error('save failed', e);
      toast(t('saveFail'));
    }
  }

  /* ---------------- 文案生成 ---------------- */

  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // 该目标所属周期的标签，例：2026年 / 2026年2月 / 2026年第7周 / 2月14日 周六
  function periodLabel(scopeName, dateStr) {
    const d = parseDate(dateStr);
    if (scopeName === 'year')  return t('uYear', d.getFullYear());
    if (scopeName === 'month') return t('uMonth', d.getFullYear(), d.getMonth() + 1);
    if (scopeName === 'week') {
      const w = isoWeek(d);
      return t('uWeek', w.year, w.week);
    }
    return t('uDay', d.getMonth() + 1, d.getDate(),
      lang === 'zh' ? WD_ZH[d.getDay()] : WD_EN[d.getDay()]);
  }

  // ISO 8601 周：周一为一周开始，含当年第一个周四的那周为第 1 周。
  function isoWeek(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // 移到本周四
    const y = d.getFullYear();
    const firstThu = new Date(y, 0, 4);
    firstThu.setDate(firstThu.getDate() + 3 - ((firstThu.getDay() + 6) % 7));
    return { year: y, week: 1 + Math.round((d - firstThu) / 604800000) };
  }

  // 周期排序用的键（越小越靠前）
  function periodKey(scopeName, dateStr) {
    const d = parseDate(dateStr);
    if (scopeName === 'year')  return d.getFullYear();
    if (scopeName === 'month') return d.getFullYear() * 100 + d.getMonth();
    if (scopeName === 'week') {
      const w = isoWeek(d);
      return w.year * 100 + w.week;
    }
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  function isOverdue(g) {
    if (g.done) return false;
    return g.date < todayStr();
  }

  function fmtDoneAt(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const diff = Date.now() - ts;
    if (diff < 60000) return t('justNow');
    if (diff < 3600000) return t('minAgo', Math.floor(diff / 60000));
    if (d.toDateString() === new Date().toDateString()) {
      return t('todayAt', pad(d.getHours()), pad(d.getMinutes()));
    }
    return t('doneOn', d.getMonth() + 1, d.getDate());
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- 渲染 ---------------- */

  function render() {
    renderStats();
    renderBoard();
    renderArchive();
    syncChips();
  }

  function renderStats() {
    const total = goals.length;
    const done = goals.filter(g => g.done).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    statsEl.innerHTML = `
      <div class="stat"><b>${total - done}</b><span>${esc(t('statActive'))}</span></div>
      <div class="stat"><b>${done}</b><span>${esc(t('statDone'))}</span>
        <div class="stat-bar"><i style="width:${pct}%"></i></div>
      </div>
      <div class="stat"><b>${total}</b><span>${esc(t('statAll'))}</span></div>`;
  }

  // 看板只放未完成的目标：已完成的都归到下面「已完成」区块里
  function matchFilter(g) {
    if (g.done) return false;
    if (filter === 'main') return g.type === 'main';
    if (filter === 'side') return g.type === 'side';
    return true;
  }

  function cardMarkup(g, inArchive) {
    // 卡片上只留「周期 · 主线/支线」加备注；日期已经在分组标题里了
    const meta = [t('sc' + g.scope.charAt(0).toUpperCase() + g.scope.slice(1)),
                  t(g.type === 'main' ? 'typeMain' : 'typeSide')]
      .concat(isOverdue(g) ? [t('overdue')] : [])
      .concat(inArchive ? [fmtDoneAt(g.doneAt)] : [])
      .filter(Boolean).map(esc).join(' · ');
    const checkTitle = inArchive ? t('undoDone') : t('markDone');
    return `
      <div class="card${inArchive ? ' done is-done' : ''}" data-id="${g.id}" data-type="${g.type}">
        <button class="check" type="button" title="${esc(checkTitle)}">
          <span class="check-mark">✓</span>
        </button>
        <div class="card-body">
          <span class="txt">${esc(g.title)}</span>
          <div class="meta">${meta}</div>
        </div>
        <button class="del ${inArchive ? 'always' : ''}" type="button"
                title="${esc(t('delLabel'))}" aria-label="${esc(t('delLabel'))}">${esc(t('delText'))}</button>
      </div>`;
  }

  function renderBoard() {
    const list = goals.filter(matchFilter);
    const byScope = { year: [], month: [], week: [], day: [] };
    list.forEach(g => byScope[g.scope].push(g));

    let html = '';
    for (const key of Object.keys(SCOPES)) {
      const items = byScope[key];
      if (!items.length) continue;

      const periods = new Map();
      items.forEach(g => {
        const label = periodLabel(g.scope, g.date);
        if (!periods.has(label)) periods.set(label, { key: periodKey(g.scope, g.date), items: [] });
        periods.get(label).items.push(g);
      });

      const groups = [...periods.entries()].sort((a, b) => a[1].key - b[1].key);
      html += `<section class="group">`;
      for (const [label, info] of groups) {
        const doneN = info.items.filter(g => g.done).length;
        const pct = Math.round((doneN / info.items.length) * 100);
        const sorted = info.items.slice().sort((a, b) =>
          (a.done - b.done) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
        );
        html += `
          <div class="group-head">
            <span class="g-name">${esc(label)}</span>
            <span class="g-count">${doneN}/${info.items.length}</span>
            <span class="g-track"><i style="width:${pct}%"></i></span>
          </div>
          <div class="list" data-scope="${key}">
            ${sorted.map(g => cardMarkup(g, false)).join('')}
          </div>`;
      }
      html += `</section>`;
    }

    if (!html) {
      const unDone = goals.filter(g => !g.done);
      const msg = !goals.length
        ? t('emptyNoGoals')
        : (unDone.length === 0)
          ? t('emptyAllDone')
          : t('emptyFiltered');
      html = `<div class="empty">${esc(msg)}</div>`;
    }
    board.innerHTML = html;
  }

  function renderArchive() {
    const done = goals.filter(g => g.done)
      .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    archiveCount.textContent = done.length;
    archiveList.innerHTML = done.length
      ? done.map(g => cardMarkup(g, true)).join('')
      : `<div class="empty">${esc(t('emptyFiltered'))}</div>`;
  }

  /* ---------------- 静态文案与语言 ---------------- */

  function applyStatic() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    D.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    D.querySelectorAll('[data-i18n-ph]').forEach(el => {
      el.setAttribute('placeholder', t(el.dataset.i18nPh));
    });
    D.querySelectorAll('[data-i18n-aria]').forEach(el => {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
    if (langSeg) {
      langSeg.querySelectorAll('button').forEach(b =>
        b.classList.toggle('on', b.dataset.lang === lang));
      langSeg.setAttribute('aria-label', t('langAria'));
    }
  }

  function setLang(next, opts) {
    lang = (next === 'en') ? 'en' : 'zh';
    try { storage.set(LANG_KEY, lang); } catch (e) {}
    applyStatic();
    if (!opts || !opts.soft) {
      render();                 // 分组标题、备注、统计都要按新语言重画
    } else {
      renderStats();            // 打字时不动看板，免得输入框失焦、行高跳动
      renderArchive();
    }
  }

  if (langSeg) {
    langSeg.addEventListener('click', e => {
      const btn = e.target.closest('[data-lang]');
      if (!btn || btn.dataset.lang === lang) return;
      // 正在输入时只更新周边文案，不重画看板
      setLang(btn.dataset.lang, { soft: D.activeElement === titleInput });
    });
  }

  /* ---------------- 交互 ---------------- */

  // 周期 / 主线支线选择
  scopeSeg.addEventListener('click', e => {
    const btn = e.target.closest('[data-scope]');
    if (!btn) return;
    scope = btn.dataset.scope;
    scopeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
    updateHint();
  });

  typeSeg.addEventListener('click', e => {
    const btn = e.target.closest('[data-type]');
    if (!btn) return;
    type = btn.dataset.type;
    typeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
  });

  // 默认不显示任何说明文字，只在输入为空时报错
  function updateHint() {
    hintEl.textContent = '';
    hintEl.classList.remove('warn');
  }

  // 添加
  form.addEventListener('submit', e => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      hintEl.textContent = t('warnEmpty');
      hintEl.classList.add('warn');
      titleInput.focus();
      return;
    }
    goals.push({
      id: Math.random().toString(36).slice(2, 10),
      title,
      scope,
      type,
      date: dateInput.value || todayStr(),
      done: false,
      doneAt: null,
      createdAt: new Date().toISOString()
    });
    save();
    titleInput.value = '';
    titleInput.focus();
    updateHint();
    render();
    toast(t('tAdd'));
  });

  // 勾选完成 / 撤销
  function toggleDone(id, cardEl) {
    const g = goals.find(x => x.id === id);
    if (!g) return;
    if (!g.done) {
      g.done = true;
      g.doneAt = Date.now();
      save();
      animOut(cardEl, id);
    } else {
      g.done = false;
      g.doneAt = null;
      save();
      render();
      toast(t('tUndone'));
    }
  }

  // 完成后：先打勾划掉，再把卡片收进「已完成」
  function animOut(cardEl, id) {
    cardEl.classList.add('is-done');
    cardEl.style.maxHeight = cardEl.offsetHeight + 'px';
    void cardEl.offsetHeight;          // 强制重排，让高度过渡生效

    const quick = filter === 'undone'; // 默认视图下这张卡片本来就不该留着，快一点

    setTimeout(() => {
      if (!cardEl.isConnected) return;
      cardEl.classList.add('leaving');
      cardEl.style.maxHeight = '0px';
    }, quick ? 260 : 340);

    setTimeout(() => {
      render();
      archiveBox.open = true;
      const moved = archiveList.querySelector(`.card[data-id="${id}"]`);
      if (moved) {
        moved.classList.add('pop');
        setTimeout(() => moved.classList.remove('pop'), 380);
      }
      toast(t('tDone'));
    }, quick ? 480 : 760);
  }

  // 某些受限环境（预览 iframe、sandbox 页面）会拦截原生 confirm，
  // 直接调用会抛异常或返回 undefined —— 那会让删除彻底失效。
  // 这里失败就当作「确认」，删除后仍可用撤销条反悔。
  function safeConfirm(msg) {
    try {
      const r = W.confirm ? W.confirm(msg) : true;
      return r === undefined ? true : r;
    } catch (e) {
      console.warn('confirm blocked by environment, treating as confirmed', e);
      return true;
    }
  }

  let undoStack = null, undoTimer = null;

  function showUndo(text, stack) {
    undoStack = stack;
    if (!undoEl) return;
    // 不用 querySelector 填文本：受限环境可能不支持，直接内联（已转义）
    undoEl.innerHTML =
      `<span class="undo-text">${esc(text)}</span>` +
      `<button type="button" class="undo-btn" data-undo>${esc(t('undo'))}</button>` +
      `<button type="button" class="undo-close" data-undo-close title="${esc(t('undoClose'))}">✕</button>`;
    undoEl.classList.add('show');
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndo, 7000);
  }

  function hideUndo() {
    undoStack = null;
    clearTimeout(undoTimer);
    if (undoEl) { undoEl.classList.remove('show'); undoEl.innerHTML = ''; }
  }

  if (undoEl) {
    undoEl.addEventListener('click', e => {
      if (e.target.closest('[data-undo]')) {
        if (undoStack) {
          goals = undoStack;      // 回到删除前的状态
          save();
          render();
          toast(t('tUndo'));
        }
        hideUndo();
      } else if (e.target.closest('[data-undo-close]')) {
        hideUndo();
      }
    });
  }

  // 事件委托：勾选 / 删除
  document.addEventListener('click', e => {
    const checkBtn = e.target.closest('.check');
    if (checkBtn) {
      const card = checkBtn.closest('.card');
      toggleDone(card.dataset.id, card);
      return;
    }
    const delBtn = e.target.closest('.del');
    if (delBtn) {
      const card = delBtn.closest('.card');
      const g = card && goals.find(x => x.id === card.dataset.id);
      if (!g) return;
      if (!safeConfirm(t('cDelete', g.title))) return;
      const snapshot = goals.slice();      // 删除前的快照，用于撤销
      goals = goals.filter(x => x.id !== g.id);
      save();
      render();
      showUndo(t('tDeleted', g.title), snapshot);
    }
  });

  // 筛选
  function syncChips() {
    filtersEl.querySelectorAll('.chip').forEach(b =>
      b.classList.toggle('on', b.dataset.filter === filter));
  }

  filtersEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    filter = btn.dataset.filter;
    syncChips();
    renderBoard();
  });

  // 清空已完成
  clearDoneBtn.addEventListener('click', () => {
    const n = goals.filter(g => g.done).length;
    if (!n) return toast(t('tNoDone'));
    if (!safeConfirm(t('cClear', n))) return;
    const snapshot = goals.slice();
    goals = goals.filter(g => !g.done);
    save();
    render();
    showUndo(t('tCleared', n), snapshot);
  });

  // 提示条
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1900);
  }

  /* ---------------- 主题 ---------------- */

  function applyTheme(th) {
    document.documentElement.dataset.theme = th;
    themeBtn.textContent = th === 'dark' ? '☀' : '☾';
    try { storage.set(THEME_KEY, th); } catch (e) {}
  }

  themeBtn.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  /* ---------------- 初始化 ---------------- */

  // 在网页托管平台上显示一行小字，说明数据存在本地（file:// 时不显示）
  function showCloudHint() {
    const proto = W.location && W.location.protocol;
    const host = W.location && W.location.hostname;
    if (!cloudHost || proto === 'file:' || !host) return;
    const label = {
      zh: '数据保存在你自己的浏览器里',
      en: 'Your data stays in your own browser'
    };
    cloudHost.textContent = label[lang] || label.zh;
    cloudHost.hidden = false;
  }

  function boot() {
    lang = detectLang();
    goals = load();

    let savedTheme = null;
    try { savedTheme = storage.get(THEME_KEY); } catch (e) {}
    if (!savedTheme) {
      savedTheme = W.matchMedia && W.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark' : 'light';
    }
    applyTheme(savedTheme);

    dateInput.value = todayStr();
    applyStatic();
    updateHint();
    render();
    showCloudHint();

    // 首次打开给一点示例，方便理解界面
    if (!goals.length) {
      goals = [
        { id: 'demo1', title: lang === 'zh' ? '看一部一直想看的电影' : 'Watch a movie I keep meaning to see',
          scope: 'week', type: 'side', date: todayStr(), done: false, doneAt: null,
          createdAt: new Date().toISOString() },
        { id: 'demo2', title: lang === 'zh' ? '读完一本搁置很久的书' : 'Finish a book I put down long ago',
          scope: 'month', type: 'main', date: todayStr(), done: false, doneAt: null,
          createdAt: new Date().toISOString() }
      ];
      save();
      render();
    }
  }

  try {
    boot();
  } catch (err) {
    // 界面保持干净，出错只在控制台留痕
    console.error('My Goals init failed:', err);
  }
})();
