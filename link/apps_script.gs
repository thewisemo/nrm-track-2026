/**
 * نورماندي شوز — سجل الأحداث + تفعيل الضمان + لوحة التحكم
 *
 * التركيب مرة واحدة:
 *  افتح الشيت > Extensions > Apps Script > الصق الكود ده كله > احفظ
 *  شغّل setup() مرة واحدة بإيدك (بيجهّز التبويبات)
 *  Deploy > New deployment > Web app
 *     Execute as: Me
 *     Who has access: Anyone
 *  انسخ الرابط وحطه في config.json في خانتين:
 *     log_endpoint         (تسجيل الزيارات والضغطات)
 *     warranty.endpoint    (تفعيل الضمان والاستعلام) — نفس الرابط
 *
 * لوحة التحكم = تبويب «الإعدادات». غيّر مدة الضمان أو مهلة التفعيل من هناك،
 * والصفحة بتقراها أول ما تتفتح. مفيش تعديل كود ومفيش رفع ملفات.
 */

var EVENTS = 'الأحداث';
var WAR    = 'الضمان';
var SETT   = 'الإعدادات';
var STOCK  = 'المخزون';
var ASKS   = 'طلبات الموديلات';
var OWH    = 'ربط الفروع بأودو';
var OLOG   = 'سجل المزامنة';

var HEADERS = ['التاريخ والوقت','اليوم','الساعة','نوع الحدث','القناة','الكود','الفرع','المقاس',
               'المصدر','البوست','utm_source','utm_medium','utm_campaign','utm_content',
               'الوجهة','الصفحة السابقة','الجهاز'];

var WHEAD = ['وقت الطلب','الرقم المرجعي','رقم الفاتورة','تاريخ الفاتورة','الفرع','اسم البائع',
             'رقم الموبايل','مدة الضمان (يوم)','تاريخ بداية الضمان','تاريخ نهاية الضمان',
             'الحالة','مين راجع','وقت المراجعة','سبب الرفض'];

var AHEAD = ['وقت الطلب','رقم الطلب','الموديل','المقاس','الفرع','وقت الرد','الرد','دقايق الانتظار'];

var SHEAD = ['كود الموديل','كود الفرع','المقاسات المتاحة','آخر تحديث','المصدر'];
var OWHEAD = ['ID المخزن في أودو','اسم المخزن في أودو','كود الفرع عندنا'];
var OLHEAD = ['وقت المزامنة','النتيجة','عدد الصفوف','تفاصيل'];

var DEFAULTS = [
  ['warranty_days','90','مدة الضمان باليوم — بتعد من تاريخ الفاتورة'],
  ['grace_days','14','مهلة التفعيل: أقصى عدد أيام بعد الشراء يسمح فيها بالتفعيل أونلاين'],
  ['warranty_on','نعم','اكتب «لأ» عشان توقف التفعيل الأونلاين مؤقتاً'],
  ['warranty_covers','النعل والغرزة وعيوب الصناعة','بيظهر في صفحة الضمان'],
  ['warranty_not_covers','سوء الاستخدام، القطع أو الحرق أو البلل الشديد، والتصليح بره الفروع','بيظهر في صفحة الضمان'],
  ['odoo_on','لأ','اكتب «نعم» عشان المخزون يتسحب من أودو أوتوماتيك بدل ما يتكتب بإيد'],
  ['odoo_url','','رابط أودو كامل — زي https://normandy.odoo.com'],
  ['odoo_db','','اسم قاعدة البيانات في أودو'],
  ['odoo_user','','إيميل مستخدم أودو (أدمن بصلاحية قراءة)'],
  ['odoo_key','','مفتاح الربط (API Key) — بيتعمل من بروفايل المستخدم في أودو'],
  ['odoo_size_mode','auto','auto = يحاول لوحده · suffix = المقاس آخر الكود (143-42) · name = المقاس في اسم المتغير'],
  ['odoo_limit','3000','أقصى عدد متغيرات بيتقروا من كل مخزن']
];

