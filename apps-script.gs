/**
 * Laurier LSSG 小遊戲排行榜（兩款遊戲共用）
 *
 * 安裝：喺「Laurier 遊戲排行榜」Google Sheet → 擴充功能 → Apps Script，
 * 將呢個檔案全部內容貼入去，儲存，然後「部署 → 新增部署作業 → 網頁應用程式」：
 *   執行身分：我
 *   誰可以存取：所有人
 * 部署後複製「網頁應用程式網址」（https://script.google.com/macros/s/…/exec）。
 *
 * 每次提交都會喺「Scores」分頁加一行（時間、遊戲、暱稱、手機、分數）。
 * 公開返回嘅排行榜只有暱稱同分數，手機號碼只留喺呢份 Sheet。
 */

var SHEET_NAME = 'Scores';
var MAX_SCORE = { fly: 2000, match: 200000, stack: 3000 }; // 超過呢個分數當作作弊，唔接受
var GAMES = { fly: true, match: true, stack: true };

function doGet(e) {
  var game = (e && e.parameter && e.parameter.game) || 'fly';
  if (!GAMES[game]) return json_({ ok: false, error: 'bad game' });
  return json_({ ok: true, top: ranking_(game).slice(0, 10).map(publicRow_) });
}

function doPost(e) {
  var d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  var game = String(d.game || '');
  var name = String(d.name || '').replace(/\s+/g, ' ').trim().slice(0, 12);
  var phone = String(d.phone || '').replace(/\D/g, '');
  var score = Math.floor(Number(d.score));
  if (!GAMES[game]) return json_({ ok: false, error: 'bad game' });
  if (!name) return json_({ ok: false, error: 'name' });
  if (!/^[4-9]\d{7}$/.test(phone)) return json_({ ok: false, error: 'phone' });
  if (!(score >= 0 && score <= MAX_SCORE[game])) return json_({ ok: false, error: 'score' });
  // formula injection guard: names starting with = + - @ are stored as text
  if (/^[=+\-@]/.test(name)) name = "'" + name;

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet_().appendRow([new Date(), game, name, "'" + phone, score]);
  } finally {
    lock.releaseLock();
  }
  var list = ranking_(game);
  var rank = 0, best = score;
  for (var i = 0; i < list.length; i++) if (list[i].phone === phone) { rank = i + 1; best = list[i].score; break; }
  return json_({ ok: true, rank: rank, best: best, top: list.slice(0, 10).map(publicRow_) });
}

/** Best score per phone number, highest first (earlier time wins ties). */
function ranking_(game) {
  var values = sheet_().getDataRange().getValues();
  var bestBy = {};
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row[1] !== game) continue;
    var phone = String(row[3]).replace(/\D/g, '');
    var score = Number(row[4]);
    var t = row[0] instanceof Date ? row[0].getTime() : 0;
    var name = String(row[2]).replace(/^'/, '');
    var cur = bestBy[phone];
    if (!cur || score > cur.score) bestBy[phone] = { name: name, phone: phone, score: score, t: t };
  }
  var list = Object.keys(bestBy).map(function (k) { return bestBy[k]; });
  list.sort(function (a, b) { return b.score - a.score || a.t - b.t; });
  return list;
}

function publicRow_(r) { return { name: r.name, score: r.score }; }

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['時間', '遊戲', '暱稱', '手機', '分數']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
