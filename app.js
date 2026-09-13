/* 小目标 · 目标清单
   纯前端，数据保存在 localStorage，无需联网。 */

(() => {
  'use strict';

  // 用 window.xxx 兜底：避免某些环境下全局变量拿不到而静默中断脚本
  const W = typeof window !== 'undefined' ? window : {};
  const D = typeof document !== 'undefined' ? document : null;
  if (!D) return;

  const STORE_KEY = 'xiaomubiao.goals.v1';
  const THEME_KEY = 'xiaomubiao.theme.v1';

  const SCOPES = {
    year:  { name: '年', order: 1 },
    month: { name: '月', order: 2 },
    week:  { name: '周', order: 3 },
    day:   { name: '天', order: 4 }
  };
  const TYPES = {
    main: { name: '主线' },
    side: { name: '支线' }
  };

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
  const filtersEl   = document.getElementById('filters');
  const themeBtn    = document.getElementById('themeBtn');
  const clearDoneBtn= document.getElementById('clearDone');
  const toastEl     = document.getElementById('toast');
  const undoEl      = document.getElementById('undo');

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
    try { return test(W.localStorage); } catch (e) { console.warn('localStorage 不可用', e); }
    try { return test(W.sessionStorage); } catch (e) { console.warn('sessionStorage 不可用', e); }
    const mem = new Map();
    console.warn('浏览器禁止了本地存储，已退回内存模式（关掉页面数据会丢）');
    return { get: k => (mem.has(k) ? mem.get(k) : null), set: (k, v) => mem.set(k, v),
             level: 'memory' };
  })();

  let goals   = [];
  let filter  = 'undone';   // 「全部」：只显示未完成的目标
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
      console.warn('读取数据失败', e);
      return [];
    }
  }

  function save() {
    try {
      storage.set(STORE_KEY, JSON.stringify(goals));
    } catch (e) {
      console.error('保存失败', e);
      toast('⚠ 保存失败：浏览器禁止了本地存储，改动关掉页面就会丢');
    }
  }

  /* ---------------- 展示用文案 ---------------- */

  const WD = ['日', '一', '二', '三', '四', '五', '六'];

  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // 该目标所属周期的标签，例：2026年 / 2026年2月 / 2026年第7周 / 2月14日 周六
  function periodLabel(scope, dateStr) {
    const d = parseDate(dateStr);
    if (scope === 'year')  return `${d.getFullYear()}年`;
    if (scope === 'month') return `${d.getFullYear()}年${d.getMonth() + 1}月`;
    if (scope === 'week') {
      const w = isoWeek(d);
      return `${w.year}年第${w.week}周`;
    }
    return `${d.getMonth() + 1}月${d.getDate()}日 周${WD[d.getDay()]}`;
  }

  // ISO 8601 周：周一为一周开始，含当年第一个周四的那周为第 1 周。
  // 返回 { year, week }，注意跨年时 year 是「周所属的年份」而不是自然年。
  function isoWeek(date) {
    const t = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); // 移到本周四
    const y = t.getFullYear();
    const firstThu = new Date(y, 0, 4);
    firstThu.setDate(firstThu.getDate() + 3 - ((firstThu.getDay() + 6) % 7));
    return { year: y, week: 1 + Math.round((t - firstThu) / 604800000) };
  }

  // 周期排序用的键（越小越靠前）
  function periodKey(scope, dateStr) {
    const d = parseDate(dateStr);
    if (scope === 'year')  return d.getFullYear();
    if (scope === 'month') return d.getFullYear() * 100 + d.getMonth();
    if (scope === 'week') {
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
    if (diff < 60000) return '刚刚完成';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前完成`;
    if (d.toDateString() === new Date().toDateString()) {
      return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())} 完成`;
    }
    return `${d.getMonth() + 1}月${d.getDate()}日 完成`;
  }

  /* ---------------- 渲染 ---------------- */

  function render() {
    renderStats();
    renderBoard();
    renderArchive();
  }

  function renderStats() {
    const total = goals.length;
    const done = goals.filter(g => g.done).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    statsEl.innerHTML = `
      <div class="stat"><b>${total}</b><span>全部目标</span></div>
      <div class="stat"><b>${done}</b><span>已完成</span>
        <div class="stat-bar"><i style="width:${pct}%"></i></div>
      </div>
      <div class="stat"><b>${total - done}</b><span>进行中</span></div>`;
  }

  // 看板只放未完成的目标：已完成的都归到下面「已完成」区块里
  function matchFilter(g) {
    if (g.done) return false;
    if (filter === 'main') return g.type === 'main';
    if (filter === 'side') return g.type === 'side';
    return true;
  }

  function cardMarkup(g, inArchive) {
    const t = TYPES[g.type];
    const overdue = isOverdue(g);
    // 卡片上只留「周期 · 主线/支线」加备注；日期已经在分组标题里了，不重复
    const meta = [SCOPES[g.scope].name, t.name]
      .concat(overdue ? ['已过期'] : [])
      .concat(inArchive ? [fmtDoneAt(g.doneAt)] : [])
      .filter(Boolean).map(esc).join(' · ');
    return `
      <div class="card${inArchive ? ' done is-done' : ''}" data-id="${g.id}" data-type="${g.type}">
        <button class="check" type="button" title="${inArchive ? '撤销完成' : '标记完成'}">
          <span class="check-mark">✓</span>
        </button>
        <div class="card-body">
          <span class="txt">${esc(g.title)}</span>
          <div class="meta">${meta}</div>
        </div>
        <button class="del ${inArchive ? 'always' : ''}" type="button" title="删除这个目标"
                aria-label="删除这个目标">删除</button>
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
        // 同一周期：未完成在前，然后按创建时间
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
      html += `<div style="height:20px"></div>`;
    }

    if (!html) {
      // 区分三种"空"：还没目标 / 真的全做完了 / 只是被筛选挡住了
      const unDone = goals.filter(g => !g.done);
      const msg = !goals.length
        ? '还没有目标。在上面写一个吧，比如「看一部电影」🎬'
        : (unDone.length === 0 && goals.length > 0)
          ? '这一批目标都完成啦，去下面的「已完成」里看看吧 🎉'
          : '这个筛选下暂时没有目标，换个筛选看看～';
      html = `<div class="empty">${msg}</div>`;
    }
    board.innerHTML = html;
  }

  function renderArchive() {
    const done = goals.filter(g => g.done)
      .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    archiveCount.textContent = done.length;
    if (!done.length) {
      archiveList.innerHTML = `<div class="empty">完成的目标会出现在这里 ✓</div>`;
      return;
    }
    archiveList.innerHTML = done.map(g => cardMarkup(g, true)).join('');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
      hintEl.textContent = '先写点什么吧～';
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
    toast('已添加 ✨');
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
      toast('已移回清单');
    }
  }

  // 完成后：先打勾划掉，再把卡片收进「已完成」
  function animOut(cardEl, id) {
    cardEl.classList.add('is-done');
    cardEl.style.maxHeight = cardEl.offsetHeight + 'px';
    void cardEl.offsetHeight;          // 强制重排，让高度过渡生效

    // 默认「全部」视图下，勾完这张卡片本来就不该留在看板上，节奏快一点
    const quick = filter === 'undone';

    setTimeout(() => {
      if (!cardEl.isConnected) return;
      cardEl.classList.add('leaving');
      cardEl.style.maxHeight = '0px';
    }, quick ? 260 : 340);

    setTimeout(() => {
      render();                        // 卡片离开看板，同时进入已完成列表
      archiveBox.open = true;
      const moved = archiveList.querySelector(`.card[data-id="${id}"]`);
      if (moved) {
        moved.classList.add('pop');
        setTimeout(() => moved.classList.remove('pop'), 380);
      }
      toast('完成啦，真棒 🎉');
    }, quick ? 480 : 760);
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
      if (!safeConfirm(`删除目标「${g.title}」？`)) return;
      const snapshot = goals.slice();      // 删除前的快照，用于撤销
      goals = goals.filter(x => x.id !== g.id);
      save();
      render();
      showUndo(`已删除「${g.title}」`, snapshot);
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
    if (!n) return toast('还没有已完成的目标');
    if (!safeConfirm(`确定清空这 ${n} 条完成记录吗？`)) return;
    const snapshot = goals.slice();
    goals = goals.filter(g => !g.done);
    save();
    render();
    showUndo(`已清空 ${n} 条完成记录`, snapshot);
  });

  // 提示条
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1900);
  }

  /* ---------------- 主题 ---------------- */

  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
    try { storage.set(THEME_KEY, t); } catch (e) {}
  }

  themeBtn.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  /* ---------------- 确认与撤销 ---------------- */

  // 某些受限环境（预览 iframe、sandbox 页面）会拦截原生 confirm，
  // 直接调用会抛异常或返回 undefined —— 那会让删除彻底失效。
  // 这里失败就当作「确认」，删除后仍可用撤销条反悔。
  function safeConfirm(msg) {
    try {
      const r = W.confirm ? W.confirm(msg) : true;
      return r === undefined ? true : r;   // 被拦截时返回 undefined → 按确认处理
    } catch (e) {
      console.warn('确认弹窗被环境拦截，已按确认处理', e);
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
      `<button type="button" class="undo-btn" data-undo>撤销</button>` +
      `<button type="button" class="undo-close" data-undo-close title="关闭">✕</button>`;
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
          // 回到删除前的状态：位置和内容都还原
          goals = undoStack;
          save();
          render();
          toast('已撤销删除');
        }
        hideUndo();
      } else if (e.target.closest('[data-undo-close]')) {
        hideUndo();
      }
    });
  }

  /* ---------------- 初始化 ---------------- */

  function boot() {
    goals = load();
    syncChips();

    let savedTheme = null;
    try { savedTheme = storage.get(THEME_KEY); } catch (e) {}
    if (!savedTheme) {
      savedTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark' : 'light';
    }
    applyTheme(savedTheme);

    dateInput.value = todayStr();
    updateHint();
    render();

    // 首次打开给一点示例，方便理解界面
    if (!goals.length) {
      goals = [
        { id: 'demo1', title: '看一部一直想看的电影', scope: 'week', type: 'side',
          date: todayStr(), done: false, doneAt: null, createdAt: new Date().toISOString() },
        { id: 'demo2', title: '读完一本搁置很久的书', scope: 'month', type: 'main',
          date: todayStr(), done: false, doneAt: null, createdAt: new Date().toISOString() }
      ];
      save();
      render();
      toast('这是两条示例，可以随时删掉 👋');
    }
  }

  try {
    boot();
  } catch (err) {
    // 界面保持干净，出错只在控制台留痕
    console.error('小目标初始化失败：', err);
  }
})();