function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  try {
    var p = (e && e.parameter) ? e.parameter : {};
    if (p.ping)  return out({ ok: true, msg: 'نورماندي — الخدمة شغالة' });
    if (p.mode === 'settings') return out({ ok: true, warranty: readSettings() });
    if (p.mode === 'stock')    return out(readStock());
    if (p.mode === 'status')   return out(statusOf(p.invoice, p.phone));
    if (p.ev   === 'warranty_activate') return out(activate(p));
    if (p.ev   === 'model_ask' && p.k === 'staff')   return out(askOpen(p));
    if (p.ev   === 'model_reply' && p.k === 'staff') return out(askClose(p));
    return out(logEvent(p));
  } catch (err) {
    return out({ ok: false, err: String(err) });
  }
}

/* ---------------- الإعدادات (لوحة التحكم) ---------------- */
function readSettings() {
  var sh = tab(SETT, ['المفتاح','القيمة','ملاحظة'], DEFAULTS);
  var v  = sh.getDataRange().getValues(), m = {};
  for (var i = 1; i < v.length; i++) if (v[i][0]) m[String(v[i][0]).trim()] = String(v[i][1]).trim();
  return {
    days:        Number(m.warranty_days || 90),
    grace_days:  Number(m.grace_days || 14),
    on:          (m.warranty_on || 'نعم') !== 'لأ',
    covers:      m.warranty_covers || '',
    not_covers:  m.warranty_not_covers || ''
  };
}

/* ---------------- المخزون ----------------
 * تبويب «المخزون»: صف لكل موديل في كل فرع
 *   كود الموديل | كود الفرع | المقاسات المتاحة (٤٠,٤١,٤٢) | آخر تحديث
 * سيبه فاضي والصفحة هتقول «اسأل الفرع» — متقولش متوفر من غير بيانات.
 */
function readStock() {
  var sh = tab(STOCK, SHEAD);
  var v = sh.getDataRange().getValues(), st = {}, last = '', nO = 0, nM = 0;
  for (var i = 1; i < v.length; i++) {
    var code = String(v[i][0]).trim(), br = String(v[i][1]).trim();
    if (!code || !br) continue;
    var sizes = String(v[i][2]).split(/[,،\s]+/).map(function (x) { return parseInt(x, 10); })
                  .filter(function (x) { return !isNaN(x); });
    if (!st[code]) st[code] = {};
    st[code][br] = sizes;
    if (v[i][3]) last = v[i][3];
    if (String(v[i][4] || '').trim() === 'أودو') nO++; else nM++;
  }
  return { ok: true, stock: st, updated: String(last),
           source: (nO && nM) ? 'مخلوط' : (nO ? 'أودو' : 'يدوي') };
}

/* ---------------- طلبات الموديلات ----------------
 * تبويب «طلبات الموديلات»: صف لكل طلب بيتسأل عليه من ماسنجر
 * وقت الطلب | رقم الطلب | الموديل | المقاس | الفرع | وقت الرد | الرد | دقايق الانتظار
 * الرد بيتكتب أوتوماتيك أول ما الموظف يقفل الطلب من صفحة الموظف.
 */
