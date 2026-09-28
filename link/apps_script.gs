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

var HEADERS = ['التاريخ والوقت','اليوم','الساعة','نوع الحدث','القناة','الكود','الفرع','المقاس',
               'المصدر','البوست','utm_source','utm_medium','utm_campaign','utm_content',
               'الوجهة','الصفحة السابقة','الجهاز'];

var WHEAD = ['وقت الطلب','الرقم المرجعي','رقم الفاتورة','تاريخ الفاتورة','الفرع','اسم البائع',
             'رقم الموبايل','مدة الضمان (يوم)','تاريخ بداية الضمان','تاريخ نهاية الضمان',
             'الحالة','مين راجع','وقت المراجعة','سبب الرفض'];

var AHEAD = ['وقت الطلب','رقم الطلب','الموديل','المقاس','الفرع','وقت الرد','الرد','دقايق الانتظار'];

var DEFAULTS = [
  ['warranty_days','90','مدة الضمان باليوم — بتعد من تاريخ الفاتورة'],
  ['grace_days','14','مهلة التفعيل: أقصى عدد أيام بعد الشراء يسمح فيها بالتفعيل أونلاين'],
  ['warranty_on','نعم','اكتب «لأ» عشان توقف التفعيل الأونلاين مؤقتاً'],
  ['warranty_covers','النعل والغرزة وعيوب الصناعة','بيظهر في صفحة الضمان'],
  ['warranty_not_covers','سوء الاستخدام، القطع أو الحرق أو البلل الشديد، والتصليح بره الفروع','بيظهر في صفحة الضمان']
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
  var sh = tab(STOCK, ['كود الموديل','كود الفرع','المقاسات المتاحة','آخر تحديث']);
  var v = sh.getDataRange().getValues(), st = {}, last = '';
  for (var i = 1; i < v.length; i++) {
    var code = String(v[i][0]).trim(), br = String(v[i][1]).trim();
    if (!code || !br) continue;
    var sizes = String(v[i][2]).split(/[,،\s]+/).map(function (x) { return parseInt(x, 10); })
                  .filter(function (x) { return !isNaN(x); });
    if (!st[code]) st[code] = {};
    st[code][br] = sizes;
    if (v[i][3]) last = v[i][3];
  }
  return { ok: true, stock: st, updated: String(last) };
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
  tab(STOCK, ['كود الموديل','كود الفرع','المقاسات المتاحة','آخر تحديث']);
  tab(ASKS, AHEAD);
  tab('الفروع', ['كود الفرع','اسم الفرع','العنوان','المواعيد','التليفون','لينك الخريطة']);
  tab('الأسئلة', ['السؤال','الإجابة','ظاهر']);
  tab('الروابط', ['اسم الرابط','المنصة','الحملة','المحتوى','الرابط الجاهز']);
}

/* ---------------- شاشة مراجعة الموظفين ---------------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('نورماندي')
    .addItem('تأكيد تفعيل الصفوف المختارة', 'confirmRows')
    .addItem('رفض الصفوف المختارة', 'rejectRows')
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
