/* 雲端同步模組 —— 把單據送到自己的 Apps Script Web App（寫進 Google Sheet + Drive）
 * 網址與 token 只存在使用者本機（localStorage），不寫進公開程式碼。 */
const Sync = (() => {
  const KEY = 'receipt-sync-config';

  function getConfig() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function setConfig(url, token) {
    localStorage.setItem(KEY, JSON.stringify({ url: (url || '').trim(), token: (token || '').trim() }));
  }
  function isConfigured() {
    const c = getConfig();
    return !!(c.url && c.token);
  }

  async function post(payload) {
    const c = getConfig();
    if (!c.url) throw new Error('尚未設定同步網址');
    // 用 text/plain 送，避開瀏覽器 CORS 預檢（Apps Script Web App 的標準做法）
    const res = await fetch(c.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('回應看不懂（可能網址錯或未部署）：' + text.slice(0, 100)); }
    if (!data.ok) throw new Error(data.error || '同步失敗');
    return data;
  }

  function test() {
    return post({ token: getConfig().token, action: 'ping' });
  }

  // 同步一筆（含照片 base64）；receipt 需含 categoryName
  async function pushReceipt(receipt, photoBlob) {
    let photoBase64 = null, photoMime = null;
    if (photoBlob) {
      photoBase64 = await blobToBase64(photoBlob);
      photoMime = photoBlob.type || 'image/jpeg';
    }
    return post({ token: getConfig().token, action: 'upsert', receipt, photoBase64, photoMime });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]); // 去掉 data:...;base64, 前綴
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  return { getConfig, setConfig, isConfigured, test, pushReceipt };
})();