function askOpen(p) {
  var sh = tab(ASKS, AHEAD);
  var tz = Session.getScriptTimeZone() || 'Africa/Cairo';
  sh.appendRow([Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss'),
                String(p.id || ''), String(p.m || ''), String(p.s || ''), String(p.b || ''),
                '', 'مفتوح', '']);
  return { ok: true };
}
function askClose(p) {
  var sh = tab(ASKS, AHEAD), v = sh.getDataRange().getValues();
  var tz = Session.getScriptTimeZone() || 'Africa/Cairo', now = new Date();
  var map = { yes: 'متوفر', alt: 'فيه بديل', no: 'مش متوفر' };
  for (var i = v.length - 1; i > 0; i--) {
    if (String(v[i][1]).trim() === String(p.id || '').trim()) {
      var t0 = new Date(v[i][0]);
      sh.getRange(i + 1, 5).setValue(String(p.b || v[i][4]));
      sh.getRange(i + 1, 6).setValue(Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss'));
      sh.getRange(i + 1, 7).setValue(map[p.dest] || String(p.dest || ''));
      sh.getRange(i + 1, 8).setValue(Math.max(0, Math.round((now - t0) / 60000)));
      return { ok: true };
    }
  }
  return { ok: false, reason: 'الطلب مش موجود' };
}

/* ---------------- تفعيل الضمان ---------------- */
function activate(p) {
  var S = readSettings();
  if (!S.on) return { ok: false, reason: 'التفعيل الأونلاين موقوف مؤقتاً' };

  var inv = String(p.invoice || '').trim();
  if (!inv) return { ok: false, reason: 'رقم الفاتورة ناقص' };
  var ph = String(p.phone || '').replace(/\D/g, '');
  if (!/^01[0125]\d{8}$/.test(ph)) return { ok: false, reason: 'رقم الموبايل مش صحيح' };

  var d0 = new Date(String(p.invoice_date || '') + 'T00:00:00');
  if (isNaN(d0.getTime())) return { ok: false, reason: 'تاريخ الفاتورة مش صحيح' };
  var age = Math.floor((new Date() - d0) / 864e5);
  if (age < 0)            return { ok: false, reason: 'تاريخ الفاتورة في المستقبل' };
  if (age > S.grace_days) return { ok: false, reason: 'عدّى أكتر من ' + S.grace_days + ' يوم على الشراء' };

  var sh = tab(WAR, WHEAD);
  // فاتورة واحدة = تفعيل واحد
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][2]).trim() === inv) return { ok: false, duplicate: true, reason: 'الفاتورة دي متفعّلة قبل كده' };
  }

  var tz  = Session.getScriptTimeZone() || 'Africa/Cairo';
  var end = new Date(d0.getTime()); end.setDate(end.getDate() + S.days);
  var ref = String(p.ref || ('NRM-' + inv.replace(/\D/g, '').slice(-6)));

  sh.appendRow([
    Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss'),
    ref, inv,
    Utilities.formatDate(d0,  tz, 'yyyy-MM-dd'),
    p.branch || '', p.seller || '', ph, S.days,
    Utilities.formatDate(d0,  tz, 'yyyy-MM-dd'),
    Utilities.formatDate(end, tz, 'yyyy-MM-dd'),
    'تحت المراجعة', '', '', ''
  ]);
  logEvent({ ev: 'warranty_activate', k: 'warranty', id: ref, b: p.branch || '' });
  return { ok: true, ref: ref, days: S.days, end: Utilities.formatDate(end, tz, 'yyyy-MM-dd') };
}

/* ---------------- الاستعلام ---------------- */
function statusOf(inv, phone) {
  inv = String(inv || '').trim();
  var ph = String(phone || '').replace(/\D/g, '');
  var sh = tab(WAR, WHEAD), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][2]).trim() === inv && String(v[i][6]).replace(/\D/g, '') === ph) {
      var st  = String(v[i][10]).trim();
      var end = new Date(v[i][9]);
      var left = Math.max(0, Math.ceil((end - new Date()) / 864e5));
      var map = { 'مفعّل': 'active', 'تحت المراجعة': 'pending', 'مرفوض': 'rejected' };
      return { ok: true, found: true, status: map[st] || 'pending', days_left: left,
               end: Utilities.formatDate(end, Session.getScriptTimeZone() || 'Africa/Cairo', 'yyyy-MM-dd'),
               reason: String(v[i][13] || '') };
    }
  }
  return { ok: true, found: false };
}

/* ---------------- سجل الأحداث ---------------- */
function logEvent(p) {
  var sh = tab(EVENTS, HEADERS);
  var now = new Date(), tz = Session.getScriptTimeZone() || 'Africa/Cairo';
  sh.appendRow([
    Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss'),
    Utilities.formatDate(now, tz, 'EEEE'),
    Number(Utilities.formatDate(now, tz, 'H')),
    p.ev || 'click',
    p.k === 'channel' ? (p.id || '') : (p.k || ''),
    p.m || '',
    p.b || (p.k === 'map' || p.k === 'call' ? (p.id || '') : ''),
    p.s || '', p.src || '', p.post || '',
    p.utm_source || '', p.utm_medium || '', p.utm_campaign || '', p.utm_content || '',
    p.dest || '', p.ref2 || p.page || '', p.ua || ''
  ]);
  return { ok: true };
}

