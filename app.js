/* My Goals —— 目标清单（本地优先 + Supabase 云端同步）
   ─────────────────────────────────────────────────────────
   数据流：
     改数据 → 立刻写 localStorage（秒响应）→ 后台推送到 Supabase
     打开页 → 先渲染本地（秒开）→ 登录后拉云端 → 按 updated_at 合并
   断网 / 未登录时退化为纯本地模式，功能不受影响。
   ─────────────────────────────────────────────────────────
   云端配置见下方 CLOUD 常量；表结构与 RLS 见 supabase-schema.sql */

(() => {
  'use strict';

  const W = typeof window !== 'undefined' ? window : {};
  const D = typeof document !== 'undefined' ? document : null;
  if (!D) return;

  const STORE_KEY = 'xiaomubiao.goals.v1';
  const THEME_KEY = 'xiaomubiao.theme.v1';
  const LANG_KEY  = 'xiaomubiao.lang.v1';
  const OFFLINE_KEY = 'xiaomubiao.offline.v1';   // 记住"我选择离线使用"
  const TOMB_KEY  = 'xiaomubiao.tombstones.v1';  // 已删除 id 的墓碑（防止删掉的记录复活）

  /* ══════════════════ 初始数据 ══════════════════
     故意留空：新用户面对干净的列表。
     （之前这里会塞两条演示目标，注册登录时会被当成真实数据同步到云端，
       造成无效数据堆积，所以去掉了。） */
  const defaultGoals = [];

  /* 删除墓碑
     ───────────────────────────────────────────
     我们用"真删除"（云端 data 行会被真的删掉），但真删除有个经典问题：
     另一台设备本地还留着这条记录，它下次同步会把它重新 upsert 回云端 —— 也就是"复活"。
     解决办法就是墓碑：本地记下"我在什么时间删了哪条"，
     下次拉取时发现云端又出现了它，就再删一次；
     本地待推送的也不会再上传它。
     墓碑保留 30 天后自动清理（足够覆盖设备长期离线的场景）。 */
  const TOMB_TTL = 30 * 24 * 3600 * 1000;
  let tombstones = new Map();   // id -> 删除时间（毫秒）

  /* ══════════════════ 云端配置 ══════════════════
     这里必须是【不带路径】的项目根地址。
     如果把 /rest/v1/ 之类的后缀写进去，所有请求都会 404。

     为什么用 api.114012.xyz 而不是 supabase.co？
       国内网络直连 supabase.co 会被阻断（DNS 能解析，但 TLS 连接被重置），
       所以中间加了一层 Cloudflare Worker 反向代理：
         浏览器 → https://api.114012.xyz → Worker → tmimeajjjomgugbrtime.supabase.co
       Worker 源码见 cloudflare-worker/supabase-proxy.js

     想切回官方直连（国外网络下可以用），把 url 换成：
       'https://tmimeajjjomgugbrtime.supabase.co'

     anon key 是公开的（设计如此），真正保护数据的是 Supabase 的 RLS 策略。 */
  const CLOUD = {
    url: 'https://api.114012.xyz',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtaW1lYWpqam9tZ3VnYnJ0aW1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNzkxMTQsImV4cCI6MjEwNDk1NTExNH0.Ge0k8tcSrxJi-ewvcHIb1CWExF6tHSOLHEnbDe5gAGs',
    table: 'goals'
  };

  const ENTRY  = { idea: {}, plan: {} };
  const STATUS = { inbox: {}, doing: {}, done: {} };
  const LOOPS  = { none: {}, daily: {}, weekly: {}, monthly: {} };
  const LOOP_ORDER = ['none', 'daily', 'weekly', 'monthly'];
  const DEFAULT_CAT = '未分类';   // 与建表默认值保持一致
  const CAT_MAX = 40;

  /* ---------------- 文案字典（7 种语言） ---------------- */

  // 注意：每种语言都必须提供完全相同的键，测试会强制校验
  const STRINGS = {
    zh: {
      MN: ['1月', '2月', '3月', '4月', '5月', '6月',
           '7月', '8月', '9月', '10月', '11月', '12月'],
      WD: ['日', '一', '二', '三', '四', '五', '六'],

      navGoals: "目标",

      navCalendar: "日历",

      navStats: "统计",

      navSettings: "设置",

      menuLabel: '菜单', langShort: '语言',
      themeShort: '主题', userShort: '账号',

      calSub: '点任意日期，看那天的计划。',
      calNone: '未完成', calPart: '部分完成', calAll: '全部完成',
      calDone: '完成', calNoTask: '这天没有计划',
      calPrev: '上个月', calNext: '下个月',
      skinPaper: '纸墨', skinIris: '鸢尾', skinCobalt: '钴蓝', skinLime: '青柠',

      tabIdea: '记想法', tabPlan: '定计划',
      catPh: '分类', catNone: '未分类', catCreate: n => `创建新分类「${n}」`,
      loopNone: '不循环', loopDaily: '每天', loopWeekly: '每周', loopMonthly: '每月',
      inboxTitle: '灵感箱', inboxEmpty: '灵感箱是空的，先随便记点什么',
      actionTitle: '行动列表', actionEmpty: '还没有排好的行动',
      moveAction: '推入行动', tagIdea: '灵感', tagPlan: '计划',
      achieve: '成就', achieveSub: '按分类陈列已经完成的事。',
      achieveEmpty: '还没有完成的成就',
      needDate: '先选个日期', tMoved: '已推入行动',
      doneToday: '今天已完成', loopTimes: n => `已完成 ${n} 次`,

      soon: "这个模块还在开发中",

      progress: "今日完成进度",

      authAria: "登录 / 账号", accountLabel: "当前账号",

      langAria: '切换语言', themeAria: '切换深色 / 浅色',
      title: 'My Goals',
      subtitle: '把想做的事写下来，完成一项就轻轻打个勾。',
      progress: '完成进度',
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
      overdue: '已逾期', overdueBy: n => `已逾期 ${n} 天`, reschedule: '改期',
      doneStamp: (m, d, h, mi) => `${m}月${d}日 ${h}:${mi}`,
      doneStampY: (y, m, d, h, mi) => `${y}年${m}月${d}日 ${h}:${mi}`,
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
      tPullOnly: "已从云端恢复你的清单（未上传，避免覆盖云端）",
      undo: '撤销',

      signInTitle: '登录后云端同步',
      signInHint: '登录后，换浏览器或换设备都能找回你的清单。',
      email: '邮箱', password: '密码',
      signIn: '登录', signUp: '注册', signOut: '退出登录',
      toSignUp: '没有账号？注册', toSignIn: '已有账号？登录',
      forgot: '忘记密码', continueOffline: '暂不登录，仅本机使用',
      resetSent: '重置邮件已发送，请查收邮箱',
      syncOn: '已同步', syncOff: '同步中', syncOffline: '离线（已存在本机）',
      syncLocal: '仅本机保存', syncGuest: '未登录',
      eEmail: '请输入邮箱', ePass: '请输入密码', ePassShort: '密码至少 6 位',
      eCred: '邮箱或密码不对', eEmailUsed: '这个邮箱已经注册过了',
      eNeedConfirm: '请先到邮箱点确认链接，再回来登录',
      eOffline: '连不上云端，数据已存在本机，联网后会自动同步'
    },

    en: {
      MN: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      WD: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],

      navGoals: "Goals",

      navCalendar: "Calendar",

      navStats: "Stats",

      navSettings: "Settings",

      menuLabel: 'Menu', langShort: 'Language',
      themeShort: 'Theme', userShort: 'Account',

      calSub: 'Tap any day to see its plans.',
      calNone: 'Not done', calPart: 'Partly done', calAll: 'All done',
      calDone: 'Done', calNoTask: 'Nothing planned for this day',
      calPrev: 'Previous month', calNext: 'Next month',
      skinPaper: 'Paper', skinIris: 'Iris', skinCobalt: 'Cobalt', skinLime: 'Lime',

      tabIdea: 'Capture', tabPlan: 'Schedule',
      catPh: 'Category', catNone: 'Uncategorised', catCreate: n => `Create category “${n}”`,
      loopNone: 'No repeat', loopDaily: 'Daily', loopWeekly: 'Weekly', loopMonthly: 'Monthly',
      inboxTitle: 'Idea inbox', inboxEmpty: 'Inbox is empty — jot something down',
      actionTitle: 'Actions', actionEmpty: 'Nothing scheduled yet',
      moveAction: 'Move to action', tagIdea: 'Idea', tagPlan: 'Plan',
      achieve: 'Achievements', achieveSub: 'Everything you finished, shelved by category.',
      achieveEmpty: 'No achievements yet',
      needDate: 'Pick a date first', tMoved: 'Moved to actions',
      doneToday: 'Done today', loopTimes: n => `Completed ${n} times`,

      soon: "This section is still being built",

      progress: "Today's progress",

      authAria: "Sign in / account", accountLabel: "Signed in as",

      langAria: 'Switch language', themeAria: 'Switch dark / light',
      title: 'My Goals',
      subtitle: 'Write down what you want to do, then tick it off.',
      progress: 'Progress',
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
      overdue: 'Overdue', overdueBy: n => `Overdue ${n}d`, reschedule: 'Reschedule',
      doneStamp: (m, d, h, mi) => `${STRINGS.en.MN[m - 1]} ${d}, ${h}:${mi}`,
      doneStampY: (y, m, d, h, mi) => `${STRINGS.en.MN[m - 1]} ${d}, ${y} · ${h}:${mi}`,
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
      tPullOnly: "Restored your list from the cloud (nothing was uploaded, to avoid overwriting it)",
      undo: 'Undo',

      signInTitle: 'Sign in to sync',
      signInHint: 'Sign in and your list follows you to any browser or device.',
      email: 'Email', password: 'Password',
      signIn: 'Sign in', signUp: 'Create account', signOut: 'Sign out',
      toSignUp: 'No account? Create one', toSignIn: 'Already have an account? Sign in',
      forgot: 'Forgot password', continueOffline: 'Skip for now, keep it on this device',
      resetSent: 'Reset email sent — check your inbox',
      syncOn: 'Synced', syncOff: 'Syncing', syncOffline: 'Offline (saved on device)',
      syncLocal: 'On this device only', syncGuest: 'Not signed in',
      eEmail: 'Enter your email', ePass: 'Enter your password', ePassShort: 'Password needs at least 6 characters',
      eCred: 'Wrong email or password', eEmailUsed: 'That email is already registered',
      eNeedConfirm: 'Confirm your email first, then sign in',
      eOffline: 'Cannot reach the cloud. Your data is saved on this device and will sync later.'
    },

    th: {
      MN: ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
           'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'],
      WD: ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'],

      navGoals: "เป้าหมาย",

      navCalendar: "ปฏิทิน",

      navStats: "สถิติ",

      navSettings: "ตั้งค่า",

      menuLabel: 'เมนู', langShort: 'ภาษา',
      themeShort: 'ธีม', userShort: 'บัญชี',

      calSub: 'แตะวันใดก็ได้เพื่อดูแผนของวันนั้น',
      calNone: 'ยังไม่เสร็จ', calPart: 'เสร็จบางส่วน', calAll: 'เสร็จทั้งหมด',
      calDone: 'เสร็จ', calNoTask: 'วันนี้ไม่มีแผน',
      calPrev: 'เดือนก่อน', calNext: 'เดือนถัดไป',
      skinPaper: 'กระดาษ', skinIris: 'ไอริส', skinCobalt: 'โคบอลต์', skinLime: 'มะนาว',

      tabIdea: 'บันทึกไอเดีย', tabPlan: 'วางแผน',
      catPh: 'หมวดหมู่', catNone: 'ไม่จัดหมวด', catCreate: n => `สร้างหมวดใหม่ “${n}”`,
      loopNone: 'ไม่วนซ้ำ', loopDaily: 'ทุกวัน', loopWeekly: 'ทุกสัปดาห์', loopMonthly: 'ทุกเดือน',
      inboxTitle: 'กล่องไอเดีย', inboxEmpty: 'กล่องไอเดียยังว่างอยู่',
      actionTitle: 'รายการลงมือทำ', actionEmpty: 'ยังไม่มีแผนที่จัดไว้',
      moveAction: 'ย้ายไปลงมือทำ', tagIdea: 'ไอเดีย', tagPlan: 'แผน',
      achieve: 'ความสำเร็จ', achieveSub: 'สิ่งที่ทำเสร็จแล้ว จัดเรียงตามหมวดหมู่',
      achieveEmpty: 'ยังไม่มีความสำเร็จ',
      needDate: 'เลือกวันที่ก่อน', tMoved: 'ย้ายไปแล้ว',
      doneToday: 'วันนี้เสร็จแล้ว', loopTimes: n => `เสร็จแล้ว ${n} ครั้ง`,

      soon: "ส่วนนี้ยังอยู่ระหว่างพัฒนา",

      progress: "ความคืบหน้าวันนี้",

      authAria: "เข้าสู่ระบบ / บัญชี", accountLabel: "บัญชีที่ใช้อยู่",

      langAria: 'เปลี่ยนภาษา', themeAria: 'สลับโหมดมืด / สว่าง',
      title: 'My Goals',
      subtitle: 'จดสิ่งที่อยากทำไว้ แล้วค่อย ๆ ขีดถูกเมื่อทำเสร็จ',
      progress: 'ความคืบหน้า',
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
      overdue: 'เลยกำหนด', overdueBy: n => `เลยกำหนด ${n} วัน`, reschedule: 'เปลี่ยนวัน',
      doneStamp: (m, d, h, mi) => `${d} ${STRINGS.th.MN[m - 1]} ${h}:${mi}`,
      doneStampY: (y, m, d, h, mi) => `${d} ${STRINGS.th.MN[m - 1]} ${y} ${h}:${mi}`,
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
      tPullOnly: "กู้รายการของคุณจากคลาวด์แล้ว (ไม่ได้อัปโหลด เพื่อกันไม่ให้ทับข้อมูลบนคลาวด์)",
      undo: 'ยกเลิก',

      signInTitle: 'เข้าสู่ระบบเพื่อซิงก์',
      signInHint: 'เข้าสู่ระบบแล้วรายการจะตามคุณไปทุกเบราว์เซอร์และอุปกรณ์',
      email: 'อีเมล', password: 'รหัสผ่าน',
      signIn: 'เข้าสู่ระบบ', signUp: 'สมัคร', signOut: 'ออกจากระบบ',
      toSignUp: 'ยังไม่มีบัญชี? สมัคร', toSignIn: 'มีบัญชีแล้ว? เข้าสู่ระบบ',
      forgot: 'ลืมรหัสผ่าน', continueOffline: 'ข้ามไปก่อน ใช้เฉพาะเครื่องนี้',
      resetSent: 'ส่งอีเมลรีเซ็ตแล้ว กรุณาตรวจสอบ',
      syncOn: 'ซิงก์แล้ว', syncOff: 'กำลังซิงก์', syncOffline: 'ออฟไลน์ (บันทึกในเครื่อง)',
      syncLocal: 'บันทึกเฉพาะเครื่องนี้', syncGuest: 'ยังไม่เข้าสู่ระบบ',
      eEmail: 'กรอกอีเมล', ePass: 'กรอกรหัสผ่าน', ePassShort: 'รหัสผ่านอย่างน้อย 6 ตัวอักษร',
      eCred: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', eEmailUsed: 'อีเมลนี้สมัครแล้ว',
      eNeedConfirm: 'กรุณายืนยันอีเมลก่อน แล้วค่อยเข้าสู่ระบบ',
      eOffline: 'เชื่อมต่อคลาวด์ไม่ได้ ข้อมูลบันทึกในเครื่องแล้ว จะซิงก์เมื่อออนไลน์'
    },

    vi: {
      MN: ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6',
           'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'],
      WD: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'],

      navGoals: "Mục tiêu",

      navCalendar: "Lịch",

      navStats: "Thống kê",

      navSettings: "Cài đặt",

      menuLabel: 'Menu', langShort: 'Ngôn ngữ',
      themeShort: 'Giao diện', userShort: 'Tài khoản',

      calSub: 'Chạm vào một ngày để xem kế hoạch.',
      calNone: 'Chưa xong', calPart: 'Xong một phần', calAll: 'Xong hết',
      calDone: 'Xong', calNoTask: 'Ngày này không có kế hoạch',
      calPrev: 'Tháng trước', calNext: 'Tháng sau',
      skinPaper: 'Giấy mực', skinIris: 'Diên vĩ', skinCobalt: 'Coban', skinLime: 'Chanh',

      tabIdea: 'Ghi ý tưởng', tabPlan: 'Lên kế hoạch',
      catPh: 'Danh mục', catNone: 'Chưa phân loại', catCreate: n => `Tạo danh mục “${n}”`,
      loopNone: 'Không lặp', loopDaily: 'Hằng ngày', loopWeekly: 'Hằng tuần', loopMonthly: 'Hằng tháng',
      inboxTitle: 'Hộp ý tưởng', inboxEmpty: 'Hộp ý tưởng đang trống',
      actionTitle: 'Danh sách hành động', actionEmpty: 'Chưa có hành động nào',
      moveAction: 'Đưa vào hành động', tagIdea: 'Ý tưởng', tagPlan: 'Kế hoạch',
      achieve: 'Thành tích', achieveSub: 'Những việc đã xong, xếp theo danh mục.',
      achieveEmpty: 'Chưa có thành tích',
      needDate: 'Chọn ngày trước', tMoved: 'Đã đưa vào hành động',
      doneToday: 'Hôm nay đã xong', loopTimes: n => `Đã xong ${n} lần`,

      soon: "Mục này đang được xây dựng",

      progress: "Tiến độ hôm nay",

      authAria: "Đăng nhập / tài khoản", accountLabel: "Đang đăng nhập",

      langAria: 'Đổi ngôn ngữ', themeAria: 'Đổi chế độ tối / sáng',
      title: 'My Goals',
      subtitle: 'Ghi lại điều bạn muốn làm, xong một việc thì đánh dấu nhẹ.',
      progress: 'Tiến độ',
      ph: 'Bạn muốn làm gì?', goalAria: 'Nội dung mục tiêu',
      lblScope: 'Chu kỳ', lblDate: 'Ngày', lblType: 'Loại',
      gScope: 'Chu kỳ mục tiêu', gType: 'Chính hay phụ', gFilter: 'Bộ lọc', dateAria: 'Ngày',
      scYear: 'Năm', scMonth: 'Tháng', scWeek: 'Tuần', scDay: 'Ngày',
      typeMain: 'Chính', typeSide: 'Phụ',
      add: 'Thêm', fAll: 'Tất cả', archive: 'Đã xong', clearDone: 'Xoá mục đã xong',
      statActive: 'Đang làm', statDone: 'Đã xong', statAll: 'Tổng',
      uYear: n => `Năm ${n}`,
      uMonth: (y, m) => `${STRINGS.vi.MN[m - 1]}/${y}`,
      uWeek: (y, w) => `Tuần ${w}, ${y}`,
      uDay: (m, d, wd) => `${d}/${m}, ${wd}`,
      overdue: 'Quá hạn', overdueBy: n => `Quá hạn ${n} ngày`, reschedule: 'Đổi ngày',
      doneStamp: (m, d, h, mi) => `${d}/${m} ${h}:${mi}`,
      doneStampY: (y, m, d, h, mi) => `${d}/${m}/${y} ${h}:${mi}`,
      justNow: 'vừa xong',
      minAgo: n => `xong ${n} phút trước`,
      todayAt: (h, m) => `xong hôm nay ${h}:${m}`,
      doneOn: (m, d) => `xong ${d}/${m}`,
      markDone: 'Đánh dấu đã xong', undoDone: 'Bỏ đánh dấu',
      delLabel: 'Xoá mục tiêu này', delText: 'Xoá',
      warnEmpty: 'Hãy viết gì đó trước',
      tAdd: 'Đã thêm', tDone: 'Giỏi lắm, xong rồi!', tUndone: 'Đã chuyển lại danh sách',
      tDeleted: t => `Đã xoá “${t}”`, tCleared: n => `Đã xoá ${n} mục đã xong`,
      tUndo: 'Đã hoàn tác', tNoDone: 'Chưa có mục nào đã xong',
      cDelete: t => `Xoá “${t}”?`, cClear: n => `Xoá cả ${n} mục đã xong?`,
      emptyNoGoals: 'Chưa có mục tiêu nào. Thêm một cái ở trên nhé.',
      emptyAllDone: 'Xong hết rồi. Xem phần “Đã xong” bên dưới.',
      emptyFiltered: 'Bộ lọc này chưa có gì. Thử bộ lọc khác xem.',
      emptyArchive: 'Mục đã hoàn thành sẽ hiện ở đây',
      saveFail: '⚠ Không lưu được: trình duyệt chặn lưu trữ cục bộ, thay đổi sẽ mất khi đóng trang',
      tPullOnly: "Đã khôi phục danh sách từ đám mây (không tải lên để tránh ghi đè)",
      undo: 'Hoàn tác',

      signInTitle: 'Đăng nhập để đồng bộ',
      signInHint: 'Đăng nhập để danh sách theo bạn sang mọi trình duyệt và thiết bị.',
      email: 'Email', password: 'Mật khẩu',
      signIn: 'Đăng nhập', signUp: 'Tạo tài khoản', signOut: 'Đăng xuất',
      toSignUp: 'Chưa có tài khoản? Tạo mới', toSignIn: 'Đã có tài khoản? Đăng nhập',
      forgot: 'Quên mật khẩu', continueOffline: 'Bỏ qua, chỉ dùng trên máy này',
      resetSent: 'Đã gửi email đặt lại, hãy kiểm tra hộp thư',
      syncOn: 'Đã đồng bộ', syncOff: 'Đang đồng bộ', syncOffline: 'Ngoại tuyến (đã lưu trên máy)',
      syncLocal: 'Chỉ lưu trên máy này', syncGuest: 'Chưa đăng nhập',
      eEmail: 'Nhập email', ePass: 'Nhập mật khẩu', ePassShort: 'Mật khẩu cần ít nhất 6 ký tự',
      eCred: 'Email hoặc mật khẩu không đúng', eEmailUsed: 'Email này đã được đăng ký',
      eNeedConfirm: 'Hãy xác nhận email trước, rồi đăng nhập',
      eOffline: 'Không kết nối được máy chủ. Dữ liệu đã lưu trên máy và sẽ đồng bộ sau.'
    },

    ms: {
      MN: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun',
           'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'],
      WD: ['Ahd', 'Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab'],

      navGoals: "Sasaran",

      navCalendar: "Kalendar",

      navStats: "Statistik",

      navSettings: "Tetapan",

      menuLabel: 'Menu', langShort: 'Bahasa',
      themeShort: 'Tema', userShort: 'Akaun',

      calSub: 'Ketik mana-mana hari untuk lihat rancangan.',
      calNone: 'Belum selesai', calPart: 'Sebahagian selesai', calAll: 'Semua selesai',
      calDone: 'Selesai', calNoTask: 'Tiada rancangan untuk hari ini',
      calPrev: 'Bulan lepas', calNext: 'Bulan depan',
      skinPaper: 'Kertas', skinIris: 'Iris', skinCobalt: 'Kobalt', skinLime: 'Limau',

      tabIdea: 'Catat idea', tabPlan: 'Rancang',
      catPh: 'Kategori', catNone: 'Tanpa kategori', catCreate: n => `Cipta kategori “${n}”`,
      loopNone: 'Tiada ulangan', loopDaily: 'Harian', loopWeekly: 'Mingguan', loopMonthly: 'Bulanan',
      inboxTitle: 'Kotak idea', inboxEmpty: 'Kotak idea masih kosong',
      actionTitle: 'Senarai tindakan', actionEmpty: 'Belum ada tindakan',
      moveAction: 'Pindah ke tindakan', tagIdea: 'Idea', tagPlan: 'Rancangan',
      achieve: 'Pencapaian', achieveSub: 'Semua yang selesai, disusun mengikut kategori.',
      achieveEmpty: 'Belum ada pencapaian',
      needDate: 'Pilih tarikh dahulu', tMoved: 'Dipindah ke tindakan',
      doneToday: 'Selesai hari ini', loopTimes: n => `Selesai ${n} kali`,

      soon: "Bahagian ini masih dibina",

      progress: "Kemajuan hari ini",

      authAria: "Log masuk / akaun", accountLabel: "Akaun semasa",

      langAria: 'Tukar bahasa', themeAria: 'Tukar mod gelap / cerah',
      title: 'My Goals',
      subtitle: 'Tulis apa yang anda mahu buat, sudah siap satu tanda satu.',
      progress: 'Kemajuan',
      ph: 'Apa yang anda mahu buat?', goalAria: 'Teks sasaran',
      lblScope: 'Tempoh', lblDate: 'Tarikh', lblType: 'Jenis',
      gScope: 'Tempoh sasaran', gType: 'Utama atau sampingan',
      gFilter: 'Penapis', dateAria: 'Tarikh',
      scYear: 'Tahun', scMonth: 'Bulan', scWeek: 'Minggu', scDay: 'Hari',
      typeMain: 'Utama', typeSide: 'Sampingan',
      add: 'Tambah', fAll: 'Semua', archive: 'Selesai', clearDone: 'Kosongkan yang selesai',
      statActive: 'Sedang buat', statDone: 'Selesai', statAll: 'Jumlah',
      uYear: n => `Tahun ${n}`,
      uMonth: (y, m) => `${STRINGS.ms.MN[m - 1]} ${y}`,
      uWeek: (y, w) => `Minggu ${w}, ${y}`,
      uDay: (m, d, wd) => `${d} ${STRINGS.ms.MN[m - 1]}, ${wd}`,
      overdue: 'Lewat', overdueBy: n => `Lewat ${n} hari`, reschedule: 'Tukar tarikh',
      doneStamp: (m, d, h, mi) => `${d} ${STRINGS.ms.MN[m - 1]} ${h}:${mi}`,
      doneStampY: (y, m, d, h, mi) => `${d} ${STRINGS.ms.MN[m - 1]} ${y} ${h}:${mi}`,
      justNow: 'baru selesai',
      minAgo: n => `selesai ${n} minit lalu`,
      todayAt: (h, m) => `selesai hari ini ${h}:${m}`,
      doneOn: (m, d) => `selesai ${d} ${STRINGS.ms.MN[m - 1]}`,
      markDone: 'Tanda selesai', undoDone: 'Batal tanda selesai',
      delLabel: 'Padam sasaran ini', delText: 'Padam',
      warnEmpty: 'Tulis sesuatu dahulu',
      tAdd: 'Ditambah', tDone: 'Bagus, selesai!', tUndone: 'Dikembalikan ke senarai',
      tDeleted: t => `Dipadam “${t}”`, tCleared: n => `Dipadam ${n} yang selesai`,
      tUndo: 'Padaman dibatalkan', tNoDone: 'Belum ada yang selesai',
      cDelete: t => `Padam “${t}”?`, cClear: n => `Padam semua ${n} yang selesai?`,
      emptyNoGoals: 'Belum ada sasaran. Tambah satu di atas.',
      emptyAllDone: 'Semua sudah siap. Lihat bahagian “Selesai” di bawah.',
      emptyFiltered: 'Tiada apa dalam penapis ini. Cuba penapis lain.',
      emptyArchive: 'Sasaran yang selesai akan muncul di sini',
      saveFail: '⚠ Gagal simpan: pelayar menyekat storan tempatan, perubahan akan hilang bila ditutup',
      tPullOnly: "Senarai dipulihkan dari awan (tidak dimuat naik, elak menimpa awan)",
      undo: 'Batal',

      signInTitle: 'Log masuk untuk segerak',
      signInHint: 'Log masuk dan senarai anda akan ikut ke mana-mana pelayar atau peranti.',
      email: 'E-mel', password: 'Kata laluan',
      signIn: 'Log masuk', signUp: 'Daftar', signOut: 'Log keluar',
      toSignUp: 'Tiada akaun? Daftar', toSignIn: 'Sudah ada akaun? Log masuk',
      forgot: 'Lupa kata laluan', continueOffline: 'Langkau dulu, guna peranti ini sahaja',
      resetSent: 'E-mel set semula dihantar, sila semak',
      syncOn: 'Sudah segerak', syncOff: 'Menyegerak', syncOffline: 'Luar talian (disimpan dalam peranti)',
      syncLocal: 'Disimpan dalam peranti sahaja', syncGuest: 'Belum log masuk',
      eEmail: 'Masukkan e-mel', ePass: 'Masukkan kata laluan', ePassShort: 'Kata laluan perlu sekurang-kurangnya 6 aksara',
      eCred: 'E-mel atau kata laluan salah', eEmailUsed: 'E-mel ini sudah didaftarkan',
      eNeedConfirm: 'Sahkan e-mel dahulu, kemudian log masuk',
      eOffline: 'Tidak dapat hubungi awan. Data disimpan dalam peranti dan akan disegerak kemudian.'
    },

    id: {
      MN: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
           'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
      WD: ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'],

      navGoals: "Target",

      navCalendar: "Kalender",

      navStats: "Statistik",

      navSettings: "Pengaturan",

      menuLabel: 'Menu', langShort: 'Bahasa',
      themeShort: 'Tema', userShort: 'Akun',

      calSub: 'Ketuk tanggal mana pun untuk melihat rencana.',
      calNone: 'Belum selesai', calPart: 'Sebagian selesai', calAll: 'Semua selesai',
      calDone: 'Selesai', calNoTask: 'Tidak ada rencana hari ini',
      calPrev: 'Bulan sebelumnya', calNext: 'Bulan berikutnya',
      skinPaper: 'Kertas', skinIris: 'Iris', skinCobalt: 'Kobalt', skinLime: 'Jeruk nipis',

      tabIdea: 'Catat ide', tabPlan: 'Rencanakan',
      catPh: 'Kategori', catNone: 'Tanpa kategori', catCreate: n => `Buat kategori “${n}”`,
      loopNone: 'Tanpa ulangan', loopDaily: 'Harian', loopWeekly: 'Mingguan', loopMonthly: 'Bulanan',
      inboxTitle: 'Kotak ide', inboxEmpty: 'Kotak ide masih kosong',
      actionTitle: 'Daftar tindakan', actionEmpty: 'Belum ada tindakan',
      moveAction: 'Pindahkan ke tindakan', tagIdea: 'Ide', tagPlan: 'Rencana',
      achieve: 'Pencapaian', achieveSub: 'Semua yang sudah selesai, ditata per kategori.',
      achieveEmpty: 'Belum ada pencapaian',
      needDate: 'Pilih tanggal dulu', tMoved: 'Dipindahkan ke tindakan',
      doneToday: 'Selesai hari ini', loopTimes: n => `Selesai ${n} kali`,

      soon: "Bagian ini masih dikembangkan",

      progress: "Kemajuan hari ini",

      authAria: "Masuk / akun", accountLabel: "Akun saat ini",

      langAria: 'Ganti bahasa', themeAria: 'Ganti mode gelap / terang',
      title: 'My Goals',
      subtitle: 'Tulis yang ingin kamu lakukan, selesai satu centang satu.',
      progress: 'Kemajuan',
      ph: 'Mau melakukan apa?', goalAria: 'Teks target',
      lblScope: 'Periode', lblDate: 'Tanggal', lblType: 'Jenis',
      gScope: 'Periode target', gType: 'Utama atau sampingan',
      gFilter: 'Filter', dateAria: 'Tanggal',
      scYear: 'Tahun', scMonth: 'Bulan', scWeek: 'Minggu', scDay: 'Hari',
      typeMain: 'Utama', typeSide: 'Sampingan',
      add: 'Tambah', fAll: 'Semua', archive: 'Selesai', clearDone: 'Hapus yang selesai',
      statActive: 'Berjalan', statDone: 'Selesai', statAll: 'Total',
      uYear: n => `Tahun ${n}`,
      uMonth: (y, m) => `${STRINGS.id.MN[m - 1]} ${y}`,
      uWeek: (y, w) => `Minggu ${w}, ${y}`,
      uDay: (m, d, wd) => `${d} ${STRINGS.id.MN[m - 1]}, ${wd}`,
      overdue: 'Terlambat', overdueBy: n => `Terlambat ${n} hari`, reschedule: 'Ubah tanggal',
      doneStamp: (m, d, h, mi) => `${d} ${STRINGS.id.MN[m - 1]} ${h}:${mi}`,
      doneStampY: (y, m, d, h, mi) => `${d} ${STRINGS.id.MN[m - 1]} ${y} ${h}:${mi}`,
      justNow: 'baru selesai',
      minAgo: n => `selesai ${n} menit lalu`,
      todayAt: (h, m) => `selesai hari ini ${h}:${m}`,
      doneOn: (m, d) => `selesai ${d} ${STRINGS.id.MN[m - 1]}`,
      markDone: 'Tandai selesai', undoDone: 'Batalkan selesai',
      delLabel: 'Hapus target ini', delText: 'Hapus',
      warnEmpty: 'Tulis dulu sesuatu',
      tAdd: 'Ditambahkan', tDone: 'Mantap, selesai!', tUndone: 'Dikembalikan ke daftar',
      tDeleted: t => `“${t}” dihapus`, tCleared: n => `${n} yang selesai dihapus`,
      tUndo: 'Penghapusan dibatalkan', tNoDone: 'Belum ada yang selesai',
      cDelete: t => `Hapus “${t}”?`, cClear: n => `Hapus semua ${n} yang selesai?`,
      emptyNoGoals: 'Belum ada target. Tambahkan satu di atas.',
      emptyAllDone: 'Semua selesai. Lihat bagian “Selesai” di bawah.',
      emptyFiltered: 'Tidak ada isi di filter ini. Coba filter lain.',
      emptyArchive: 'Target yang selesai akan muncul di sini',
      saveFail: '⚠ Gagal menyimpan: browser memblokir penyimpanan lokal, perubahan hilang saat ditutup',
      tPullOnly: "Daftar dipulihkan dari cloud (tidak diunggah, agar tidak menimpa cloud)",
      undo: 'Urungkan',

      signInTitle: 'Masuk untuk sinkron',
      signInHint: 'Masuk dan daftar Anda ikut ke browser atau perangkat mana pun.',
      email: 'Email', password: 'Kata sandi',
      signIn: 'Masuk', signUp: 'Daftar', signOut: 'Keluar',
      toSignUp: 'Belum punya akun? Daftar', toSignIn: 'Sudah punya akun? Masuk',
      forgot: 'Lupa kata sandi', continueOffline: 'Lewati dulu, pakai perangkat ini saja',
      resetSent: 'Email reset terkirim, silakan cek',
      syncOn: 'Tersinkron', syncOff: 'Menyinkronkan', syncOffline: 'Luring (tersimpan di perangkat)',
      syncLocal: 'Hanya di perangkat ini', syncGuest: 'Belum masuk',
      eEmail: 'Masukkan email', ePass: 'Masukkan kata sandi', ePassShort: 'Kata sandi minimal 6 karakter',
      eCred: 'Email atau kata sandi salah', eEmailUsed: 'Email ini sudah terdaftar',
      eNeedConfirm: 'Konfirmasi email dulu, lalu masuk',
      eOffline: 'Tidak dapat menghubungi cloud. Data tersimpan di perangkat dan akan disinkronkan nanti.'
    },

    hi: {
      MN: ['जन', 'फ़र', 'मार्च', 'अप्रै', 'मई', 'जून',
           'जुल', 'अग', 'सित', 'अक्ट', 'नव', 'दिस'],
      WD: ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'],

      navGoals: "लक्ष्य",

      navCalendar: "कैलेंडर",

      navStats: "आँकड़े",

      navSettings: "सेटिंग",

      menuLabel: 'मेनू', langShort: 'भाषा',
      themeShort: 'थीम', userShort: 'खाता',

      calSub: 'किसी भी दिन पर टैप करें और उसका प्लान देखें।',
      calNone: 'बाकी', calPart: 'कुछ पूरा', calAll: 'सब पूरा',
      calDone: 'पूरा', calNoTask: 'इस दिन कोई प्लान नहीं',
      calPrev: 'पिछला महीना', calNext: 'अगला महीना',
      skinPaper: 'कागज़', skinIris: 'आइरिस', skinCobalt: 'कोबाल्ट', skinLime: 'नींबू',

      tabIdea: 'विचार लिखें', tabPlan: 'योजना बनाएँ',
      catPh: 'श्रेणी', catNone: 'बिना श्रेणी', catCreate: n => `नई श्रेणी “${n}” बनाएँ`,
      loopNone: 'दोहराव नहीं', loopDaily: 'रोज़', loopWeekly: 'हर हफ़्ते', loopMonthly: 'हर महीने',
      inboxTitle: 'विचार इनबॉक्स', inboxEmpty: 'इनबॉक्स खाली है',
      actionTitle: 'कार्य सूची', actionEmpty: 'अभी कोई कार्य नहीं',
      moveAction: 'कार्य में डालें', tagIdea: 'विचार', tagPlan: 'योजना',
      achieve: 'उपलब्धियाँ', achieveSub: 'पूरी की गई हर चीज़, श्रेणी के हिसाब से।',
      achieveEmpty: 'अभी कोई उपलब्धि नहीं',
      needDate: 'पहले तारीख़ चुनें', tMoved: 'कार्य में डाल दिया',
      doneToday: 'आज पूरा हुआ', loopTimes: n => `${n} बार पूरा`,

      soon: "यह भाग अभी बन रहा है",

      progress: "आज की प्रगति",

      authAria: "साइन इन / खाता", accountLabel: "वर्तमान खाता",

      langAria: 'भाषा बदलें', themeAria: 'डार्क / लाइट बदलें',
      title: 'My Goals',
      subtitle: 'जो करना है उसे लिखें, पूरा होने पर हल्का-सा टिक लगाएँ।',
      progress: 'प्रगति',
      ph: 'क्या करना है?', goalAria: 'लक्ष्य का विवरण',
      lblScope: 'अवधि', lblDate: 'तिथि', lblType: 'प्रकार',
      gScope: 'लक्ष्य की अवधि', gType: 'मुख्य या गौण',
      gFilter: 'फ़िल्टर', dateAria: 'तिथि',
      scYear: 'वर्ष', scMonth: 'माह', scWeek: 'सप्ताह', scDay: 'दिन',
      typeMain: 'मुख्य', typeSide: 'गौण',
      add: 'जोड़ें', fAll: 'सभी', archive: 'पूरे हुए', clearDone: 'पूरे हुए हटाएँ',
      statActive: 'चल रहे', statDone: 'पूरे हुए', statAll: 'कुल',
      uYear: n => `वर्ष ${n}`,
      uMonth: (y, m) => `${STRINGS.hi.MN[m - 1]} ${y}`,
      uWeek: (y, w) => `सप्ताह ${w}, ${y}`,
      uDay: (m, d, wd) => `${d} ${STRINGS.hi.MN[m - 1]}, ${wd}`,
      overdue: 'समय बीता', overdueBy: n => `${n} दिन देर`, reschedule: 'तारीख़ बदलें',
      doneStamp: (m, d, h, mi) => `${d} ${STRINGS.hi.MN[m - 1]}, ${h}:${mi}`,
      doneStampY: (y, m, d, h, mi) => `${d} ${STRINGS.hi.MN[m - 1]} ${y}, ${h}:${mi}`,
      justNow: 'अभी पूरा हुआ',
      minAgo: n => `${n} मिनट पहले पूरा`,
      todayAt: (h, m) => `आज ${h}:${m} पूरा`,
      doneOn: (m, d) => `${d} ${STRINGS.hi.MN[m - 1]} को पूरा`,
      markDone: 'पूरा चिह्नित करें', undoDone: 'चिह्न हटाएँ',
      delLabel: 'यह लक्ष्य हटाएँ', delText: 'हटाएँ',
      warnEmpty: 'पहले कुछ लिखें',
      tAdd: 'जोड़ा गया', tDone: 'बढ़िया, पूरा हुआ!', tUndone: 'सूची में वापस',
      tDeleted: t => `“${t}” हटाया`, tCleared: n => `${n} पूरे हुए हटाए`,
      tUndo: 'हटाना वापस लिया', tNoDone: 'अभी कुछ पूरा नहीं',
      cDelete: t => `“${t}” हटाएँ?`, cClear: n => `सभी ${n} पूरे हुए हटाएँ?`,
      emptyNoGoals: 'अभी कोई लक्ष्य नहीं। ऊपर एक जोड़ें।',
      emptyAllDone: 'सब पूरा हो गया। नीचे “पूरे हुए” देखें।',
      emptyFiltered: 'इस फ़िल्टर में कुछ नहीं। दूसरा फ़िल्टर देखें।',
      emptyArchive: 'पूरे हुए लक्ष्य यहाँ दिखेंगे',
      saveFail: '⚠ सहेजा नहीं गया: ब्राउज़र ने लोकल स्टोरेज रोकी है, बंद करने पर बदलाव चले जाएँगे',
      tPullOnly: "सूची क्लाउड से बहाल की गई (अपलोड नहीं किया, क्लाउड मिटने से बचाने के लिए)",
      undo: 'वापस',

      signInTitle: 'सिंक के लिए साइन इन करें',
      signInHint: 'साइन इन करें और आपकी सूची किसी भी ब्राउज़र या डिवाइस पर साथ चलेगी।',
      email: 'ईमेल', password: 'पासवर्ड',
      signIn: 'साइन इन', signUp: 'खाता बनाएँ', signOut: 'साइन आउट',
      toSignUp: 'खाता नहीं है? बनाएँ', toSignIn: 'खाता है? साइन इन करें',
      forgot: 'पासवर्ड भूल गए', continueOffline: 'अभी छोड़ें, इसी डिवाइस पर रखें',
      resetSent: 'रीसेट ईमेल भेजा गया, कृपया देखें',
      syncOn: 'सिंक हो गया', syncOff: 'सिंक हो रहा है', syncOffline: 'ऑफ़लाइन (डिवाइस में सहेजा)',
      syncLocal: 'केवल इसी डिवाइस पर', syncGuest: 'साइन इन नहीं',
      eEmail: 'ईमेल लिखें', ePass: 'पासवर्ड लिखें', ePassShort: 'पासवर्ड कम से कम 6 अक्षर',
      eCred: 'ईमेल या पासवर्ड ग़लत है', eEmailUsed: 'यह ईमेल पहले से पंजीकृत है',
      eNeedConfirm: 'पहले ईमेल की पुष्टि करें, फिर साइन इन करें',
      eOffline: 'क्लाउड से संपर्क नहीं हुआ। डेटा डिवाइस में सहेजा गया, बाद में सिंक होगा।'
    }
  };

  // 语言清单：国旗用内联 SVG（Windows 的 emoji 不显示国旗）
  const LANGS = [
    { code: 'zh', name: '中文' },
    { code: 'en', name: 'English' },
    { code: 'th', name: 'ไทย' },
    { code: 'vi', name: 'Tiếng Việt' },
    { code: 'ms', name: 'Bahasa Melayu' },
    { code: 'id', name: 'Bahasa Indonesia' },
    { code: 'hi', name: 'हिन्दी' }
  ];

  const HTML_LANG = { zh: 'zh-CN', en: 'en', th: 'th', vi: 'vi', ms: 'ms', id: 'id', hi: 'hi' };

  let lang = 'zh';
  // 注意是变参：doneStamp 这类文案要 m/d/h/分 四个参数（原来写死 (a,b,c) 会吞掉最后一个）
  const t = (k, ...args) => {
    const dict = STRINGS[lang] || STRINGS.zh;
    const v = dict[k];
    if (typeof v === 'function') return v(...args);
    return v !== undefined ? v : (STRINGS.zh[k] || k);
  };

  /* ---------------- 本地存储（三级降级） ---------------- */

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

  const LANG_BY_PREFIX = [
    [/^zh/i, 'zh'], [/^th/i, 'th'], [/^vi/i, 'vi'],
    [/^ms/i, 'ms'], [/^id|^in$/i, 'id'], [/^hi/i, 'hi'],
  ];
  const detectLang = () => {
    try {
      const saved = storage.get(LANG_KEY);
      if (STRINGS[saved]) return saved;
    } catch (e) {}
    const nav = String((W.navigator && (W.navigator.language || W.navigator.userLanguage)) || '');
    for (const [re, code] of LANG_BY_PREFIX) if (re.test(nav)) return code;
    return 'en';
  };

  /* ---------------- DOM ---------------- */

  const $ = id => document.getElementById(id);
  const inboxList   = $('inboxList');
  const inboxCount  = $('inboxCount');
  const actionList  = $('actionList');
  const actionCount = $('actionCount');
  const shelvesEl   = $('shelves');
  const doneTotalEl = $('doneTotal');
  const cpTabs      = $('cpTabs');
  const planOnly    = $('planOnly');
  const loopBtn     = $('loopBtn');
  const loopLabel   = $('loopLabel');
  const catComboEl  = $('catCombo');
  const catInput    = $('catInput');
  const catMenuEl   = $('catMenu');
  const form        = $('form');
  const titleInput  = $('title');
  const dateInput   = $('date');
  const hintEl      = $('hint');
  const langBtn     = $('langBtn');
  const langMenu    = $('langMenu');
  const langIcon    = $('langIcon');
  const themeBtn    = $('themeBtn');
  const clearDoneBtn= $('clearDone');
  const toastEl     = $('toast');
  const undoEl      = $('undo');
  const cloudHost   = $('cloudHost');
  const authBtn     = $('authBtn');
  const authDot     = $('authDot');
  const authModal   = $('authModal');
  const authAccount = $('authAccount');
  const authAccountMail = $('authAccountMail');
  const authSignin  = $('authSignin');
  const authForm    = $('authForm');
  const authEmail   = $('authEmail');
  const authPass    = $('authPass');
  const authMsg     = $('authMsg');
  const authSubmit  = $('authSubmit');
  const authToggle  = $('authToggle');
  const authForgot  = $('authForgot');
  const authClose   = $('authClose');
  const syncPill    = $('syncPill');
  const syncText    = $('syncText');
  const syncProgress= $('syncProgress');
  const signOutBtn  = $('signOutBtn');
  const navEl       = $('nav');
  const progressCard= $('progressCard');
  const menuBtn     = $('menuBtn');
  const menuWrap    = $('menuWrap');
  const toolPanel   = $('toolPanel');
  const themeGlyph  = $('themeGlyph');
  const skinRow     = $('skinRow');
  const calTitle    = $('calTitle');
  const calGrid     = $('calGrid');
  const calPrev     = $('calPrev');
  const calNext     = $('calNext');
  const calDayHead  = $('calDayHead');
  const calCount    = $('calCount');
  const calList     = $('calList');
  const calEmpty    = $('calEmpty');

  let goals   = [];
  let entryDraft = 'idea';     // 当前录入模板：idea（记想法）/ plan（定计划）
  let loopRule   = 'none';     // 定计划模板里的循环规则
  let movingId   = null;       // 正在"就地补日期"的那条灵感
  let comboOpen  = false;      // 分类下拉是否展开
  let comboCursor = 0;         // 键盘高亮到第几项
  let toastTimer = null;

  /* ══════════════════ 数据层 ══════════════════
     所有读写都经过这里：先落本地（永远可用），再排队推云端。 */

  let cloud = null;          // Supabase 客户端
  let session = null;        // 当前登录会话
  let dirty = new Set();     // 待推送的 id
  let syncState = 'local';   // local | syncing | synced | offline
  let syncTimer = null;
  let bootedFromLocal = false;

  const nowMs = () => Date.now();
  const uid = () => (W.crypto && W.crypto.randomUUID)
    ? W.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });

  /* 时间统一用 ISO 字符串存（精确到毫秒）：ISO 本身可以直接排序，
     也能原样写进 Supabase 的 timestamptz。毫秒数 / ISO / Date 都能吃进来。 */
  const nowIso = () => new Date().toISOString();
  function isoOf(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? new Date(v).toISOString() : null;
    const ms = Date.parse(v);
    return isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  // ISO 字符串不能直接相减，排序和比较一律先换成毫秒数
  const msOf = v => { const i = isoOf(v); return i ? Date.parse(i) : 0; };
  const isToday = v => {
    const ms = msOf(v);
    return !!ms && new Date(ms).toDateString() === new Date().toDateString();
  };

  /* 任何来源的记录（本地缓存 / 云端行 / 新建）都过这一遍：
     补齐 v2 字段 + 把老记录（只有 scope/type/date/done）翻译成新模型。
     旧记录一律当成"带日期的计划"：done → 成就，其余 → 行动。 */
  function normalizeGoal(g) {
    const src = g || {};
    const legacyDate = /^\d{4}-\d{2}-\d{2}$/.test(src.actionDate || src.action_date || src.date || '')
      ? (src.actionDate || src.action_date || src.date)
      : null;

    let status = STATUS[src.status] ? src.status : null;
    if (!status) status = src.done ? 'done' : (legacyDate ? 'doing' : 'inbox');
    const entryType = ENTRY[src.entryType] ? src.entryType
      : ENTRY[src.entry_type] ? src.entry_type
      : 'plan';
    const loopRaw = src.loop || src.loopRule || src.loop_rule;
    const cat = (typeof src.category === 'string' ? src.category.trim() : '').slice(0, CAT_MAX);

    return {
      id: src.id ? String(src.id) : uid(),
      title: typeof src.title === 'string' ? src.title : '',
      entryType,
      status,
      category: cat || DEFAULT_CAT,
      // 灵感箱里的条目还没有"行动日"
      actionDate: status === 'inbox' ? null : legacyDate,
      loop: LOOPS[loopRaw] ? loopRaw : 'none',
      // 循环计划的打卡历史：{ at: ISO 时刻, date: 'YYYY-MM-DD' }
      history: Array.isArray(src.history)
        ? src.history.filter(h => h && h.date).map(h => ({ at: isoOf(h.at), date: String(h.date) }))
        : [],
      // 精确完成时刻：优先用 completed_at（ISO），再退回本地的 doneAt / 旧的 done_at（毫秒）
      doneAt: isoOf(src.completedAt || src.completed_at || src.doneAt || src.done_at),
      createdAt: src.createdAt || src.created_at || nowMs(),
      updatedAt: src.updatedAt || src.updated_at || src.createdAt || src.created_at || nowMs(),
      deletedAt: src.deletedAt || src.deleted_at || null
    };
  }

  // 分类显示名：入库的空值/默认值在界面上统一显示成当前语言的"未分类"
  const catLabel = c => (!c || c === DEFAULT_CAT) ? t('catNone') : c;

  // 本地记录 → 云端行（云端表用 snake_case，时间统一毫秒）
  function toRow(g, userId) {
    const n = normalizeGoal(g);
    return {
      id: n.id,
      user_id: userId,
      title: n.title,
      // ── v2 字段 ──
      entry_type: n.entryType,
      status: n.status,
      category: n.category,
      action_date: n.actionDate,
      loop_rule: n.loop,
      history: n.history,
      // ── 旧的 not null 列继续写派生值 ──
      // 这样老版本客户端、以及缓存了旧页面的浏览器不会因为缺列而报错。
      scope: 'day',
      type: n.entryType === 'idea' ? 'side' : 'main',
      date: n.actionDate || todayStr(),
      done: n.status === 'done',
      // 完成时刻两列都写：completed_at 是精确的 timestamptz（成就里显示到分钟），
      // done_at 是同一时刻的毫秒数（旧 bigint 列，不能让它变空）。
      completed_at: n.doneAt,
      done_at: n.doneAt ? msOf(n.doneAt) : null,
      created_at: n.createdAt,
      updated_at: n.updatedAt,
      deleted_at: n.deletedAt || null
    };
  }

  // 云端行 → 本地记录
  function fromRow(r) {
    return normalizeGoal({
      id: String(r.id),
      title: r.title,
      entry_type: r.entry_type,
      status: r.status,
      category: r.category,
      action_date: r.action_date,
      loop_rule: r.loop_rule,
      history: r.history,
      done: r.done,
      date: r.date,
      completed_at: r.completed_at,
      done_at: r.done_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
      deleted_at: r.deleted_at
    });
  }

  function loadLocal() {
    try {
      const raw = storage.get(STORE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr.filter(g => g && typeof g.title === 'string').map(normalizeGoal);
    } catch (e) {
      console.warn('load local failed', e);
      return [];
    }
  }

  // 保存：写本地 → 标记待同步 → 排队推送
  function save(touched) {
    try {
      storage.set(STORE_KEY, JSON.stringify(goals));
    } catch (e) {
      console.error('save local failed', e);
      toast(t('saveFail'));
    }
    if (Array.isArray(touched)) touched.forEach(id => dirty.add(id));
    else goals.forEach(g => dirty.add(g.id));
    scheduleSync();
  }

  function visibleGoals() {
    return goals.filter(g => !g.deletedAt);
  }

  /* ══════════════════ 云端同步 ══════════════════ */

  function initCloud() {
    const lib = W.supabase;
    if (!lib || !lib.createClient) {
      console.warn('supabase-js 未加载，进入纯本地模式');
      cloud = null;
      return false;
    }
    try {
      cloud = lib.createClient(CLOUD.url, CLOUD.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      return true;
    } catch (e) {
      console.error('supabase 初始化失败', e);
      cloud = null;
      return false;
    }
  }

  function setSyncState(s) {
    if (syncState === s) return;
    syncState = s;
    renderSyncBar();
  }

  function renderSyncBar() {
    const map = {
      local: 'syncLocal', syncing: 'syncOff', synced: 'syncOn', offline: 'syncOffline'
    };
    const label = t(map[syncState] || 'syncLocal');
    if (syncText) syncText.textContent = label;   // 这行文字现在就是那个悬浮气泡
    if (syncPill) {
      syncPill.dataset.state = syncState;
      // 不再设 title：原生 tooltip 会和自绘气泡叠在一起，出现两个提示
      syncPill.setAttribute('aria-label', label);
    }
    if (authBtn) {
      authBtn.dataset.state = syncState;
      authBtn.setAttribute('title', label);
    }
    if (authDot) authDot.title = label;
  }

  function scheduleSync() {
    if (!cloud || !session) { setSyncState('local'); return; }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { pushChanges(); }, 600);
  }

  /* ---------------- 墓碑读写 ---------------- */

  function loadTombstones() {
    try {
      const raw = storage.get(TOMB_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      const cutoff = nowMs() - TOMB_TTL;
      const fresh = (Array.isArray(arr) ? arr : []).filter(x => x && x.id && (x.at || 0) > cutoff);
      tombstones = new Map(fresh.map(x => [String(x.id), x.at || 0]));
    } catch (e) {
      console.warn('load tombstones failed', e);
      tombstones = new Map();
    }
  }

  function saveTombstones() {
    try {
      const arr = [...tombstones.entries()].map(([id, at]) => ({ id, at }));
      storage.set(TOMB_KEY, JSON.stringify(arr));
    } catch (e) {
      console.warn('save tombstones failed', e);
    }
  }

  function markDeleted(ids) {
    const at = nowMs();
    (Array.isArray(ids) ? ids : [ids]).forEach(id => tombstones.set(String(id), at));
    saveTombstones();
  }

  function clearTombstone(ids) {
    (Array.isArray(ids) ? ids : [ids]).forEach(id => tombstones.delete(String(id)));
    saveTombstones();
  }

  // 已经删过、但云端又冒出同 id 的行 → 收集起来再删一次
  let pendingHardDelete = new Set();

  /* ---------------- 云端写入 ---------------- */

  // 拉取时要的列：supabase-js 会原样下发这个列表，漏掉的列在返回行里就是 undefined。
  // 千万别漏 —— 曾经漏了 v2 的 status/category，换设备登录后灵感箱的条目
  // 会被当成"有日期的计划"落进行动列表。
  const COLS_FULL = 'id,user_id,title,scope,type,date,done,' +
    'entry_type,status,category,action_date,loop_rule,history,' +
    'done_at,completed_at,created_at,updated_at,deleted_at';
  // 云端还没跑 v3 迁移时的退路（没有 completed_at 这一列）
  const COLS_BASE = COLS_FULL.replace('completed_at,', '');
  // Postgres 的"列不存在"。用它来判断该不该退到旧列集合。
  const isMissingCol = e => String(e && e.code) === '42703';
  const stripNewCols = row => { const c = { ...row }; delete c.completed_at; return c; };

  // 把本地待推送的改动写到云端（新 id 用 insert，已存在的用 upsert 合并）
  async function pushChanges() {
    if (!cloud || !session) return;

    // 先处理"待物理删除"的行：提交后干净，不留垃圾记录
    if (pendingHardDelete.size) {
      const ids = [...pendingHardDelete];
      setSyncState('syncing');
      try {
        const { error } = await cloud.from(CLOUD.table).delete().in('id', ids);
        if (error) throw error;
        ids.forEach(id => pendingHardDelete.delete(id));
        dirty && ids.forEach(id => dirty.delete(id));
        console.log('[sync] 已从云端物理删除 ' + ids.length + ' 行');
      } catch (e) {
        console.warn('hard delete failed', e);   // 留着下次再试
        setSyncState('offline');
        return;
      }
    }

    // 再推送正常改动；墓碑里的 id 绝不上传（否则会把删掉的记录又写回去）
    const ids = [...dirty].filter(id => !tombstones.has(String(id)));
    dirty.forEach(id => { if (tombstones.has(String(id))) dirty.delete(id); });
    if (!ids.length) { if (!pendingHardDelete.size) setSyncState('synced'); return; }

    const rows = goals
      .filter(g => ids.includes(g.id))
      .map(g => toRow(g, session.user.id));
    if (!rows.length) { ids.forEach(id => dirty.delete(id)); return; }

    setSyncState('syncing');
    try {
      // 用 insert 而不是 upsert：id 冲突应被暴露出来，而不是静默覆盖别人的数据。
      // 冲突（23505）说明云端已有这条，改用 upsert 合并即可。
      let payload = rows;
      let { error } = await cloud.from(CLOUD.table).insert(payload);
      // 42703 = 云端还没有 completed_at 列（v3 迁移没跑）：
      // 去掉这一列重试一次，宁可少个字段，也别让整个同步挂掉。
      if (error && isMissingCol(error)) {
        console.warn('云端没有 completed_at 列，去掉它再试（建议跑 supabase-migrate-v3.sql）');
        payload = rows.map(stripNewCols);
        ({ error } = await cloud.from(CLOUD.table).insert(payload));
      }
      if (error && String(error.code) === '23505') {
        ({ error } = await cloud.from(CLOUD.table).upsert(payload, { onConflict: 'id' }));
      }
      if (error) throw error;
      ids.forEach(id => dirty.delete(id));
      setSyncState(dirty.size || pendingHardDelete.size ? 'syncing' : 'synced');
    } catch (e) {
      console.warn('push failed', e);
      setSyncState('offline');
    }
  }

  /* ── 合并规则（登录时、以及每次拉取时都走这里）────────────────
     1. 云端拉取的每一行，与本地按 id 配对：
          · 本地没有   → 新增到本地（下载）
          · 两端都有   → 谁的 updated_at 更新就用谁；本地更新则标记待上传
          · 本地有云端没有 → 标记待上传（离线期间新建的目标）
     2. 全部合并完成后才推送，且推送只做 per-id upsert，从不整表删除。
     3. 额外护栏：云端有数据、本地为空、却又不该有待上传内容时，
        视为"可能是空的浏览器刚登录"，只拉取不推送，避免误清云端。 */
  async function pullAndMerge() {
    if (!cloud || !session) return;
    setSyncState('syncing');
    try {
      // 先按完整列集合拉；撞上"列不存在"就退回不带头部新列的集合。
      const grab = cols => cloud
        .from(CLOUD.table)
        .select(cols)
        .eq('user_id', session.user.id)
        .order('updated_at', { ascending: true })
        .limit(5000);

      let { data, error } = await grab(COLS_FULL);
      if (error && isMissingCol(error)) {
        console.warn('云端缺少 v3 的新列，退回旧列集合拉取（建议跑 supabase-migrate-v3.sql）');
        ({ data, error } = await grab(COLS_BASE));
      }
      if (error) throw error;

      const remoteRows = data || [];
      const byId = new Map(goals.map(g => [g.id, g]));
      let changed = false, downloaded = 0, keptLocal = 0, resurrected = 0;

      for (const row of remoteRows) {
        const remote = fromRow(row);

        // 墓碑优先：这条我在本地删过，云端却又出现了 → 不收下来，反过来把它删掉。
        // 这样"另一台离线设备把删掉的记录重新上传"也不会让它复活。
        if (tombstones.has(String(remote.id))) {
          pendingHardDelete.add(String(remote.id));
          resurrected++;
          continue;
        }

        const local = byId.get(remote.id);
        if (!local) {
          byId.set(remote.id, remote);           // 云端有、本地没有 → 下载
          changed = true;
          downloaded++;
          continue;
        }
        const rt = remote.updatedAt || 0;
        const lt = local.updatedAt || 0;
        if (rt > lt) {
          byId.set(remote.id, remote);           // 云端更新 → 用云端
          changed = true;
          downloaded++;
        } else if (lt > rt) {
          dirty.add(local.id);                   // 本地更新 → 稍后推送
          keptLocal++;
        }
      }

      // 本地有、云端没有的（离线新建）→ 待上传。
      // 但墓碑里的不算"离线新建"，那是刚被删掉的，不能再传上去。
      const remoteIds = new Set(remoteRows.map(r => r.id));
      goals.forEach(g => {
        if (remoteIds.has(g.id)) return;
        if (tombstones.has(String(g.id))) { pendingHardDelete.add(String(g.id)); return; }
        dirty.add(g.id);
      });

      // 防误清护栏：云端非空 + 本地一条可见目标都没有 + 没有待上传的东西
      // → 只下载，不上传（避免"空浏览器首次登录"把云端理解成空清单）
      const guard = remoteRows.length > 0 && visibleGoals().length === 0 && dirty.size === 0;

      if (changed) {
        goals = [...byId.values()];
        try { storage.set(STORE_KEY, JSON.stringify(goals)); } catch (e) {}
        render();
      }

      if (guard) {
        console.warn('pullAndMerge: 本地为空而云端有数据，已跳过上传以避免误清云端');
        setSyncState('synced');
        toast(t('tPullOnly'));
        return;
      }

      // 合并完成后：先处理待物理删除的行，再推送本地改动
      await pushChanges();
      if (dirty.size === 0 && pendingHardDelete.size === 0) setSyncState('synced');
      console.log(`[sync] 云端 ${remoteRows.length} 行 → 下载/更新 ${downloaded}，` +
        `本地回推 ${keptLocal}，拦截复活 ${resurrected}，待物理删除 ${pendingHardDelete.size}`);
    } catch (e) {
      console.warn('pull failed', e);
      setSyncState('offline');
    }
  }

  /* ---------------- 登录弹窗 ---------------- */

  function openAuthModal() {
    if (!authModal) return;
    closeToolPanel();          // 弹窗和收纳面板不同时出现，免得两层浮层打架
    authModal.hidden = false;
    authModal.classList.add('open');
    if (authBtn) authBtn.setAttribute('aria-expanded', 'true');
    if (syncPill) syncPill.setAttribute('aria-expanded', 'true');
    renderAuth();
    const focusTarget = (session && session.user) ? signOutBtn : authEmail;
    if (focusTarget && focusTarget.focus) setTimeout(() => focusTarget.focus(), 60);
  }

  function closeAuthModal() {
    if (!authModal || authModal.hidden) return;
    authModal.classList.remove('open');
    if (authBtn) authBtn.setAttribute('aria-expanded', 'false');
    if (syncPill) syncPill.setAttribute('aria-expanded', 'false');
    setTimeout(() => { authModal.hidden = true; }, 240);   // 等淡出动画
  }

  function renderAuth() {
    const signedIn = !!(session && session.user);
    // 弹窗里：未登录显示表单，已登录显示账号信息
    if (authSignin) authSignin.hidden = signedIn;
    if (authAccount) authAccount.hidden = !signedIn;
    if (authAccountMail) authAccountMail.textContent = signedIn ? (session.user.email || '') : '';
    if (authBtn) authBtn.dataset.signed = signedIn ? '1' : '0';
    renderSyncBar();
  }

  function authMsgShow(key, kind) {
    if (!authMsg) return;
    authMsg.textContent = key ? t(key) : '';
    authMsg.classList.toggle('err', kind === 'err');
    authMsg.classList.toggle('ok', kind === 'ok');
  }

  let authMode = 'in';   // in | up

  function renderAuthMode() {
    if (authSubmit) authSubmit.textContent = t(authMode === 'in' ? 'signIn' : 'signUp');
    if (authToggle) authToggle.textContent = t(authMode === 'in' ? 'toSignUp' : 'toSignIn');
    if (authForgot) authForgot.hidden = authMode !== 'in';
    if (authPass) {
      authPass.setAttribute('autocomplete', authMode === 'in' ? 'current-password' : 'new-password');
    }
  }

  // 把 Supabase 的英文报错翻成用户看得懂的提示
  function mapAuthError(err) {
    const m = String((err && err.message) || err || '').toLowerCase();
    if (m.includes('invalid login') || m.includes('invalid credentials')) return 'eCred';
    if (m.includes('already registered') || m.includes('already been registered')) return 'eEmailUsed';
    if (m.includes('email not confirmed')) return 'eNeedConfirm';
    if (m.includes('fetch') || m.includes('network') || m.includes('failed to fetch')) return 'eOffline';
    return null;
  }

  async function handleAuthSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!cloud) { authMsgShow('eOffline', 'err'); return; }

    const email = (authEmail && authEmail.value || '').trim();
    const pass = (authPass && authPass.value) || '';
    if (!email) return authMsgShow('eEmail', 'err');
    if (!pass) return authMsgShow('ePass', 'err');
    if (authMode === 'up' && pass.length < 6) return authMsgShow('ePassShort', 'err');

    if (authSubmit) authSubmit.disabled = true;
    authMsgShow('syncOff', 'ok');
    try {
      const res = authMode === 'in'
        ? await cloud.auth.signInWithPassword({ email, password: pass })
        : await cloud.auth.signUp({ email, password: pass });
      if (res.error) throw res.error;
      if (authPass) authPass.value = '';
      if (authMode === 'up' && !res.data.session) {
        // 开启了邮箱确认：此时还没有会话，弹窗留着让用户看到提示
        authMsgShow('eNeedConfirm', 'ok');
        return;
      }
      authMsgShow('', '');
      // 登录成功：会话已建立，onAuthStateChange 里会触发"拉取 + 合并"。
      // 这里只负责把弹窗淡出。
      closeAuthModal();
    } catch (err) {
      console.warn('auth failed', err);
      const key = mapAuthError(err);
      authMsgShow(key || 'eOffline', 'err');
    } finally {
      if (authSubmit) authSubmit.disabled = false;
    }
  }

  async function handleForgot() {
    if (!cloud) return;
    const email = (authEmail && authEmail.value || '').trim();
    if (!email) return authMsgShow('eEmail', 'err');
    try {
      const { error } = await cloud.auth.resetPasswordForEmail(email, {
        redirectTo: (W.location && W.location.origin) || undefined
      });
      if (error) throw error;
      authMsgShow('resetSent', 'ok');
    } catch (err) {
      const key = mapAuthError(err);
      authMsgShow(key || 'eOffline', 'err');
    }
  }

  async function handleSignOut() {
    if (cloud) { try { await cloud.auth.signOut(); } catch (e) {} }
    session = null;
    dirty.clear();                 // 退出后不该再把旧账号的改动推到新账号
    try { storage.set(OFFLINE_KEY, ''); } catch (e) {}
    renderAuth();
    setSyncState('local');         // 状态回到「仅本机保存」
    closeAuthModal();
    toast(t('signOut'));
  }

  function wireAuthUI() {
    // 入口一：工具栏用户图标
    if (authBtn) {
      authBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (authModal && !authModal.hidden) closeAuthModal(); else openAuthModal();
      });
    }
    // 入口二：底部同步状态栏
    if (syncPill) {
      syncPill.addEventListener('click', e => {
        e.stopPropagation();
        openAuthModal();
      });
    }
    // 关闭：右上角 ✕ / 点遮罩 / Esc
    if (authModal) {
      authModal.querySelectorAll('[data-close]').forEach(el => {
        el.addEventListener('click', closeAuthModal);
      });
    }
    if (authClose) authClose.addEventListener('click', closeAuthModal);
    D.addEventListener('keydown', e => {
      if (e.key === 'Escape' && authModal && !authModal.hidden) closeAuthModal();
    });

    if (authForm) authForm.addEventListener('submit', handleAuthSubmit);
    if (authToggle) authToggle.addEventListener('click', () => {
      authMode = authMode === 'in' ? 'up' : 'in';
      authMsgShow('', '');
      renderAuthMode();
    });
    if (authForgot) authForgot.addEventListener('click', handleForgot);
    if (signOutBtn) signOutBtn.addEventListener('click', handleSignOut);
    if (authEmail) authEmail.addEventListener('input', () => authMsgShow('', ''));
    if (authPass) authPass.addEventListener('input', () => authMsgShow('', ''));
    renderAuthMode();
  }

  async function startCloud() {
    if (!initCloud()) { renderAuth(); setSyncState('local'); return; }

    if (cloud.auth.onAuthStateChange) {
      cloud.auth.onAuthStateChange((_event, s) => {
        const prevUser = session && session.user && session.user.id;
        session = s;
        renderAuth();
        const nowUser = session && session.user && session.user.id;
        if (nowUser && nowUser !== prevUser) {
          // 刚登录/换账号：把本地未同步的推上去，再拉云端合并
          goals.forEach(g => dirty.add(g.id));
          pullAndMerge();
        }
      });
    }

    try {
      const { data } = await cloud.auth.getSession();
      // 注意：不能在拿到结果后无条件覆盖 session。
      // onAuthStateChange 可能已经先一步建立了会话，若此时用 getSession 的陈旧结果覆盖，
      // 会把刚登录的会话清成 null，导致后续改动永远同步不上去。
      if (!session && data && data.session) session = data.session;
    } catch (e) {
      console.warn('getSession failed', e);
    }
    renderAuth();
    if (session) { goals.forEach(g => dirty.add(g.id)); pullAndMerge(); }
  }

  /* ---------------- 日期与文案 ---------------- */

  const pad = n => String(n).padStart(2, '0');
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  // 完成时刻：精确到分钟（成就陈列室里要一眼看出"什么时候做完的"）
  function fmtDoneAt(ts) {
    const ms = msOf(ts);
    if (!ms) return '';
    const d = new Date(ms);
    const h = pad(d.getHours()), mi = pad(d.getMinutes());
    if (d.getFullYear() === new Date().getFullYear()) {
      return t('doneStamp', d.getMonth() + 1, d.getDate(), h, mi);
    }
    return t('doneStampY', d.getFullYear(), d.getMonth() + 1, d.getDate(), h, mi);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const reduceMotion = () =>
    !!(W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------------- 渲染 ---------------- */

  let entranceDone = false;
  let popId = null;

  function render() {
    renderStats();
    renderLanes();
    renderShelves();
    renderCalendar();      // 日历跟同一份数据走，勾完立刻反映到格子上
    renderSyncBar();
  }

  // 记录是否算"这一天完成了"：单次看 status，循环看历史里有没有这一天
  function isCompleteOn(g, day) {
    if (g.status === 'done') return true;
    return g.loop !== 'none' && (g.history || []).some(h => h.date === day);
  }

  // 顶部进度 = 今日行动：今天该做的（含逾期未做）里完成了多少
  function todayStats() {
    const today = todayStr();
    const list = visibleGoals().filter(g => {
      if (g.status === 'done') return isToday(g.doneAt);
      if (g.status !== 'doing' || !g.actionDate) return false;
      return g.actionDate <= today;
    });
    const done = list.filter(g => isCompleteOn(g, today)).length;
    const late = list.filter(g => overdueDays(g) > 0).length;
    return { total: list.length, done, open: list.length - done, late };
  }

  function renderStats() {
    const { total, done, open, late } = todayStats();
    const pct = total ? Math.round((done / total) * 100) : 0;

    if (progressCard) {
      const note = total
        ? `${esc(t('statActive'))} ${open} · ${esc(t('statDone'))} ${done}`
          + (late ? ` · <span class="note-late">${esc(t('overdue'))} ${late}</span>` : '')
        : esc(t('actionEmpty'));
      progressCard.innerHTML = `
        <div class="progress-top">
          <span class="progress-label">${esc(t('progress'))}</span>
          <span class="progress-value">${pct}%</span>
        </div>
        <div class="progress-bar"><i style="width:${pct}%"></i></div>
        <div class="progress-note">${note}</div>`;
    }
    if (syncProgress) {
      syncProgress.textContent = total ? `${pct}% · ${t('statDone')} ${done}/${total}` : '';
    }
  }

  /* ---------------- 卡片与两条泳道 ---------------- */

  // 卡片元信息：分类 · 循环 · （循环计划的历史次数 / 完成时刻）
  const loopName = l => t('loop' + l.charAt(0).toUpperCase() + l.slice(1));

  /* 逾期天数：0 表示没逾期。卡片上的红色警告和顶部进度里的小字都用它。
     · 一次性计划：行动日过了几天就算几天
     · 循环计划：以"最后一次打卡"为起点，超过一个周期才算逾期
       （每天背单词昨天刚打过卡 → 0；连着三天没打 → 2，即真正漏掉的整天数）
     单看 action_date 会把"每天都在做的习惯"永远标成逾期，所以循环计划必须另算。 */
  const LOOP_CYCLE = { daily: 1, weekly: 7, monthly: 30 };
  function overdueDays(g) {
    if (!g || g.status !== 'doing') return 0;
    const today = parseDate(todayStr());
    if (g.loop === 'none') {
      if (!g.actionDate) return 0;
      const d = parseDate(g.actionDate);
      return d < today ? Math.round((today - d) / 86400000) : 0;
    }
    const days = (g.history || []).map(h => h.date).filter(Boolean).sort();
    const from = days.length ? days[days.length - 1] : g.actionDate;
    if (!from) return 0;
    const gap = Math.round((today - parseDate(from)) / 86400000);
    const miss = gap - (LOOP_CYCLE[g.loop] || 1);
    return miss > 0 ? miss : 0;
  }

  function cardMeta(g, mode) {
    const parts = [catLabel(g.category)];
    // 行动列表里的日期单独做成可点的"改期"按钮，这里不再重复一遍；
    // 成就里的日期则是"什么时候做完的"，所以只显示完成时刻。
    if (g.loop !== 'none') parts.push(loopName(g.loop));
    const hist = (g.history || []).length;
    if (g.loop !== 'none' && hist) parts.push(t('loopTimes', hist));
    if (mode === 'done' && g.doneAt) parts.push(fmtDoneAt(g.doneAt));
    return parts.filter(Boolean).map(esc).join(' · ');
  }

  // 日期短标签：用当前语言的日期格式（9月19日 周六 / 19 Sep, Sat）
  function periodShort(dateStr) {
    const d = parseDate(dateStr);
    const wd = (STRINGS[lang] || STRINGS.zh).WD[d.getDay()];
    return t('uDay', d.getMonth() + 1, d.getDate(), wd);
  }

  function cardMarkup(g, mode) {
    const done = mode === 'done';
    const checkTitle = done ? t('undoDone') : t('markDone');
    const tag = g.entryType === 'idea'
      ? `<span class="tag tag-idea">${esc(t('tagIdea'))}</span>`
      : `<span class="tag tag-plan">${esc(t('tagPlan'))}</span>`;
    const doneToday = g.loop !== 'none' && isCompleteOn(g, todayStr());
    // 逾期：排期过了还没完成 → 整张卡转红 + 一枚红标签。
    // 这类条目只会留在行动列表里当"刺"，不会被退回灵感箱。
    const late = done ? 0 : overdueDays(g);

    return `
      <div class="card${done ? ' done is-done' : ''}${late ? ' is-overdue' : ''}${g.id === popId ? ' pop' : ''}"
           data-id="${g.id}" data-entry="${g.entryType}">
        ${mode === 'inbox' ? '' : `
        <button class="check" type="button" title="${esc(checkTitle)}">
          <span class="check-mark">✓</span>
        </button>`}
        <div class="card-body">
          <span class="txt">${esc(g.title)}</span>
          <div class="meta">
            ${mode === 'action' ? tag : ''}
            ${mode === 'action' && g.actionDate ? `
            <button class="date-chip" type="button" data-resched="${g.id}"
                    title="${esc(t('reschedule'))}">${esc(periodShort(g.actionDate))}</button>` : ''}
            <span class="meta-text">${cardMeta(g, mode)}</span>
            ${late ? `<span class="tag tag-late">${esc(t('overdueBy', late))}</span>` : ''}
            ${doneToday ? `<span class="meta-ok">${esc(t('doneToday'))}</span>` : ''}
          </div>
          ${g.id === movingId ? `
          <div class="card-move">
            <input class="mini-date" type="date" value="${esc(g.actionDate || todayStr())}"
                   aria-label="${esc(t('dateAria'))}" />
            <button class="mini-btn" type="button" data-move-ok>${esc(mode === 'action' ? t('reschedule') : t('moveAction'))}</button>
            <button class="mini-btn ghost" type="button" data-move-cancel
                    title="${esc(t('undo'))}" aria-label="${esc(t('undo'))}">✕</button>
          </div>` : ''}
        </div>
        ${mode === 'inbox' && g.id !== movingId
          ? `<button class="move-btn" type="button" data-move="${g.id}">${esc(t('moveAction'))}</button>`
          : ''}
        <button class="del ${done ? ' always' : ''}" type="button"
                title="${esc(t('delLabel'))}" aria-label="${esc(t('delLabel'))}">${esc(t('delText'))}</button>
      </div>`;
  }

  function laneMarkup(list, mode, emptyKey) {
    if (!list.length) return `<div class="empty">${esc(t(emptyKey))}</div>`;
    return `<div class="list">${list.map(g => cardMarkup(g, mode)).join('')}</div>`;
  }

  function renderLanes() {
    const all = visibleGoals();
    const inbox = all.filter(g => g.status === 'inbox')
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const doing = all.filter(g => g.status === 'doing')
      .sort((a, b) => String(a.actionDate || '').localeCompare(String(b.actionDate || ''))
        || (a.createdAt || 0) - (b.createdAt || 0));

    if (inboxCount) inboxCount.textContent = inbox.length;
    if (actionCount) actionCount.textContent = doing.length;
    if (inboxList) inboxList.innerHTML = laneMarkup(inbox, 'inbox', 'inboxEmpty');
    if (actionList) actionList.innerHTML = laneMarkup(doing, 'action', 'actionEmpty');
  }

  /* ---------------- 成就陈列室：按 category 分架（可折叠） ---------------- */

  // 折叠状态按"分类名"记，只存被折起来的那些。存放在本地，
  // 这样重画（勾一条、切语言）之后架子还是收着的，不会被弹开。
  const FOLD_KEY = 'xiaomubiao.folded.v1';
  let folded = new Set();

  function loadFolded() {
    try {
      const raw = storage.get(FOLD_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      folded = new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch (e) {
      folded = new Set();
    }
  }

  function saveFolded() {
    try { storage.set(FOLD_KEY, JSON.stringify([...folded])); } catch (e) {}
  }

  function renderShelves() {
    if (!shelvesEl) return;
    const done = visibleGoals().filter(g => g.status === 'done')
      .sort((a, b) => msOf(b.doneAt) - msOf(a.doneAt));

    if (doneTotalEl) {
      doneTotalEl.textContent = done.length ? `${t('statDone')} ${done.length}` : '';
    }

    if (!done.length) {
      shelvesEl.innerHTML = `<div class="empty">${esc(t('achieveEmpty'))}</div>`;
      return;
    }

    // 同一分类归到一个架子上；"未分类"永远排最后
    const byCat = new Map();
    done.forEach(g => {
      const key = g.category || DEFAULT_CAT;
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key).push(g);
    });

    shelvesEl.innerHTML = [...byCat.entries()]
      .sort((a, b) => {
        if (a[0] === DEFAULT_CAT) return 1;
        if (b[0] === DEFAULT_CAT) return -1;
        return b[1].length - a[1].length;
      })
      .map(([cat, items]) => {
        const off = folded.has(cat);
        return `
        <section class="shelf${off ? ' folded' : ''}" data-cat="${esc(cat)}">
          <button class="shelf-head" type="button" data-fold="${esc(cat)}" aria-expanded="${!off}">
            <span class="shelf-chev" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
                   stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
            <span class="shelf-name">${esc(catLabel(cat))}</span>
            <span class="shelf-count">${items.length}</span>
          </button>
          <div class="shelf-body">
            <div class="shelf-grid">
              ${items.map(g => `
                <div class="shelf-item card done is-done" data-id="${g.id}">
                  <button class="check" type="button" title="${esc(t('undoDone'))}">
                    <span class="check-mark">✓</span>
                  </button>
                  <div class="card-body">
                    <span class="txt">${esc(g.title)}</span>
                    <div class="meta">${cardMeta(g, 'done')}</div>
                  </div>
                  <button class="del always" type="button"
                          title="${esc(t('delLabel'))}" aria-label="${esc(t('delLabel'))}">${esc(t('delText'))}</button>
                </div>`).join('')}
            </div>
          </div>
        </section>`;
      }).join('');

    popId = null;
  }

  // 点分类标题：就地折叠 / 展开。只切 class，不重画，
  // 这样 0fr → 1fr 的高度动画才有东西可做。
  if (shelvesEl) {
    shelvesEl.addEventListener('click', e => {
      const btn = e.target.closest ? e.target.closest('[data-fold]') : null;
      if (!btn) return;
      const cat = btn.dataset.fold;
      const off = !folded.has(cat);
      if (off) folded.add(cat); else folded.delete(cat);
      saveFolded();
      const shelf = btn.closest('.shelf');
      if (shelf && shelf.classList) shelf.classList.toggle('folded', off);
      btn.setAttribute('aria-expanded', String(!off));
    });
  }

  /* ---------------- 过渡动画 ---------------- */

  function playEntrance(root) {
    if (reduceMotion()) return;
    const groups = root.querySelectorAll('.lane, .shelf');
    groups.forEach((el, i) => {
      if (!el.animate) return;
      el.animate(
        [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
        { duration: 380, delay: Math.min(i * 70, 280), easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' }
      );
    });
    const empty = root.querySelector('.empty');
    if (empty && empty.animate) {
      empty.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
    }
  }

  function animateRowOut(cardEl, after) {
    if (!cardEl || !cardEl.animate || reduceMotion()) { after(); return; }
    const h = cardEl.getBoundingClientRect().height;
    cardEl.style.overflow = 'hidden';
    const anim = cardEl.animate(
      [{ height: h + 'px', opacity: 1, transform: 'translateX(0)' },
       { height: '0px', opacity: 0, transform: 'translateX(16px)' }],
      { duration: 320, easing: 'cubic-bezier(.4,0,.6,1)' }
    );
    let done = false;
    const finish = () => { if (done) return; done = true; after(); };
    anim.onfinish = finish;
    anim.oncancel = finish;
    setTimeout(finish, 420);
  }

  /* ---------------- 导航切换（侧栏 / 手机底部菜单） ---------------- */

  function showView(name) {
    const id = 'view-' + name;
    const target = document.getElementById(id);
    if (!target) return;
    D.querySelectorAll('.view').forEach(v => { v.hidden = (v.id !== id); });
    if (navEl) {
      navEl.querySelectorAll('[data-view]').forEach(b =>
        b.classList.toggle('on', b.dataset.view === name));
    }
    // 切回来时重画一次：日历/陈列室的内容可能已经变了
    if (name === 'calendar') renderCalendar();
    if (name === 'achieve') renderShelves();
    if (name === 'goals') renderLanes();
  }

  function wireNav() {
    if (!navEl) return;
    navEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-view]');
      if (!btn) return;
      showView(btn.dataset.view);
    });
  }

  /* 图标轨的"放大 / 让位"效果完全由 CSS 完成（见 .rail-btn:hover），
     不需要 JS：原来的鼠标 Y 轴跟随太"黏"，已经撤掉。 */

  /* ---------------- 静态文案与语言 ---------------- */

  function applyStatic() {
    document.documentElement.lang = HTML_LANG[lang] || 'en';
    D.querySelectorAll('[data-i18n]').forEach(el => {
      if (!el.dataset.i18n) return;
      el.textContent = t(el.dataset.i18n);
    });
    D.querySelectorAll('[data-i18n-ph]').forEach(el => {
      el.setAttribute('placeholder', t(el.dataset.i18nPh));
    });
    D.querySelectorAll('[data-i18n-aria]').forEach(el => {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
    if (langBtn) langBtn.setAttribute('aria-label', t('langAria'));
    renderAuthMode();
    renderSyncBar();
  }

  function renderLangMenu() {
    if (!langMenu) return;
    // 外面套一层是为了做 0fr→1fr 的高度动画（见 .lang-acc-inner）
    langMenu.innerHTML = `<div class="lang-acc-inner" role="none">${LANGS.map(l => `
      <button type="button" role="menuitemradio" aria-checked="${l.code === lang}"
              class="lang-item${l.code === lang ? ' on' : ''}" data-lang="${l.code}">
        <span class="flag flag-${l.code}" aria-hidden="true"></span>
        <span class="lang-item-name">${esc(l.name)}</span>
        <span class="lang-tick" aria-hidden="true">✓</span>
      </button>`).join('')}</div>`;
  }

  function closeLangMenu() {
    if (!langMenu || !langBtn) return;
    if (langMenu.classList.contains('open')) {
      langMenu.classList.remove('open');
      langMenu._hideTimer = setTimeout(() => { langMenu.hidden = true; }, 220);  // 等 0fr 收完
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
    if (langMenu.offsetHeight >= 0) langMenu.classList.add('open');
    if (toolPanel && toolPanel.hidden) openToolPanel();   // 手风琴只长在面板里
    langBtn.setAttribute('aria-expanded', 'true');
    const first = langMenu.querySelector('.lang-item');
    if (first) first.focus();
  }

  /* ---------------- 底部收纳面板：语言 / 主题 / 账号 ---------------- */

  function closeToolPanel() {
    closeLangMenu();
    if (!toolPanel || toolPanel.hidden) return;
    toolPanel.classList.remove('open');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
    clearTimeout(toolPanel._hideTimer);
    toolPanel._hideTimer = setTimeout(() => { toolPanel.hidden = true; }, 200);
  }

  function openToolPanel() {
    if (!toolPanel || !menuBtn) return;
    clearTimeout(toolPanel._hideTimer);
    toolPanel.hidden = false;
    if (toolPanel.offsetHeight >= 0) toolPanel.classList.add('open');
    menuBtn.setAttribute('aria-expanded', 'true');
  }

  function toggleToolPanel() {
    if (!toolPanel) return;
    // 用 .open 判断而不是 hidden：收起动画还没跑完时 hidden 仍是 false
    if (toolPanel.classList.contains('open')) closeToolPanel(); else openToolPanel();
  }

  function setLang(next, opts) {
    lang = STRINGS[next] ? next : 'zh';
    try { storage.set(LANG_KEY, lang); } catch (e) {}
    applyStatic();
    if (!opts || !opts.soft) render();
    else { renderStats(); renderLanes(); renderShelves(); }
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
      if (langIcon && langIcon.animate && !reduceMotion()) {
        langIcon.animate(
          [{ transform: 'scale(1) rotate(0)' }, { transform: 'scale(1.18) rotate(-8deg)' },
           { transform: 'scale(1) rotate(0)' }],
          { duration: 320, easing: 'cubic-bezier(.3,1.4,.5,1)' }
        );
      }
    });
  }

  // 菜单键：开合收纳面板
  if (menuBtn) {
    menuBtn.addEventListener('click', e => {
      e.stopPropagation();        // 否则会立刻被下面那句"点到外面就关"命中
      toggleToolPanel();
    });
  }
  // 面板内部的点击（选语言、切主题…）不该被当成"点到了外面"
  if (toolPanel) toolPanel.addEventListener('click', e => e.stopPropagation());

  D.addEventListener('click', e => {
    if (!toolPanel || toolPanel.hidden) return;
    if (e.target.closest && e.target.closest('#menuWrap')) return;
    closeToolPanel();
  });

  D.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !toolPanel || !toolPanel.classList.contains('open')) return;
    // 两级 Esc：先收语言手风琴，再按一次才关整个面板
    if (langMenu && langMenu.classList.contains('open')) {
      closeLangMenu();
      if (langBtn) langBtn.focus();
    } else {
      closeToolPanel();
      if (menuBtn) menuBtn.focus();
    }
  });

  /* ══════════════════ 日历视图 ══════════════════ */

  let calYear = 0, calMonth = 0, calSel = '';

  function initCalCursor() {
    const d = parseDate(todayStr());
    calYear = d.getFullYear();
    calMonth = d.getMonth();
    calSel = todayStr();
  }

  // 某一天的行动：按 action_date 归档；循环计划看历史里有没有这一天
  function dayStats(dateStr) {
    const list = visibleGoals().filter(g => g.actionDate === dateStr && g.status !== 'inbox');
    const done = list.filter(g => isCompleteOn(g, dateStr)).length;
    return { list, total: list.length, done };
  }

  function renderCalendar() {
    if (!calGrid) return;
    if (!calSel) initCalCursor();

    const wd = (STRINGS[lang] || STRINGS.zh).WD;
    const startWd = new Date(calYear, calMonth, 1).getDay();
    const days = new Date(calYear, calMonth + 1, 0).getDate();
    const todayS = todayStr();

    if (calTitle) calTitle.textContent = t('uMonth', calYear, calMonth + 1);

    let html = wd.map(w => `<span class="cal-wd">${esc(w)}</span>`).join('');
    for (let i = 0; i < startWd; i++) html += '<span class="cal-pad"></span>';

    for (let d = 1; d <= days; d++) {
      const ds = `${calYear}-${pad(calMonth + 1)}-${pad(d)}`;
      const st = dayStats(ds);
      // 状态三档：没做 / 做了一部分 / 全做完（图例同色）
      const state = (!st.total || !st.done) ? 'todo'
        : (st.done === st.total ? 'all' : 'part');
      const label = t('uDay', calMonth + 1, d, wd[new Date(calYear, calMonth, d).getDay()])
        + (st.total ? ` · ${t('calDone')} ${st.done}/${st.total}` : '');
      html += `
        <button class="cal-day ${state}${ds === todayS ? ' today' : ''}${ds === calSel ? ' on' : ''}"
                type="button" data-date="${ds}" aria-label="${esc(label)}"
                aria-pressed="${ds === calSel}">
          <span class="n">${d}</span>
          <span class="cal-meta">${st.total ? st.done + '/' + st.total : ''}</span>
        </button>`;
    }
    calGrid.innerHTML = html;
    renderCalDay();
  }

  function renderCalDay() {
    if (!calDayHead || !calList) return;
    const d = parseDate(calSel);
    const wd = (STRINGS[lang] || STRINGS.zh).WD[d.getDay()];
    const st = dayStats(calSel);

    calDayHead.textContent = t('uDay', d.getMonth() + 1, d.getDate(), wd);
    if (calCount) calCount.textContent = st.total ? `${t('calDone')} ${st.done}/${st.total}` : '';
    // 直接复用看板的卡片标记：勾选 / 删除的委托挂在 document 上，这里白拿一套。
    // 已完成的那天也显示成"已完成"（否则和没做的长得一样）。
    calList.innerHTML = st.list.map(g =>
      cardMarkup(g, g.status === 'done' ? 'done' : 'action')).join('');
    calList.hidden = st.total === 0;
    if (calEmpty) calEmpty.hidden = st.total > 0;
  }

  function shiftMonth(n) {
    const d = new Date(calYear, calMonth + n, 1);
    calYear = d.getFullYear();
    calMonth = d.getMonth();
    renderCalendar();
  }

  if (calPrev) calPrev.addEventListener('click', () => shiftMonth(-1));
  if (calNext) calNext.addEventListener('click', () => shiftMonth(1));
  if (calGrid) {
    calGrid.addEventListener('click', e => {
      const btn = e.target.closest('[data-date]');
      if (!btn) return;
      calSel = btn.dataset.date;
      renderCalendar();
    });
  }

  /* ══════════════════ 内联录入：两个模板 + 可创建分类器 ══════════════════ */

  function updateHint() {
    if (!hintEl) return;
    hintEl.textContent = '';
    hintEl.classList.remove('warn');
  }

  /* 「定计划」的日期：默认今天，并且不许选过去。
     min 让原生日历把过去的日期变灰；这里再兜一道，保证任何路径
     （手打、粘贴、跨零点）填进来的都不是过去的日期。 */
  function syncDateBounds() {
    if (!dateInput) return;
    const today = todayStr();
    dateInput.min = today;
    if (!dateInput.value || dateInput.value < today) dateInput.value = today;
  }

  function setEntryDraft(name) {
    entryDraft = ENTRY[name] ? name : 'idea';
    if (cpTabs) {
      cpTabs.querySelectorAll('[data-entry]').forEach(b => {
        const on = b.dataset.entry === entryDraft;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      });
    }
    // 只有「定计划」需要日期和循环
    if (planOnly) planOnly.hidden = entryDraft !== 'plan';
    if (entryDraft === 'plan') syncDateBounds();      // 默认今天 + 禁止选过去
    if (loopLabel) loopLabel.textContent = loopName(loopRule);
    if (loopBtn) loopBtn.classList.toggle('on', loopRule !== 'none');
    updateHint();
  }

  if (cpTabs) {
    cpTabs.addEventListener('click', e => {
      const btn = e.target.closest('[data-entry]');
      if (!btn) return;
      setEntryDraft(btn.dataset.entry);
      if (entryDraft === 'plan' && dateInput) dateInput.focus();
      else if (titleInput) titleInput.focus();
    });
  }

  // 循环规则：一个按钮在 不循环 → 每天 → 每周 → 每月 之间轮转
  if (loopBtn) {
    loopBtn.addEventListener('click', () => {
      const i = LOOP_ORDER.indexOf(loopRule);
      loopRule = LOOP_ORDER[(i + 1) % LOOP_ORDER.length];
      setEntryDraft(entryDraft);
    });
  }

  /* ---------- 可创建式分类器（Creatable Combobox） ----------
     不是 <select>：点开有列表、可以直接打字、打出来的新词会在底部
     变成一条「➕ 创建新分类『xxx』」，键盘 ↑↓/Enter/Esc 全都能用。 */

  function categoryCounts() {
    const counts = new Map();
    counts.set(DEFAULT_CAT, 0);
    visibleGoals().forEach(g => {
      const c = g.category || DEFAULT_CAT;
      counts.set(c, (counts.get(c) || 0) + 1);
    });
    return counts;
  }

  function comboOptions(query) {
    const q = String(query || '').trim().toLowerCase();
    return [...categoryCounts().entries()]
      .filter(([c]) => !q || c.toLowerCase().includes(q))
      // 默认分类永远排第一，其余按使用次数
      .sort((a, b) => (a[0] === DEFAULT_CAT ? -1 : b[0] === DEFAULT_CAT ? 1 : b[1] - a[1]));
  }

  // 输入框里的词是不是"还不存在的新分类"
  function comboCreateName() {
    const v = (catInput && catInput.value || '').trim().slice(0, CAT_MAX);
    if (!v) return '';
    const counts = categoryCounts();
    return counts.has(v) ? '' : v;
  }

  function renderCombo() {
    if (!catMenuEl || !catInput) return;
    const opts = comboOptions(catInput.value);
    const create = comboCreateName();
    const cur = catInput.value.trim();
    let html = opts.map(([c, n], i) => `
      <button class="combo-opt${c === cur ? ' on' : ''}${i === comboCursor ? ' active' : ''}"
              type="button" role="option" aria-selected="${c === cur}" data-cat="${esc(c)}">
        <span>${esc(catLabel(c))}</span>
        ${n ? `<span class="combo-count">${n}</span>` : ''}
      </button>`).join('');
    if (create) {
      html += `
        <button class="combo-opt create${comboCursor === opts.length ? ' active' : ''}"
                type="button" role="option" aria-selected="false"
                data-cat="${esc(create)}" data-create="1">
          <span aria-hidden="true">➕</span>
          <span>${esc(t('catCreate', create))}</span>
        </button>`;
    }
    catMenuEl.innerHTML = html;
  }

  function openCombo() {
    if (!catMenuEl || !catInput) return;
    comboOpen = true;
    comboCursor = 0;
    renderCombo();
    catMenuEl.hidden = false;
    catInput.setAttribute('aria-expanded', 'true');
  }

  function closeCombo() {
    if (!catMenuEl || !catInput) return;
    comboOpen = false;
    catMenuEl.hidden = true;
    catMenuEl.innerHTML = '';
    catInput.setAttribute('aria-expanded', 'false');
  }

  function pickCategory(name) {
    if (!catInput) return;
    catInput.value = name === DEFAULT_CAT ? '' : name;
    closeCombo();
    if (titleInput && titleInput.value) hintEl && updateHint();
  }

  if (catInput) {
    catInput.addEventListener('focus', openCombo);
    catInput.addEventListener('click', openCombo);
    catInput.addEventListener('input', () => { comboCursor = 0; openCombo(); });
    catInput.addEventListener('keydown', e => {
      const items = comboOptions(catInput.value);
      const canCreate = !!comboCreateName();
      const max = items.length - 1 + (canCreate ? 1 : 0);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!comboOpen) return openCombo();
        comboCursor = Math.min(max, comboCursor + 1);
        renderCombo();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        comboCursor = Math.max(0, comboCursor - 1);
        renderCombo();
      } else if (e.key === 'Enter') {
        if (!comboOpen) return;
        e.preventDefault();
        if (comboCursor <= items.length - 1) pickCategory(items[comboCursor][0]);
        else if (canCreate) pickCategory(comboCreateName());
      } else if (e.key === 'Escape') {
        if (comboOpen) { e.stopPropagation(); closeCombo(); }
      }
    });
  }

  if (catMenuEl) {
    catMenuEl.addEventListener('click', e => {
      const opt = e.target.closest('[data-cat]');
      if (!opt) return;
      pickCategory(opt.dataset.cat);
      if (titleInput) titleInput.focus();
    });
  }

  // 点面板以外的地方就收起下拉
  document.addEventListener('click', e => {
    if (!comboOpen) return;
    if (e.target.closest && e.target.closest('#catCombo')) return;
    closeCombo();
  });

  // 提交时如果用户什么都没选/什么都没填 → 默认「未分类」
  function readCategory() {
    const v = (catInput && catInput.value || '').trim().slice(0, CAT_MAX);
    return v || DEFAULT_CAT;
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
    const isPlan = entryDraft === 'plan';
    let day = isPlan ? (dateInput.value || '') : null;
    if (isPlan && !/^\d{4}-\d{2}-\d{2}$/.test(day || '')) {
      hintEl.textContent = t('needDate');
      hintEl.classList.add('warn');
      dateInput.focus();
      return;
    }
    // 过去的日期不收：日期框已经设了 min，这里再兜一道（手打也拦得住）
    if (isPlan && day < todayStr()) {
      day = todayStr();
      dateInput.value = day;
    }

    // 模板 A：灵感 → 进灵感箱（inbox），没有日期
    // 模板 B：计划 → 跳过 inbox，直接进行动（doing）
    const fresh = normalizeGoal({
      id: uid(),
      title,
      entryType: isPlan ? 'plan' : 'idea',
      status: isPlan ? 'doing' : 'inbox',
      category: readCategory(),
      actionDate: day,
      loop: isPlan ? loopRule : 'none',
      history: [],
      createdAt: nowMs(),
      updatedAt: nowMs()
    });

    goals.unshift(fresh);
    save([fresh.id]);
    titleInput.value = '';
    if (catInput) catInput.value = '';
    closeCombo();
    updateHint();
    render();
    if (!reduceMotion()) {
      const el = (isPlan ? actionList : inboxList);
      const card = el && el.querySelector(`.card[data-id="${fresh.id}"]`);
      if (card && card.animate) {
        card.animate(
          [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
          { duration: 240, easing: 'cubic-bezier(.2,.7,.3,1)' }
        );
      }
    }
    titleInput.focus();
    toast(t('tAdd'));
  });

  /* ---------------- 打勾 / 恢复 / 推入行动 ---------------- */

  function markGoalDone(g, cardEl) {
    // 循环计划：记一条历史、留在原位
    if (g.loop && g.loop !== 'none') {
      const day = todayStr();
      if (!Array.isArray(g.history)) g.history = [];
      // 打卡时刻精确到毫秒，落库进 history[].at
      if (!g.history.some(h => h.date === day)) g.history.push({ at: nowIso(), date: day });
      g.updatedAt = nowMs();
      save([g.id]);
      render();
      toast(t('doneToday'));
      return;
    }
    // 单次任务：打勾即完成，移出行动列表 → 进成就陈列室
    // 完成时刻直接抓系统时间（ISO，精确到毫秒），成就里显示到分钟
    g.status = 'done';
    g.doneAt = nowIso();
    g.updatedAt = nowMs();
    save([g.id]);
    if (cardEl && cardEl.classList) {
      cardEl.classList.add('is-done');
      animateRowOut(cardEl, () => { render(); toast(t('tDone')); });
    } else {
      render();
      toast(t('tDone'));
    }
  }

  function restoreGoal(g) {
    g.status = g.actionDate ? 'doing' : 'inbox';
    g.doneAt = null;
    g.updatedAt = nowMs();
    save([g.id]);
    popId = g.id;
    render();
    toast(t('tUndone'));
  }

  // 推进行动列表：灵感一键"推入行动"走的就是这里，日期由调用方给
  function moveToAction(g, day) {
    g.actionDate = day;
    g.status = 'doing';
    g.updatedAt = nowMs();
    movingId = null;
    save([g.id]);
    render();
    toast(t('tMoved'));
  }

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
          // 撤销删除：恢复记录、撤掉墓碑，并让它们重新上传到云端
          const before = new Map(goals.map(g => [g.id, g]));
          const stamp = nowMs();
          goals = undoStack.map(g => {
            const cur = before.get(g.id);
            const keep = cur || g;
            return { ...keep, deletedAt: null, updatedAt: stamp };
          });
          const ids = undoStack.map(g => g.id);
          clearTombstone(ids);                        // 不再是"已删除"
          ids.forEach(id => {
            pendingHardDelete.delete(String(id));     // 取消待物理删除
            dirty.add(id);                            // 重新推回云端
          });
          save(ids);
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
    // 「推入行动」：一键，零摩擦 —— 不问日期、不弹窗，
    // 直接在后台抓当前系统日期当行动日，再平滑移到下面的行动列表。
    const moveBtn = e.target.closest('[data-move]');
    if (moveBtn) {
      const g = goals.find(x => x.id === moveBtn.dataset.move);
      if (g) moveToAction(g, todayStr());
      return;
    }
    // 行动卡片上的日期：点它才就地展开改期行（唯一需要手动填日期的入口）
    const reBtn = e.target.closest('[data-resched]');
    if (reBtn) {
      const id = reBtn.dataset.resched;
      movingId = movingId === id ? null : id;
      render();
      return;
    }
    if (e.target.closest('[data-move-cancel]')) {
      movingId = null;
      render();
      return;
    }
    const moveOk = e.target.closest('[data-move-ok]');
    if (moveOk) {
      const card = moveOk.closest('.card');
      const input = card && card.querySelector ? card.querySelector('.mini-date') : null;
      const day = input ? input.value : '';
      const g = goals.find(x => x.id === movingId);
      if (!g) { movingId = null; render(); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) { toast(t('needDate')); return; }
      moveToAction(g, day);
      return;
    }

    const checkBtn = e.target.closest('.check');
    if (checkBtn) {
      const card = checkBtn.closest('.card');
      const g = goals.find(x => x.id === card.dataset.id);
      if (!g) return;
      if (g.status === 'done') restoreGoal(g);
      else markGoalDone(g, card);
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
        // 真删除：从本地数组移除 + 记墓碑 + 让云端也把这一行删掉。
        // 墓碑用于防止"另一台离线设备把它重新上传"导致复活。
        goals = goals.filter(x => x.id !== g.id);
        markDeleted([g.id]);
        dirty.delete(g.id);
        pendingHardDelete.add(String(g.id));
        save();                      // 落本地并触发同步（pushChanges 会做 delete）
        render();
        showUndo(t('tDeleted', g.title), snapshot);
      };
      animateRowOut(card, finish);
    }
  });

  clearDoneBtn.addEventListener('click', () => {
    const done = goals.filter(g => g.status === 'done' && !g.deletedAt);
    if (!done.length) return toast(t('tNoDone'));
    if (!safeConfirm(t('cClear', done.length))) return;
    const snapshot = goals.slice();
    const ids = done.map(g => g.id);
    // 与单条删除一致：清空已完成也是真删除 + 记墓碑
    goals = goals.filter(g => !ids.includes(g.id));
    markDeleted(ids);
    ids.forEach(id => dirty.delete(id));
    ids.forEach(id => pendingHardDelete.add(String(id)));
    save();
    render();
    showUndo(t('tCleared', done.length), snapshot);
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
    // 只换字形，不能用 themeBtn.textContent —— 那会把面板里的小标签一起清掉
    const glyph = themeGlyph || themeBtn;
    if (glyph) glyph.textContent = th === 'dark' ? '☀' : '☾';
    try { storage.set(THEME_KEY, th); } catch (e) {}
  }

  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    const glyph = themeGlyph || themeBtn;    // 转的是字形，不是整个格子
    if (glyph.animate && !reduceMotion()) {
      glyph.animate(
        [{ transform: 'rotate(0) scale(1)' }, { transform: 'rotate(180deg) scale(1.1)' },
         { transform: 'rotate(360deg) scale(1)' }],
        { duration: 420, easing: 'cubic-bezier(.3,1.2,.4,1)' }
      );
    }
  });

  /* ---------------- 配色皮肤 ---------------- */

  const SKIN_KEY = 'xiaomubiao.skin.v1';
  const SKINS = ['paper', 'iris', 'cobalt', 'lime'];
  let skin = 'paper';

  function applySkin(name) {
    skin = SKINS.indexOf(name) >= 0 ? name : 'paper';
    // 默认的"纸墨"就是 :root 本身，写上去也不会命中任何皮肤规则
    document.documentElement.dataset.skin = skin;
    try { storage.set(SKIN_KEY, skin); } catch (e) {}
    if (skinRow) {
      skinRow.querySelectorAll('[data-skin]').forEach(b =>
        b.setAttribute('aria-checked', String(b.dataset.skin === skin)));
    }
  }

  if (skinRow) {
    skinRow.addEventListener('click', e => {
      const btn = e.target.closest('[data-skin]');
      if (!btn) return;
      applySkin(btn.dataset.skin);
    });
  }

  /* ---------------- 初始化 ---------------- */

  function showCloudHint() {
    const proto = W.location && W.location.protocol;
    const host = W.location && W.location.hostname;
    if (!cloudHost || proto === 'file:' || !host) return;
    const label = {
      zh: '数据同步到你的账号', en: 'Your data syncs to your account',
      th: 'ข้อมูลซิงก์กับบัญชีของคุณ', vi: 'Dữ liệu đồng bộ với tài khoản của bạn',
      ms: 'Data disegerak ke akaun anda', id: 'Data tersinkron ke akun Anda',
      hi: 'डेटा आपके खाते में सिंक होता है'
    };
    cloudHost.textContent = label[lang] || label.zh;
    cloudHost.hidden = false;
  }

  function boot() {
    lang = detectLang();
    goals = loadLocal();
    loadTombstones();          // 恢复已删除 id 的墓碑（防止删掉的记录复活）
    bootedFromLocal = goals.length > 0;

    let savedTheme = null;
    try { savedTheme = storage.get(THEME_KEY); } catch (e) {}
    if (!savedTheme) {
      savedTheme = W.matchMedia && W.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark' : 'light';
    }
    applyTheme(savedTheme);

    let savedSkin = null;
    try { savedSkin = storage.get(SKIN_KEY); } catch (e) {}
    applySkin(savedSkin || 'paper');

    dateInput.value = todayStr();
    dateInput.min = todayStr();       // 定计划：默认今天，不许选过去
    syncDateBounds();
    loadFolded();                     // 成就陈列室里哪些分类是收着的
    applyStatic();
    renderLangMenu();
    closeLangMenu();
    setEntryDraft('idea');    // 默认停在「记想法」模板
    closeCombo();
    updateHint();
    render();
    showCloudHint();
    wireAuthUI();
    wireNav();
    showView('goals');        // 默认落在"目标"视图
    renderAuth();

    // 初始数据为空：新用户面对干净的列表（不再塞演示数据，避免污染云端）
    if (!goals.length && defaultGoals.length) {
      goals = defaultGoals.map((g, i) => ({
        ...g,
        id: g.id || uid(),
        createdAt: g.createdAt || (nowMs() + i),
        updatedAt: g.updatedAt || (nowMs() + i),
        deletedAt: null
      }));
      save();
      render();
    }

    // 启动云端（异步，不阻塞首屏）
    startCloud();
  }

  try {
    boot();
  } catch (err) {
    console.error('My Goals init failed:', err);
  }
})();
