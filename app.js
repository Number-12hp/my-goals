/* My Goals —— 纯前端目标清单
   数据保存在浏览器 localStorage；支持中/英/泰三语、深/浅色主题。
   ⚠ 当前数据存储在本地浏览器：换浏览器或清空缓存会重新开始。
     要做「跟着人走」需要接入云端（见 README / 部署说明）。 */

(() => {
  'use strict';

  const W = typeof window !== 'undefined' ? window : {};
  const D = typeof document !== 'undefined' ? document : null;
  if (!D) return;

  const STORE_KEY = 'xiaomubiao.goals.v1';
  const THEME_KEY = 'xiaomubiao.theme.v1';
  const LANG_KEY  = 'xiaomubiao.lang.v1';

  const SCOPES = { year: {}, month: {}, week: {}, day: {} };
  const TYPES  = { main: {}, side: {} };

  /* ---------------- 文案字典 ---------------- */

  const STRINGS = {
    zh: {
      MN: ['1月', '2月', '3月', '4月', '5月', '6月',
           '7月', '8月', '9月', '10月', '11月', '12月'],
      WD: ['日', '一', '二', '三', '四', '五', '六'],

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
      delLabel: '删除这个目标', delText: '删除',
      warnEmpty: '先写点什么吧～',
      tAdd: '已添加 ✨', tDone: '完成啦，真棒 🎉', tUndone: '已移回清单',
      tDeleted: t => `已删除「${t}」`, tCleared: n => `已清空 ${n} 条完成记录`,
      tUndo: '已撤销删除', tNoDone: '还没有已完成的目标',
      cDelete: t => `删除目标「${t}」？`, cClear: n => `确定清空这 ${n} 条完成记录吗？`,
      emptyNoGoals: '还没有目标。在上面写一个吧，比如「看一部电影」🎬',
      emptyAllDone: '这一批目标都完成啦，去下面的「已完成」里看看吧 🎉',
      emptyFiltered: '这个筛选下暂时没有目标，换个筛选看看～',
      emptyArchive: '完成的目标会出现在这里',
      saveFail: '⚠ 保存失败：浏览器禁止了本地存储，改动关掉页面就会丢',
      undo: '撤销'
    },

    en: {
      MN: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      WD: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],

      langAria: 'Switch language', themeAria: 'Switch dark / light',
      ph: 'What do you want to do?', goalAria: 'Goal text',
      lblScope: 'Period', lblDate: 'Date', lblType: 'Type',
      gScope: 'Goal period', gType: 'Main or side', gFilter: 'Filter', dateAria: 'Date',
      scYear: 'Year', scMonth: 'Month', scWeek: 'Week', scDay: 'Day',
      typeMain: 'Main', typeSide: 'Side',
      add: 'Add', fAll: 'All', archive: 'Completed', clearDone: 'Clear completed',
      statActive: 'Active', statDone: 'Done', statAll: 'Total',
      uYear: n => `Year ${n}`,
      uMonth: (y, m) => `${STRINGS.en.MN[m - 1]} ${y}`,
      uWeek: (y, w) => `Week ${w}, ${y}`,
      uDay: (m, d, wd) => `${STRINGS.en.MN[m - 1]} ${d}, ${wd}`,
      overdue: 'Overdue',
      justNow: 'just completed',
      minAgo: n => `completed ${n} min ago`,
      todayAt: (h, m) => `completed today ${h}:${m}`,
      doneOn: (m, d) => `completed ${STRINGS.en.MN[m - 1]} ${d}`,
      markDone: 'Mark as done', undoDone: 'Mark as not done',
      delLabel: 'Delete this goal', delText: 'Delete',
      warnEmpty: 'Write something first',
      tAdd: 'Added', tDone: 'Nice, done!', tUndone: 'Moved back to the list',
      tDeleted: t => `Deleted “${t}”`, tCleared: n => `Cleared ${n} completed`,
      tUndo: 'Deletion undone', tNoDone: 'Nothing completed yet',
      cDelete: t => `Delete “${t}”?`, cClear: n => `Clear all ${n} completed goals?`,
      emptyNoGoals: 'No goals yet. Add one above — like “Watch a movie”.',
      emptyAllDone: 'All done here. Check the Completed section below.',
      emptyFiltered: 'Nothing in this filter. Try another one.',
      emptyArchive: 'Finished goals show up here',
      saveFail: '⚠ Could not save: this browser blocks local storage, changes will be lost on close',
      undo: 'Undo'
    },

    th: {
      MN: ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
           'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'],
      WD: ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'],

      langAria: 'เปลี่ยนภาษา', themeAria: 'สลับโหมดมืด / สว่าง',
      ph: 'อยากทำอะไรดี?', goalAria: 'ข้อความเป้าหมาย',
      lblScope: 'ช่วงเวลา', lblDate: 'วันที่', lblType: 'ประเภท',
      gScope: 'ช่วงเวลาของเป้าหมาย', gType: 'สายหลักหรือสายรอง',
      gFilter: 'ตัวกรอง', dateAria: 'วันที่',
      scYear: 'ปี', scMonth: 'เดือน', scWeek: 'สัปดาห์', scDay: 'วัน',
      typeMain: 'สายหลัก', typeSide: 'สายรอง',
      add: 'เพิ่ม', fAll: 'ทั้งหมด', archive: 'เสร็จแล้ว', clearDone: 'ล้างรายการที่เสร็จ',
      statActive: 'กำลังทำ', statDone: 'เสร็จแล้ว', statAll: 'ทั้งหมด',
      uYear: n => `พ.ศ. ${n + 543}`,
      uMonth: (y, m) => `${STRINGS.th.MN[m - 1]} ${y + 543}`,
      uWeek: (y, w) => `สัปดาห์ที่ ${w} ปี ${y + 543}`,
      uDay: (m, d, wd) => `${d} ${STRINGS.th.MN[m - 1]} ${wd}`,
      overdue: 'เลยกำหนด',
      justNow: 'เพิ่งเสร็จ',
      minAgo: n => `เสร็จเมื่อ ${n} นาทีที่แล้ว`,
      todayAt: (h, m) => `เสร็จวันนี้ ${h}:${m}`,
      doneOn: (m, d) => `เสร็จเมื่อ ${d} ${STRINGS.th.MN[m - 1]}`,
      markDone: 'ทำเครื่องหมายว่าเสร็จ', undoDone: 'ยกเลิกการเสร็จ',
      delLabel: 'ลบเป้าหมายนี้', delText: 'ลบ',
      warnEmpty: 'พิมพ์อะไรก่อนนะ',
      tAdd: 'เพิ่มแล้ว', tDone: 'เยี่ยม เสร็จแล้ว!', tUndone: 'ย้ายกลับไปที่รายการ',
      tDeleted: t => `ลบ “${t}” แล้ว`, tCleared: n => `ล้างรายการที่เสร็จ ${n} รายการ`,
      tUndo: 'ยกเลิกการลบแล้ว', tNoDone: 'ยังไม่มีรายการที่เสร็จ',
      cDelete: t => `ลบ “${t}” ?`, cClear: n => `ล้างรายการที่เสร็จทั้ง ${n} รายการหรือไม่?`,
      emptyNoGoals: 'ยังไม่มีเป้าหมาย เพิ่มอันแรกด้านบนได้เลย',
      emptyAllDone: 'ทำครบแล้ว ไปดูที่ส่วน “เสร็จแล้ว” ด้านล่าง',
      emptyFiltered: 'ไม่มีรายการในตัวกรองนี้ ลองเปลี่ยนตัวกรองดู',
      emptyArchive: 'เป้าหมายที่ทำเสร็จจะแสดงที่นี่',
      saveFail: '⚠ บันทึกไม่สำเร็จ: เบราว์เซอร์ปิดกั้นที่เก็บข้อมูลชั่วคราว การเปลี่ยนแปลงจะหายเมื่อปิดหน้า',
      undo: 'ยกเลิก'
    }
  };

  const LANGS = [
    { code: 'zh', name: '中文' },
    { code: 'en', name: 'English' },
    { code: 'th', name: 'ไทย' }
  ];

  let lang = 'zh';
  const t = (k, a, b, c) => {
    const dict = STRINGS[lang] || STRINGS.zh;
    const v = dict[k];
    if (typeof v === 'function') return v(a, b, c);
    return v !== undefined ? v : (STRINGS.zh[k] || k);
  };

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

  // 尽量按访客的浏览器语言自动选择
  const detectLang = () => {
    try {
      const saved = storage.get(LANG_KEY);
      if (STRINGS[saved]) return saved;
    } catch (e) {}
    const nav = String((W.navigator && (W.navigator.language || W.navigator.userLanguage)) || 'zh');
    if (/^zh/i.test(nav)) return 'zh';
    if (/^th/i.test(nav)) return 'th';
    return 'en';
  };

  /* ---------------- DOM ---------------- */

  const board       = document.getElementById('board');
  const archiveList = document.getElementById('archiveList');
  const archiveBox  = document.getElementById('archiveBox');
  const archiveCount= document.getElementById('archiveCount');
  const archiveLabel= document.getElementById('archiveLabel');
  const statsEl     = document.getElementById('stats');
  const form        = document.getElementById('form');
  const titleInput  = document.getElementById('title');
  const dateInput   = document.getElementById('date');
  const hintEl      = document.getElementById('hint');
  const scopeSeg    = document.getElementById('scopeSeg');
  const typeSeg     = document.getElementById('typeSeg');
  const langBtn     = document.getElementById('langBtn');
  const langMenu    = document.getElementById('langMenu');
  const langIcon    = document.getElementById('langIcon');
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

  function periodLabel(scopeName, dateStr) {
    const d = parseDate(dateStr);
    if (scopeName === 'year')  return t('uYear', d.getFullYear());
    if (scopeName === 'month') return t('uMonth', d.getFullYear(), d.getMonth() + 1);
    if (scopeName === 'week') {
      const w = isoWeek(d);
      return t('uWeek', w.year, w.week);
    }
    const wd = (STRINGS[lang] || STRINGS.zh).WD[d.getDay()];
    return t('uDay', d.getMonth() + 1, d.getDate(), wd);
  }

  // ISO 8601 周：含当年第一个周四的那周为第 1 周
  function isoWeek(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const y = d.getFullYear();
    const firstThu = new Date(y, 0, 4);
    firstThu.setDate(firstThu.getDate() + 3 - ((firstThu.getDay() + 6) % 7));
    return { year: y, week: 1 + Math.round((d - firstThu) / 604800000) };
  }

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

  const reduceMotion = () =>
    !!(W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------------- 渲染 ---------------- */

  let entranceDone = false;   // 首次渲染才播放入场，之后重绘不重播
  let popId = null;           // 刚被撤销回来的那条，做一次弹入

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

  // 看板只放未完成的目标
  function matchFilter(g) {
    if (g.done) return false;
    if (filter === 'main') return g.type === 'main';
    if (filter === 'side') return g.type === 'side';
    return true;
  }

  function cardMarkup(g, inArchive) {
    const meta = [t('sc' + g.scope.charAt(0).toUpperCase() + g.scope.slice(1)),
                  t(g.type === 'main' ? 'typeMain' : 'typeSide')]
      .concat(isOverdue(g) ? [t('overdue')] : [])
      .concat(inArchive ? [fmtDoneAt(g.doneAt)] : [])
      .filter(Boolean).map(esc).join(' · ');
    const checkTitle = inArchive ? t('undoDone') : t('markDone');
    return `
      <div class="card${inArchive ? ' done is-done' : ''}${g.id === popId ? ' pop' : ''}"
           data-id="${g.id}" data-type="${g.type}">
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
      const msg = !goals.length ? t('emptyNoGoals')
        : (unDone.length === 0) ? t('emptyAllDone') : t('emptyFiltered');
      html = `<div class="empty">${esc(msg)}</div>`;
    }
    board.innerHTML = html;
    popId = null;

    if (!entranceDone) {
      entranceDone = true;
      playEntrance(board);
    }
  }

  function renderArchive() {
    const done = goals.filter(g => g.done)
      .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    archiveCount.textContent = done.length;
    archiveList.innerHTML = done.length
      ? done.map(g => cardMarkup(g, true)).join('')
      : `<div class="empty">${esc(t('emptyArchive'))}</div>`;
  }

  /* ---------------- 过渡动画 ---------------- */

  // 首次进入：分组依次淡入上浮
  function playEntrance(root) {
    if (reduceMotion()) return;
    const groups = root.querySelectorAll('.group');
    groups.forEach((el, i) => {
      el.animate(
        [{ opacity: 0, transform: 'translateY(10px)' },
         { opacity: 1, transform: 'none' }],
        { duration: 380, delay: Math.min(i * 70, 280), easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' }
      );
    });
    const empty = root.querySelector('.empty');
    if (empty) {
      empty.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
    }
  }

  // 勾选完成：先打勾、再让整行收起移出（真实高度动画，任意行高都顺滑）
  function animateRowOut(cardEl, after) {
    if (!cardEl || !cardEl.animate || reduceMotion()) { after(); return; }
    const h = cardEl.getBoundingClientRect().height;
    cardEl.style.overflow = 'hidden';
    const anim = cardEl.animate(
      [
        { height: h + 'px', opacity: 1, transform: 'translateX(0)' },
        { height: '0px', opacity: 0, transform: 'translateX(16px)' }
      ],
      { duration: 320, easing: 'cubic-bezier(.4,0,.6,1)' }
    );
    let done = false;
    const finish = () => { if (done) return; done = true; after(); };
    anim.onfinish = finish;
    anim.oncancel = finish;
    setTimeout(finish, 420);   // 兜底：动画事件在个别环境可能不触发
  }

  /* ---------------- 分段选择器的滑块 ---------------- */

  // 把选中色块对准当前选项；切换时它会自己滑过去
  function placeThumb(seg) {
    if (!seg || !seg.querySelectorAll) return;
    const thumb = seg.querySelector('.seg-thumb');
    const btns = seg.querySelectorAll('button');
    if (!thumb || !thumb.style || !btns || !btns.length) return;
    let target = null;
    btns.forEach(b => { if (b.classList.contains('on')) target = b; });
    if (!target) target = btns[0];
    const pad = seg.clientLeft || 0;
    const left = Math.max(0, (target.offsetLeft || 0) - pad);
    const w = target.offsetWidth || 0;
    if (typeof thumb.style.setProperty === 'function') {
      thumb.style.setProperty('--seg-left', left + 'px');
      thumb.style.setProperty('--seg-w', w + 'px');
    } else {
      // 兜底：极老或受限环境
      thumb.style.left = left + 'px';
      thumb.style.width = w + 'px';
    }
  }

  // 首次定位不播动画，之后切换才滑
  function markThumbReady(seg) {
    if (!seg) return;
    seg.dataset.ready = '1';
  }

  /* ---------------- 静态文案与语言 ---------------- */

  function applyStatic() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : (lang === 'th' ? 'th' : 'en');
    D.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    D.querySelectorAll('[data-i18n-ph]').forEach(el => {
      el.setAttribute('placeholder', t(el.dataset.i18nPh));
    });
    D.querySelectorAll('[data-i18n-aria]').forEach(el => {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
    if (langBtn) langBtn.setAttribute('aria-label', t('langAria'));
  }

  function renderLangMenu() {
    if (!langMenu) return;
    langMenu.innerHTML = LANGS.map(l => `
      <button type="button" role="menuitemradio" aria-checked="${l.code === lang}"
              class="lang-item${l.code === lang ? ' on' : ''}" data-lang="${l.code}">
        <span class="flag flag-${l.code}" aria-hidden="true"></span>
        <span class="lang-item-name">${esc(l.name)}</span>
        <span class="lang-tick" aria-hidden="true">✓</span>
      </button>`).join('');
  }

  // 语言变了，按钮文字宽度也变，滑块要重新对准
  function relayoutSegments() {
    placeThumb(scopeSeg);
    placeThumb(typeSeg);
  }

  function closeLangMenu() {
    if (!langMenu || !langBtn) return;
    // 先去掉 open 让它淡出，再收起
    if (langMenu.classList.contains('open')) {
      langMenu.classList.remove('open');
      const t = setTimeout(() => { langMenu.hidden = true; }, 180);
      langMenu._hideTimer = t;
    } else {
      langMenu.hidden = true;
    }
    langBtn.setAttribute('aria-expanded', 'false');
  }

  function openLangMenu() {
    if (!langMenu || !langBtn) return;
    renderLangMenu();
    clearTimeout(langMenu._hideTimer);
    langMenu.hidden = false;
    // 强制一次重排后再加 open，让过渡稳定触发
    // （不用 requestAnimationFrame：后台标签页里它可能不执行）
    if (langMenu.offsetHeight >= 0) langMenu.classList.add('open');
    langBtn.setAttribute('aria-expanded', 'true');
    const first = langMenu.querySelector('.lang-item');
    if (first) first.focus();
  }

  function setLang(next, opts) {
    lang = STRINGS[next] ? next : 'zh';
    try { storage.set(LANG_KEY, lang); } catch (e) {}
    applyStatic();
    if (!opts || !opts.soft) {
      render();
    } else {
      renderStats();
      renderArchive();
    }
    relayoutSegments();      // 文字长度变了，滑块重新对准
  }

  if (langBtn) {
    langBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (langMenu.hidden) openLangMenu(); else closeLangMenu();
    });
  }
  if (langMenu) {
    langMenu.addEventListener('click', e => {
      const item = e.target.closest('[data-lang]');
      if (!item) return;
      const pick = item.dataset.lang;
      closeLangMenu();
      if (pick === lang) return;
      setLang(pick, { soft: D.activeElement === titleInput });
      // 语言切换后按钮上给一次轻微反馈
      if (langIcon && langIcon.animate && !reduceMotion()) {
        langIcon.animate(
          [{ transform: 'scale(1) rotate(0)' }, { transform: 'scale(1.18) rotate(-8deg)' },
           { transform: 'scale(1) rotate(0)' }],
          { duration: 320, easing: 'cubic-bezier(.3,1.4,.5,1)' }
        );
      }
    });
  }

  D.addEventListener('click', e => {
    if (!langMenu || langMenu.hidden) return;
    if (e.target.closest('#langWrap')) return;
    closeLangMenu();
  });

  D.addEventListener('keydown', e => {
    if (e.key === 'Escape' && langMenu && !langMenu.hidden) {
      closeLangMenu();
      if (langBtn) langBtn.focus();
    }
  });

  /* ---------------- 交互 ---------------- */

  scopeSeg.addEventListener('click', e => {
    const btn = e.target.closest('[data-scope]');
    if (!btn) return;
    scope = btn.dataset.scope;
    scopeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
    placeThumb(scopeSeg);            // 色块滑过去
    updateHint();
  });

  typeSeg.addEventListener('click', e => {
    const btn = e.target.closest('[data-type]');
    if (!btn) return;
    type = btn.dataset.type;
    typeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
    placeThumb(typeSeg);
  });

  function updateHint() {
    hintEl.textContent = '';
    hintEl.classList.remove('warn');
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      hintEl.textContent = t('warnEmpty');
      hintEl.classList.add('warn');
      titleInput.focus();
      return;
    }
    const beforeIds = new Set(goals.map(g => g.id));
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
    // 新加入的那一行淡入
    const fresh = goals.find(g => !beforeIds.has(g.id));
    if (fresh && !reduceMotion()) {
      const el = board.querySelector(`.card[data-id="${fresh.id}"]`);
      if (el && el.animate) {
        el.animate(
          [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
          { duration: 240, easing: 'cubic-bezier(.2,.7,.3,1)' }
        );
      }
    }
    toast(t('tAdd'));
  });

  function toggleDone(id, cardEl) {
    const g = goals.find(x => x.id === id);
    if (!g) return;
    if (!g.done) {
      g.done = true;
      g.doneAt = Date.now();
      save();
      cardEl.classList.add('is-done');          // 立刻打勾、划线
      animateRowOut(cardEl, () => {
        render();
        archiveBox.open = true;
        const moved = archiveList.querySelector(`.card[data-id="${id}"]`);
        if (moved && moved.animate && !reduceMotion()) {
          moved.animate(
            [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }],
            { duration: 300, easing: 'cubic-bezier(.2,.7,.3,1)' }
          );
        }
        toast(t('tDone'));
      });
    } else {
      g.done = false;
      g.doneAt = null;
      save();
      popId = g.id;                             // 撤销回来时弹入
      render();
      toast(t('tUndone'));
    }
  }

  // 某些受限环境会拦截原生 confirm（抛异常或返回 undefined），
  // 那会让删除彻底失效；这里失败就当作确认，删除后仍可撤销。
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
    undoEl.innerHTML =
      `<span class="undo-text">${esc(text)}</span>` +
      `<button type="button" class="undo-btn" data-undo>${esc(t('undo'))}</button>` +
      `<button type="button" class="undo-close" data-undo-close aria-label="✕">✕</button>`;
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
          goals = undoStack;
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
      const snapshot = goals.slice();
      const finish = () => {
        goals = goals.filter(x => x.id !== g.id);
        save();
        render();
        showUndo(t('tDeleted', g.title), snapshot);
      };
      animateRowOut(card, finish);
    }
  });

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
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    if (themeBtn.animate && !reduceMotion()) {
      themeBtn.animate(
        [{ transform: 'rotate(0) scale(1)' }, { transform: 'rotate(180deg) scale(1.1)' },
         { transform: 'rotate(360deg) scale(1)' }],
        { duration: 420, easing: 'cubic-bezier(.3,1.2,.4,1)' }
      );
    }
  });

  /* ---------------- 初始化 ---------------- */

  function showCloudHint() {
    const proto = W.location && W.location.protocol;
    const host = W.location && W.location.hostname;
    if (!cloudHost || proto === 'file:' || !host) return;
    const label = {
      zh: '数据保存在你自己的浏览器里',
      en: 'Your data stays in your own browser',
      th: 'ข้อมูลเก็บไว้ในเบราว์เซอร์ของคุณ'
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
    renderLangMenu();
    closeLangMenu();          // 显式确保菜单是收起的初始状态
    updateHint();
    render();
    showCloudHint();

    // 首次定位滑块（此时不播动画），之后窗口变化再重新对准
    relayoutSegments();
    markThumbReady(scopeSeg);
    markThumbReady(typeSeg);
    if (W.addEventListener) {
      W.addEventListener('resize', () => { relayoutSegments(); });
    }

    // 首次打开给一点示例，方便理解界面
    if (!goals.length) {
      const demo = {
        zh: ['看一部一直想看的电影', '读完一本搁置很久的书'],
        en: ['Watch a movie I keep meaning to see', 'Finish a book I put down long ago'],
        th: ['ดูหนังที่อยากดูมานาน', 'อ่านหนังสือที่ค้างไว้นานแล้ว']
      };
      const [a, b] = demo[lang] || demo.zh;
      goals = [
        { id: 'demo1', title: a, scope: 'week', type: 'side',
          date: todayStr(), done: false, doneAt: null, createdAt: new Date().toISOString() },
        { id: 'demo2', title: b, scope: 'month', type: 'main',
          date: todayStr(), done: false, doneAt: null, createdAt: new Date().toISOString() }
      ];
      save();
      render();
    }
  }

  try {
    boot();
  } catch (err) {
    console.error('My Goals init failed:', err);
  }
})();