/* ---------------- أدوات ---------------- */
function tab(name, head, rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(head);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold')
      .setBackground('#2D2A28').setFontColor('#F0EDE6');
    sh.setFrozenRows(1);
    if (rows && rows.length) sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
  return sh;
}
function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** شغّله مرة واحدة بإيدك */
function setup() {
  tab(EVENTS, HEADERS);
  tab(WAR, WHEAD);
  tab(SETT, ['المفتاح','القيمة','ملاحظة'], DEFAULTS);
  tab(STOCK, SHEAD);
  tab(ASKS, AHEAD);
  tab(OWH, OWHEAD);
  tab(OLOG, OLHEAD);
  tab('الفروع', ['كود الفرع','اسم الفرع','العنوان','المواعيد','التليفون','لينك الخريطة']);
  tab('الأسئلة', ['السؤال','الإجابة','ظاهر']);
  tab('الروابط', ['اسم الرابط','المنصة','الحملة','المحتوى','الرابط الجاهز']);
}



/* ================= أوراق الفروع =================
 * ورقة مخزون لكل فرع، مدير الفروع بيكتب فيها كمية كل مقاس من واقع الفواتير.
 * «المخزون» بتتولّد منهم — الصفحة بتقرا من «المخزون» بس.
 * الفروع نفسها مبتشوفش الشيت أصلاً، فمفيش فرع بيشوف فرع تاني.
 */
var SITE = 'https://thewisemo.github.io/nrm-track-2026/link/';

function fetchJson(name) {
  try {
    var r = UrlFetchApp.fetch(SITE + name + '?v=' + Date.now(), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return null;
    return JSON.parse(r.getContentText());
  } catch (e) { return null; }
}

function branchSheetName(name) { return 'مخزون ' + name; }

/* بيقرا الفروع من تبويب «الفروع» */
function branchList() {
  var sh = tab('الفروع', ['كود الفرع','اسم الفرع','العنوان','المواعيد','التليفون','لينك الخريطة','ورقة المخزون']);
  var v = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    var key = String(v[i][0] || '').trim();
    if (!key) continue;
    out.push({ key: key, name: String(v[i][1] || ''), sheet: String(v[i][6] || branchSheetName(v[i][1])) });
  }
  return out;
}

/* بيجهّز الشيت كله: التبويبات + الموديلات + ورقة لكل فرع */
function setupFull() {
  setup();
  var M = fetchJson('models.json'), C = fetchJson('config.json');
  if (!M || !C) {
    SpreadsheetApp.getUi().alert('التبويبات اتعملت، بس مش قادر أجيب بيانات الموديلات والفروع من الموقع.\nاتأكد من النت وجرّب تاني.');
    return;
  }
  var sizes = M.sizes || [39,40,41,42,43,44,45];

  /* الموديلات */
  var ms = tab('الموديلات', ['كود الموديل','الاسم','اللون','الاستخدام','الوصف','المقاسات','عدد الصور المرفوعة']);
  if (ms.getLastRow() > 1) ms.getRange(2, 1, ms.getLastRow() - 1, 7).clearContent();
  var mrows = (M.models || []).map(function (m) {
    return [m.code, m.name, m.color || '', m.use || '', m.desc || '',
            (m.sizes || []).join(','), (m.imgs || []).length];
  });
  if (mrows.length) ms.getRange(2, 1, mrows.length, 7).setValues(mrows);

  /* الفروع */
  var bs = tab('الفروع', ['كود الفرع','اسم الفرع','العنوان','المواعيد','التليفون','لينك الخريطة','ورقة المخزون']);
  if (bs.getLastRow() > 1) bs.getRange(2, 1, bs.getLastRow() - 1, 7).clearContent();
  var brows = (C.branches || []).map(function (b) {
    return [b.key, b.name, b.addr || '', b.hours || '', b.phone || '', b.map || '', branchSheetName(b.name)];
  });
  if (brows.length) bs.getRange(2, 1, brows.length, 7).setValues(brows);

  /* ورقة مخزون لكل فرع */
  var head = ['كود الموديل','الاسم'];
  for (var i = 0; i < sizes.length; i++) head.push('مقاس ' + sizes[i]);
  head.push('آخر تحديث');
  (C.branches || []).forEach(function (b) {
    var sh = tab(branchSheetName(b.name), head);
    var have = {}, v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (v[i][0]) have[String(v[i][0]).trim()] = i + 1;
    (M.models || []).forEach(function (m) {
      if (have[m.code]) return;
      var row = [m.code, m.name];
      for (var k = 0; k < sizes.length; k++) row.push('');
      row.push('');
      sh.appendRow(row);
    });
  });

  SpreadsheetApp.getUi().alert('الشيت اتجهّز ✓\n\n' + mrows.length + ' موديل · ' + brows.length + ' فرع.\n' +
    'كل فرع له ورقة اسمها «مخزون + اسم الفرع» — اكتب فيها كمية كل مقاس.\n' +
    'وبعدين اضغط «حدّث المخزون من أوراق الفروع».');
}

