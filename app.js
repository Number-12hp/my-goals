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

  const SCOPES = { year: {}, month: {}, week: {}, day: {} };
  const TYPES  = { main: {}, side: {} };

  /* ---------------- 文案字典（7 种语言） ---------------- */

  // 注意：每种语言都必须提供完全相同的键，测试会强制校验
  const STRINGS = {
    zh: {
      MN: ['1月', '2月', '3月', '4月', '5月', '6月',
           '7月', '8月', '9月', '10月', '11月', '12月'],
      WD: ['日', '一', '二', '三', '四', '五', '六'],

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
      overdue: 'Quá hạn',
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
      overdue: 'Lewat',
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
      overdue: 'Terlambat',
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
      overdue: 'समय बीता',
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
  const t = (k, a, b, c) => {
    const dict = STRINGS[lang] || STRINGS.zh;
    const v = dict[k];
    if (typeof v === 'function') return v(a, b, c);
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
  const board       = $('board');
  const archiveList = $('archiveList');
  const archiveBox  = $('archiveBox');
  const archiveCount= $('archiveCount');
  const form        = $('form');
  const titleInput  = $('title');
  const dateInput   = $('date');
  const hintEl      = $('hint');
  const scopeSeg    = $('scopeSeg');
  const typeSeg     = $('typeSeg');
  const langBtn     = $('langBtn');
  const langMenu    = $('langMenu');
  const langIcon    = $('langIcon');
  const filtersEl   = $('filters');
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

  let goals   = [];
  let filter  = 'undone';
  let scope   = 'day';
  let type    = 'main';
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

  // 本地记录 → 云端行（云端表用 snake_case，时间统一毫秒）
  function toRow(g, userId) {
    return {
      id: g.id,
      user_id: userId,
      title: g.title,
      scope: g.scope,
      type: g.type,
      date: g.date,
      done: !!g.done,
      done_at: g.doneAt || null,
      created_at: g.createdAt || nowMs(),
      updated_at: g.updatedAt || g.createdAt || nowMs(),
      deleted_at: g.deletedAt || null
    };
  }

  // 云端行 → 本地记录
  function fromRow(r) {
    return {
      id: String(r.id),
      title: typeof r.title === 'string' ? r.title : '',
      scope: SCOPES[r.scope] ? r.scope : 'day',
      type: TYPES[r.type] ? r.type : 'side',
      date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : todayStr(),
      done: !!r.done,
      doneAt: r.done_at || null,
      createdAt: r.created_at || nowMs(),
      updatedAt: r.updated_at || r.created_at || nowMs(),
      deletedAt: r.deleted_at || null
    };
  }

  function loadLocal() {
    try {
      const raw = storage.get(STORE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr.filter(g => g && typeof g.title === 'string').map(g => ({
        id: g.id || uid(),
        title: g.title,
        scope: SCOPES[g.scope] ? g.scope : 'day',
        type: TYPES[g.type] ? g.type : 'side',
        date: /^\d{4}-\d{2}-\d{2}$/.test(g.date) ? g.date : todayStr(),
        done: !!g.done,
        doneAt: g.doneAt || null,
        createdAt: g.createdAt || nowMs(),
        updatedAt: g.updatedAt || g.createdAt || nowMs(),
        deletedAt: g.deletedAt || null
      }));
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
    if (syncText) syncText.textContent = label;
    if (syncPill) {
      syncPill.dataset.state = syncState;
      syncPill.setAttribute('title', label);
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

  // 把本地待推送的改动写到云端
  async function pushChanges() {
    if (!cloud || !session || !dirty.size) return;
    const ids = [...dirty];
    const rows = goals.filter(g => ids.includes(g.id)).map(g => toRow(g, session.user.id));
    if (!rows.length) { dirty.clear(); return; }
    setSyncState('syncing');
    try {
      const { error } = await cloud.from(CLOUD.table).upsert(rows, { onConflict: 'id' });
      if (error) throw error;
      ids.forEach(id => dirty.delete(id));
      setSyncState(dirty.size ? 'syncing' : 'synced');
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
      const { data, error } = await cloud
        .from(CLOUD.table)
        .select('id,title,scope,type,date,done,done_at,created_at,updated_at,deleted_at')
        .eq('user_id', session.user.id)
        .order('updated_at', { ascending: true })
        .limit(5000);
      if (error) throw error;

      const remoteRows = data || [];
      const byId = new Map(goals.map(g => [g.id, g]));
      let changed = false, downloaded = 0, keptLocal = 0;

      for (const row of remoteRows) {
        const remote = fromRow(row);
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

      // 本地有、云端没有的（离线新建）→ 待上传
      const remoteIds = new Set(remoteRows.map(r => r.id));
      goals.forEach(g => { if (!remoteIds.has(g.id)) dirty.add(g.id); });

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

      // 合并完成后再推送；推送是 per-id upsert，不会删除云端任何行
      await pushChanges();
      if (dirty.size === 0) setSyncState('synced');
      console.log(`[sync] 云端 ${remoteRows.length} 行 → 下载/更新 ${downloaded}，本地更新回推 ${keptLocal}`);
    } catch (e) {
      console.warn('pull failed', e);
      setSyncState('offline');
    }
  }

  /* ---------------- 登录弹窗 ---------------- */

  function openAuthModal() {
    if (!authModal) return;
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

  let entranceDone = false;
  let popId = null;

  function render() {
    renderStats();
    renderBoard();
    renderArchive();
    syncChips();
    renderSyncBar();
  }

  // 进度显示在底部状态栏（统计卡片已移除）
  function renderStats() {
    const list = visibleGoals();
    const total = list.length;
    const done = list.filter(g => g.done).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    if (syncProgress) {
      syncProgress.textContent = total ? `${pct}% · ${t('statDone')} ${done}/${total}` : '';
    }
  }

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
        <button class="del ${inArchive ? ' always' : ''}" type="button"
                title="${esc(t('delLabel'))}" aria-label="${esc(t('delLabel'))}">${esc(t('delText'))}</button>
      </div>`;
  }

  function renderBoard() {
    const list = visibleGoals().filter(matchFilter);
    const byScope = { year: [], month: [], week: [], day: [] };
    list.forEach(g => { if (byScope[g.scope]) byScope[g.scope].push(g); });

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
          (a.done - b.done) || (a.createdAt || 0) - (b.createdAt || 0)
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
      const all = visibleGoals();
      const unDone = all.filter(g => !g.done);
      const msg = !all.length ? t('emptyNoGoals')
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
    const done = visibleGoals().filter(g => g.done)
      .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    archiveCount.textContent = done.length;
    archiveList.innerHTML = done.length
      ? done.map(g => cardMarkup(g, true)).join('')
      : `<div class="empty">${esc(t('emptyArchive'))}</div>`;
  }

  /* ---------------- 过渡动画 ---------------- */

  function playEntrance(root) {
    if (reduceMotion()) return;
    const groups = root.querySelectorAll('.group');
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

  /* ---------------- 分段选择器滑块 ---------------- */

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
      thumb.style.left = left + 'px';
      thumb.style.width = w + 'px';
    }
  }
  function relayoutSegments() {
    placeThumb(scopeSeg);
    placeThumb(typeSeg);
  }
  function markThumbReady(seg) { if (seg) seg.dataset.ready = '1'; }

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
    langMenu.innerHTML = LANGS.map(l => `
      <button type="button" role="menuitemradio" aria-checked="${l.code === lang}"
              class="lang-item${l.code === lang ? ' on' : ''}" data-lang="${l.code}">
        <span class="flag flag-${l.code}" aria-hidden="true"></span>
        <span class="lang-item-name">${esc(l.name)}</span>
        <span class="lang-tick" aria-hidden="true">✓</span>
      </button>`).join('');
  }

  function closeLangMenu() {
    if (!langMenu || !langBtn) return;
    if (langMenu.classList.contains('open')) {
      langMenu.classList.remove('open');
      langMenu._hideTimer = setTimeout(() => { langMenu.hidden = true; }, 180);
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

    const rect = langBtn.getBoundingClientRect ? langBtn.getBoundingClientRect() : null;
    if (rect && (rect.height || rect.top)) {
      const vh = W.innerHeight || 800;
      const below = Math.max(0, vh - rect.bottom - 22);
      const above = Math.max(0, rect.top - 22);
      const MENU_NEEDS = 340;
      const useUp = below < MENU_NEEDS && above > below;
      langMenu.classList.toggle('up', useUp);
      const room = Math.max(below, above);
      langMenu.style.setProperty('--menu-max',
        Math.round(Math.max(180, Math.min(room, vh - 40))) + 'px');
    }

    if (langMenu.offsetHeight >= 0) langMenu.classList.add('open');
    langBtn.setAttribute('aria-expanded', 'true');
    const first = langMenu.querySelector('.lang-item');
    if (first) first.focus();
  }

  function setLang(next, opts) {
    lang = STRINGS[next] ? next : 'zh';
    try { storage.set(LANG_KEY, lang); } catch (e) {}
    applyStatic();
    if (!opts || !opts.soft) render();
    else { renderStats(); renderArchive(); }
    relayoutSegments();
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
    placeThumb(scopeSeg);
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
    const fresh = {
      id: uid(),
      title,
      scope,
      type,
      date: dateInput.value || todayStr(),
      done: false,
      doneAt: null,
      createdAt: nowMs(),
      updatedAt: nowMs(),
      deletedAt: null
    };
    goals.push(fresh);
    save([fresh.id]);
    titleInput.value = '';
    titleInput.focus();
    updateHint();
    render();
    if (!reduceMotion()) {
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
      g.doneAt = nowMs();
      g.updatedAt = nowMs();
      save([g.id]);
      cardEl.classList.add('is-done');
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
      g.updatedAt = nowMs();
      save([g.id]);
      popId = g.id;
      render();
      toast(t('tUndone'));
    }
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
          // 撤销删除：把之前标记为删除的记录恢复
          const before = new Map(goals.map(g => [g.id, g]));
          const stamp = nowMs();
          goals = undoStack.map(g => {
            const cur = before.get(g.id);
            const keep = cur || g;
            return { ...keep, deletedAt: null, updatedAt: stamp };
          });
          undoStack.forEach(g => dirty.add(g.id));
          save(undoStack.map(g => g.id));
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
        // 软删除：留在数组里打标记，才能同步给其他设备
        g.deletedAt = nowMs();
        g.updatedAt = nowMs();
        save([g.id]);
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
    const done = goals.filter(g => g.done && !g.deletedAt);
    if (!done.length) return toast(t('tNoDone'));
    if (!safeConfirm(t('cClear', done.length))) return;
    const snapshot = goals.slice();
    const stamp = nowMs();
    done.forEach(g => { g.deletedAt = stamp; g.updatedAt = stamp; });
    save(done.map(g => g.id));
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
    bootedFromLocal = goals.length > 0;

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
    closeLangMenu();
    updateHint();
    render();
    showCloudHint();
    wireAuthUI();
    renderAuth();

    relayoutSegments();
    markThumbReady(scopeSeg);
    markThumbReady(typeSeg);
    if (W.addEventListener) W.addEventListener('resize', () => relayoutSegments());

    // 首次打开给一点示例（仅本地为空时）
    if (!goals.length) {
      const demo = {
        zh: ['看一部一直想看的电影', '读完一本搁置很久的书'],
        en: ['Watch a movie I keep meaning to see', 'Finish a book I put down long ago'],
        th: ['ดูหนังที่อยากดูมานาน', 'อ่านหนังสือที่ค้างไว้นานแล้ว'],
        vi: ['Xem một bộ phim đã muốn xem từ lâu', 'Đọc xong cuốn sách bỏ dở'],
        ms: ['Tonton filem yang lama teringin', 'Habiskan buku yang tergendala'],
        id: ['Tonton film yang lama ingin ditonton', 'Selesaikan buku yang tertunda'],
        hi: ['वह फ़िल्म देखें जो लंबे समय से देखनी थी', 'वह किताब पूरी करें जो अधूरी रह गई']
      };
      const [a, b] = demo[lang] || demo.zh;
      const stamp = nowMs();
      goals = [
        { id: uid(), title: a, scope: 'week', type: 'side', date: todayStr(),
          done: false, doneAt: null, createdAt: stamp, updatedAt: stamp, deletedAt: null },
        { id: uid(), title: b, scope: 'month', type: 'main', date: todayStr(),
          done: false, doneAt: null, createdAt: stamp + 1, updatedAt: stamp + 1, deletedAt: null }
      ];
      save(goals.map(g => g.id));
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
