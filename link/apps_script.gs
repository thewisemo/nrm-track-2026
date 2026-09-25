/**
 * نورماندي شوز — سجل الأحداث ولوحة التحكم
 * الاستخدام: افتح الشيت > Extensions > Apps Script > الصق الكود ده كله
 * بعدين Deploy > New deployment > Web app
 *   Execute as: Me
 *   Who has access: Anyone
 * انسخ الرابط اللي هيطلع وحطه في config.json في خانة log_endpoint
 */

var EVENTS_SHEET = 'الأحداث';
var HEADERS = ['التاريخ والوقت','اليوم','الساعة','نوع الحدث','القناة','الكود','الفرع','المقاس',
               'المصدر','البوست','utm_source','utm_medium','utm_campaign','utm_content',
               'الوجهة','الصفحة السابقة','الجهاز'];

function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  try {
    var p = (e && e.parameter) ? e.parameter : {};
    if (p.ping) return out({ ok: true, msg: 'نورماندي — السجل شغال' });

    var sh = getSheet();
    var now = new Date();
    var tz  = Session.getScriptTimeZone() || 'Africa/Cairo';

    sh.appendRow([
      Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss'),
      Utilities.formatDate(now, tz, 'EEEE'),
      Number(Utilities.formatDate(now, tz, 'H')),
      p.ev   || 'click',
      p.k === 'channel' ? (p.id || '') : (p.k || ''),
      p.m    || '',
      p.b    || (p.k === 'map' || p.k === 'call' ? (p.id || '') : ''),
      p.s    || '',
      p.src  || '',
      p.post || '',
      p.utm_source   || '',
      p.utm_medium   || '',
      p.utm_campaign || '',
      p.utm_content  || '',
      p.dest || '',
      p.ref  || '',
      ((e && e.parameter && e.parameter.ua) ? e.parameter.ua : '')
    ]);

    // صورة شفافة 1×1 عشان الاستدعاء بالـ Image يشتغل برضه
    if (p.img) {
      return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
    }
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, err: String(err) });
  }
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(EVENTS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(EVENTS_SHEET);
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#2D2A28').setFontColor('#F0EDE6');
    sh.setFrozenRows(1);
  }
  return sh;
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** شغّل ده مرة واحدة بإيدك عشان يجهّز التبويبات */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  getSheet();
  var tabs = {
    'الفروع'   : ['كود الفرع','اسم الفرع','المواعيد','التليفون','لينك الخريطة'],
    'الأسئلة'  : ['السؤال','الإجابة','ظاهر'],
    'الإعدادات': ['المفتاح','القيمة','ملاحظة'],
    'الروابط'  : ['اسم الرابط','المنصة','الحملة','المحتوى','الرابط الجاهز']
  };
  Object.keys(tabs).forEach(function (name) {
    if (!ss.getSheetByName(name)) {
      var s = ss.insertSheet(name);
      s.appendRow(tabs[name]);
      s.getRange(1, 1, 1, tabs[name].length).setFontWeight('bold')
        .setBackground('#2D2A28').setFontColor('#F0EDE6');
      s.setFrozenRows(1);
    }
  });
}