/* بيجمّع أوراق الفروع في تبويب «المخزون» */
function rollupBranches() {
  var tz = Session.getScriptTimeZone() || 'Africa/Cairo';
  var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rows = [], seen = 0;

  branchList().forEach(function (b) {
    var sh = ss.getSheetByName(b.sheet);
    if (!sh) return;
    var v = sh.getDataRange().getValues();
    if (v.length < 2) return;
    /* أعمدة المقاسات: اللي هيدرها «مقاس NN» */
    var cols = [];
    for (var c = 0; c < v[0].length; c++) {
      var m = String(v[0][c]).match(/(\d{2})/);
      if (m && String(v[0][c]).indexOf('مقاس') === 0) cols.push({ c: c, size: +m[1] });
    }
    for (var i = 1; i < v.length; i++) {
      var code = String(v[i][0] || '').trim();
      if (!code) continue;
      var got = [];
      for (var k = 0; k < cols.length; k++) {
        var q = v[i][cols[k].c];
        if (q === '' || q === null) continue;
        if (Number(q) > 0) got.push(cols[k].size);
      }
      if (!got.length) continue;
      rows.push([code, b.key, got.join(','), stamp, 'يدوي']);
      seen++;
    }
  });

  var sh = tab(STOCK, SHEAD);
  var v = sh.getDataRange().getValues();
  /* بنسيب صفوف أودو زي ما هي ونستبدل اليدوي بس */
  var keep = [];
  for (var i = 1; i < v.length; i++)
    if (String(v[i][4] || '').trim() === 'أودو') keep.push(v[i].slice(0, SHEAD.length));
  var all = keep.concat(rows);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SHEAD.length).clearContent();
  if (all.length) sh.getRange(2, 1, all.length, SHEAD.length).setValues(all);
  return { ok: true, rows: rows.length, kept: keep.length, stamp: stamp };
}

function menuRollup() {
  var r = rollupBranches();
  SpreadsheetApp.getUi().alert('المخزون اتحدّث ✓\n\n' + r.rows + ' صف من أوراق الفروع' +
    (r.kept ? ('\nو' + r.kept + ' صف من أودو اتسابوا زي ما هم.') : '') +
    '\n\nالتوفر بقى ظاهر للعملاء في صفحة التشكيلة.');
}
function installRollup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'rollupBranches') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('rollupBranches').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert('المخزون هيتحدّث من أوراق الفروع كل ساعة أوتوماتيك.');
}

/* ================= الربط بأودو (JSON-RPC) =================
 * الفكرة: الصفحة بتقرا من تبويب «المخزون» دايماً — مش بتكلّم أودو مباشرة.
 * لو الربط شغال: مزامنة كل ساعة بتكتب المخزون في نفس التبويب وتحطّ «أودو» في عمود المصدر.
 * لو الربط واقف أو وقع: التبويب بيفضل زي ما هو، والتيم بيملّيه بإيده، والصفحة شغالة عادي.
 *
 * التركيب:
 *  ١ — تبويب «الإعدادات»: اكتب odoo_url و odoo_db و odoo_user و odoo_key، وخلّي odoo_on = نعم
 *  ٢ — من قائمة «نورماندي» اضغط «اختبار الربط بأودو»
 *  ٣ — اضغط «اسحب مخازن أودو» فتبويب «ربط الفروع بأودو» يتملّى، واكتب كود الفرع عندنا جنب كل مخزن
 *  ٤ — اضغط «شغّل المزامنة كل ساعة»
 */

