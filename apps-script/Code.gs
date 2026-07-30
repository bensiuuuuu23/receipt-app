/**
 * 餐廳記帳 App —— Google Sheet / Drive 同步收件員（Apps Script Web App）
 *
 * 部署方式看同資料夾的「設定教學.md」。
 * 重點：把下面 TOKEN 改成你自己的一串密碼，App 設定頁要填一模一樣的。
 */

const TOKEN = '改成你自己的密碼_例如_haohuang2026';   // ← 一定要改！跟 App 設定頁填的要相同
const SHEET_NAME = '單據';                              // 資料寫進哪個分頁（沒有會自動建）
const PHOTO_FOLDER = '餐廳記帳-單據照片';                // 照片放哪個 Drive 資料夾（沒有會自動建）

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.token !== TOKEN) return json({ ok: false, error: 'token 不對' });

    if (body.action === 'ping') return json({ ok: true, pong: true });

    if (body.action === 'upsert') {
      const r = body.receipt || {};
      let photoUrl = '';
      if (body.photoBase64) {
        photoUrl = savePhoto(r.id, body.photoBase64, body.photoMime || 'image/jpeg');
      }
      upsertRow(r, photoUrl);
      return json({ ok: true, id: r.id, photoUrl: photoUrl });
    }

    return json({ ok: false, error: '未知 action：' + body.action });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// 讓你用瀏覽器直接開網址時，能看到「服務正常」
function doGet() {
  return json({ ok: true, service: '餐廳記帳同步', time: new Date().toISOString() });
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['id', '日期', '種類', '供應商', '金額', '員工', '備註', '照片連結', '建立時間', '同步時間']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// 依 id 更新或新增一列（同一張單多次同步不會重複）
function upsertRow(r, photoUrl) {
  const sh = getSheet();
  const last = sh.getLastRow();
  const ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (x) { return String(x[0]); }) : [];
  const row = [
    r.id, r.date || '', r.categoryName || r.categoryId || '', r.supplier || '',
    Number(r.amount) || 0, r.employee || '', r.note || '', photoUrl || '', r.createdAt || '', new Date(),
  ];
  const idx = ids.indexOf(String(r.id));
  if (idx >= 0) {
    const rowNum = idx + 2;
    // 這次沒帶新照片就保留原本的照片連結
    if (!photoUrl) row[7] = sh.getRange(rowNum, 8).getValue();
    sh.getRange(rowNum, 1, 1, row.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
}

// 照片存到 Drive，回傳可看連結（同一張單重存會覆蓋舊檔）
function savePhoto(id, b64, mime) {
  const folder = getFolder();
  const bytes = Utilities.base64Decode(b64);
  const ext = mime.indexOf('png') >= 0 ? 'png' : 'jpg';
  const name = id + '.' + ext;
  const existing = folder.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);
  const file = folder.createFile(Utilities.newBlob(bytes, mime, name));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function getFolder() {
  const it = DriveApp.getFoldersByName(PHOTO_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