function odooCfg() {
  var sh = tab(SETT, ['المفتاح','القيمة','ملاحظة'], DEFAULTS);
  var v = sh.getDataRange().getValues(), m = {};
  for (var i = 1; i < v.length; i++) if (v[i][0]) m[String(v[i][0]).trim()] = String(v[i][1]).trim();
  return {
    on:   (m.odoo_on || 'لأ') === 'نعم',
    url:  (m.odoo_url || '').replace(/\/+$/, ''),
    db:   m.odoo_db || '',
    user: m.odoo_user || '',
    key:  m.odoo_key || '',
    mode: m.odoo_size_mode || 'auto',
    limit: Number(m.odoo_limit || 3000)
  };
}

function odooCall(cfg, service, method, args) {
  if (!cfg.url) throw new Error('رابط أودو فاضي في الإعدادات');
  var res = UrlFetchApp.fetch(cfg.url + '/jsonrpc', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ jsonrpc: '2.0', method: 'call',
      params: { service: service, method: method, args: args } })
  });
  var txt = res.getContentText();
  if (res.getResponseCode() >= 400 && txt.indexOf('{') !== 0)
    throw new Error('السيرفر رد بكود ' + res.getResponseCode());
  var j = JSON.parse(txt);
  if (j.error) throw new Error((j.error.data && j.error.data.message) || j.error.message || 'خطأ من أودو');
  return j.result;
}
function odooUid(cfg) {
  var uid = odooCall(cfg, 'common', 'login', [cfg.db, cfg.user, cfg.key]);
  if (!uid) throw new Error('الدخول اتـرفض — راجع اسم قاعدة البيانات والمستخدم والمفتاح');
  return uid;
}
function odooKw(cfg, uid, model, method, args, kwargs) {
  return odooCall(cfg, 'object', 'execute_kw', [cfg.db, uid, cfg.key, model, method, args, kwargs || {}]);
}

/* إصدارات أودو مختلفة في اسم حقل «منتج مخزون»: type / is_storable.
   بنجرّب الاتنين وبعدين من غير فلتر خالص — المهم الشغل ميقفش. */
function odooProducts(cfg, uid, kwargs) {
  var tries = [
    [['type', '=', 'product'], ['qty_available', '>', 0]],
    [['is_storable', '=', true], ['qty_available', '>', 0]],
    [['qty_available', '>', 0]]
  ];
  var lastErr;
  for (var i = 0; i < tries.length; i++) {
    try { return odooKw(cfg, uid, 'product.product', 'search_read', [tries[i]], kwargs); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/* المقاس والكود من بيانات المتغير */
function splitCodeSize(code, name, mode) {
  code = String(code || '').trim(); name = String(name || '');
  var m;
  if (mode !== 'name') {
    m = code.match(/^(.*?)[\s\-_\/]+(\d{2})$/);
    if (m && +m[2] >= 34 && +m[2] <= 50) return [m[1], +m[2]];
  }
  if (mode !== 'suffix') {
    var all = name.match(/\d{2}/g) || [];
    for (var i = all.length - 1; i >= 0; i--) {
      var n = +all[i];
      if (n >= 34 && n <= 50) return [code, n];
    }
  }
  return [code, 0];
}

function branchWarehouses() {
  var sh = tab(OWH, OWHEAD), v = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    var id = Number(v[i][0]), key = String(v[i][2] || '').trim();
    if (id && key) out.push({ id: id, name: String(v[i][1] || ''), key: key });
  }
  return out;
}

/* ---- سحب المخازن من أودو عشان التيم يربطها بالفروع ---- */
function pullOdooWarehouses() {
  var cfg = odooCfg(), uid = odooUid(cfg);
  var whs = odooKw(cfg, uid, 'stock.warehouse', 'search_read', [[]],
                   { fields: ['id', 'name', 'code'], limit: 200 });
  var sh = tab(OWH, OWHEAD);
  var old = {}, v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (v[i][0]) old[String(v[i][0])] = v[i][2];
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, OWHEAD.length).clearContent();
  var rows = whs.map(function (w) {
    return [w.id, w.name + (w.code ? ' (' + w.code + ')' : ''), old[String(w.id)] || ''];
  });
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);
  return rows.length;
}

/* ---- المزامنة: بتكتب في تبويب «المخزون» ---- */
function syncOdooStock() {
  var cfg = odooCfg();
  var tz = Session.getScriptTimeZone() || 'Africa/Cairo';
  var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  if (!cfg.on) return olog(stamp, 'موقوف', 0, 'odoo_on مش «نعم» — المخزون بيتكتب بإيد');
  try {
    var uid = odooUid(cfg);
    var whs = branchWarehouses();
    if (!whs.length) return olog(stamp, 'فشل', 0, 'تبويب «ربط الفروع بأودو» فاضي — اسحب المخازن واكتب كود الفرع');

    var map = {}, seen = 0;
    for (var w = 0; w < whs.length; w++) {
      var prods = odooProducts(cfg, uid,
        { fields: ['default_code', 'display_name', 'qty_available'],
          limit: cfg.limit, context: { warehouse: whs[w].id } });
      for (var i = 0; i < prods.length; i++) {
        var p = prods[i];
        if (!(p.qty_available > 0)) continue;
        var cs = splitCodeSize(p.default_code, p.display_name, cfg.mode);
        if (!cs[0] || !cs[1]) continue;
        var k = cs[0] + '|' + whs[w].key;
        if (!map[k]) map[k] = [];
        if (map[k].indexOf(cs[1]) < 0) map[k].push(cs[1]);
        seen++;
      }
    }

    var rows = [];
    Object.keys(map).sort().forEach(function (k) {
      var a = k.split('|');
      rows.push([a[0], a[1], map[k].sort(function (x, y) { return x - y; }).join(','), stamp, 'أودو']);
    });
    if (!rows.length) return olog(stamp, 'فشل', 0, 'أودو رد من غير أي متغير بمقاس مفهوم — جرّب تغيّر odoo_size_mode');

    var sh = tab(STOCK, SHEAD);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SHEAD.length).clearContent();
    sh.getRange(2, 1, rows.length, SHEAD.length).setValues(rows);
    return olog(stamp, 'تمت', rows.length, 'من ' + whs.length + ' مخزن · ' + seen + ' متغير');
  } catch (err) {
    return olog(stamp, 'فشل', 0, String(err).slice(0, 250));
  }
}

function olog(stamp, res, n, detail) {
  var sh = tab(OLOG, OLHEAD);
  sh.appendRow([stamp, res, n, detail]);
  if (sh.getLastRow() > 200) sh.deleteRows(2, sh.getLastRow() - 200);
  return { ok: res === 'تمت', result: res, rows: n, detail: detail };
}

/* ---- أزرار القائمة ---- */
function testOdoo() {
  var ui = SpreadsheetApp.getUi(), cfg = odooCfg();
  if (!cfg.url || !cfg.db || !cfg.user || !cfg.key) {
    ui.alert('ناقص بيانات: املا odoo_url و odoo_db و odoo_user و odoo_key في تبويب «الإعدادات».'); return;
  }
  try {
    var uid = odooUid(cfg);
    var ver = odooCall(cfg, 'common', 'version', []);
    var n = odooKw(cfg, uid, 'product.product', 'search_count', [[]], {});
    var whs = odooKw(cfg, uid, 'stock.warehouse', 'search_read', [[]], { fields: ['id', 'name'], limit: 50 });
    var sample = odooProducts(cfg, uid, { fields: ['default_code', 'display_name'], limit: 3 });
    var lines = sample.map(function (p) {
      var cs = splitCodeSize(p.default_code, p.display_name, cfg.mode);
      return '• ' + (p.default_code || '—') + ' | ' + p.display_name +
             '  ←  كود: ' + (cs[0] || '؟') + ' · مقاس: ' + (cs[1] || 'مش مفهوم');
    }).join('\n');
    ui.alert('الربط شغال ✓\n\nإصدار أودو: ' + (ver.server_version || '؟') +
             '\nعدد المنتجات: ' + n + '\nعدد المخازن: ' + whs.length +
             '\n\nعيّنة من القراءة:\n' + (lines || 'مفيش منتجات بكميات') +
             '\n\nلو المقاس مش مفهوم، غيّر odoo_size_mode في الإعدادات لـ suffix أو name.');
  } catch (err) {
    ui.alert('الربط مش شغال ✕\n\n' + String(err) +
             '\n\nالمخزون هيفضل بيتكتب بإيد في تبويب «المخزون» والصفحة شغالة عادي.');
  }
}
function menuPullWarehouses() {
  try { SpreadsheetApp.getUi().alert('اتسحب ' + pullOdooWarehouses() + ' مخزن. اكتب كود الفرع عندنا جنب كل واحد في العمود التالت.'); }
  catch (err) { SpreadsheetApp.getUi().alert('مش قادر أسحب المخازن:\n' + String(err)); }
}
function menuSyncNow() {
  var r = syncOdooStock();
  SpreadsheetApp.getUi().alert('المزامنة: ' + r.result + '\nالصفوف: ' + r.rows + '\n' + (r.detail || ''));
}
function installOdooSync() {
  removeOdooSync();
  ScriptApp.newTrigger('syncOdooStock').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert('المزامنة هتشتغل كل ساعة. تقدر توقفها من نفس القائمة.');
}
function removeOdooSync() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncOdooStock') ScriptApp.deleteTrigger(t);
  });
}
function menuRemoveSync() { removeOdooSync(); SpreadsheetApp.getUi().alert('المزامنة اتوقفت. المخزون بقى يدوي.'); }

/* ---- رجوع للوضع اليدوي ---- */
function switchToManualStock() {
  var sh = tab(SETT, ['المفتاح','القيمة','ملاحظة'], DEFAULTS), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).trim() === 'odoo_on') sh.getRange(i + 1, 2).setValue('لأ');
  removeOdooSync();
  SpreadsheetApp.getUi().alert('الربط اتقفل والمزامنة اتوقفت. تبويب «المخزون» بقى يدوي — امسح عمود «المصدر» لما تعدّل صف بإيدك.');
}

/* ---------------- شاشة مراجعة الموظفين ---------------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('نورماندي')
    .addItem('تأكيد تفعيل الصفوف المختارة', 'confirmRows')
    .addItem('رفض الصفوف المختارة', 'rejectRows')
    .addSeparator()
    .addItem('جهّز الشيت من أول وجديد', 'setupFull')
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('المخزون وأودو')
      .addItem('حدّث المخزون من أوراق الفروع', 'menuRollup')
      .addItem('حدّثه كل ساعة أوتوماتيك', 'installRollup')
      .addSeparator()
      .addItem('اختبار الربط بأودو', 'testOdoo')
      .addItem('اسحب مخازن أودو', 'menuPullWarehouses')
      .addItem('زامن المخزون دلوقتي', 'menuSyncNow')
      .addSeparator()
      .addItem('شغّل المزامنة كل ساعة', 'installOdooSync')
      .addItem('وقّف المزامنة', 'menuRemoveSync')
      .addItem('رجّع المخزون يدوي', 'switchToManualStock'))
    .addToUi();
}
function markRows(status, reason) {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== WAR) { SpreadsheetApp.getUi().alert('افتح تبويب «الضمان» الأول.'); return; }
  var r = sh.getActiveRange(), tz = Session.getScriptTimeZone() || 'Africa/Cairo';
  var who = Session.getActiveUser().getEmail() || '';
  var now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  for (var i = 0; i < r.getNumRows(); i++) {
    var row = r.getRow() + i;
    if (row === 1) continue;
    sh.getRange(row, 11).setValue(status);
    sh.getRange(row, 12).setValue(who);
    sh.getRange(row, 13).setValue(now);
    if (reason) sh.getRange(row, 14).setValue(reason);
  }
}
function confirmRows() { markRows('مفعّل', ''); }
function rejectRows() {
  var res = SpreadsheetApp.getUi().prompt('سبب الرفض؟');
  if (res.getSelectedButton() === SpreadsheetApp.getUi().Button.OK) markRows('مرفوض', res.getResponseText());
}
