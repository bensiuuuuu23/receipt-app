/* OCR 模組 —— 用 Tesseract.js（首次掃描時才從 CDN 載入，省得拖慢開 App）
 * 注意：客戶端 OCR 對手寫單/模糊熱感紙準度有限，結果一律當「自動填好、待核對」。 */
const OCR = (() => {
  const CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  let loading = null;

  function loadLib() {
    if (window.Tesseract) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CDN;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('OCR 程式庫載入失敗（需要網路）'));
      document.head.appendChild(s);
    });
    return loading;
  }

  async function recognize(blobOrUrl, onProgress) {
    await loadLib();
    const { data } = await window.Tesseract.recognize(blobOrUrl, 'chi_tra+eng', {
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) onProgress(Math.round(m.progress * 100));
      },
    });
    return data.text || '';
  }

  // 從 OCR 文字盡量抽出 金額 / 日期 / 店名
  function parse(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    // ---- 金額 ----
    const TOTAL_HINT = /(總|合計|應收|實收|金額|TOTAL|AMOUNT|應付|HKD|\$)/i;
    const numRe = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
    const candidates = [];
    for (const line of lines) {
      const hinted = TOTAL_HINT.test(line);
      let m;
      numRe.lastIndex = 0;
      while ((m = numRe.exec(line))) {
        const val = parseFloat(m[0].replace(/,/g, ''));
        if (!isFinite(val) || val <= 0) continue;
        if (val > 1000000) continue;            // 太大，多半是電話/條碼
        if (/^(19|20)\d{2}$/.test(m[0]) && !hinted) continue; // 像年份
        candidates.push({ val, hinted, hasDecimal: !!m[2] });
      }
    }
    let amount = null;
    if (candidates.length) {
      const hintedOnes = candidates.filter((c) => c.hinted);
      const pool = hintedOnes.length ? hintedOnes : candidates;
      amount = pool.reduce((a, b) => (b.val > a.val ? b : a)).val; // 取最大（總額通常最大）
    }

    // ---- 日期 ----
    let date = null;
    const full = text;
    let dm = full.match(/(20\d{2}|19\d{2})[\-/.年](\d{1,2})[\-/.月](\d{1,2})/);
    if (dm) {
      date = iso(dm[1], dm[2], dm[3]);
    } else {
      dm = full.match(/(\d{1,2})[\-/.](\d{1,2})[\-/.](20\d{2}|19\d{2}|\d{2})/);
      if (dm) {
        let y = dm[3]; if (y.length === 2) y = '20' + y;
        date = iso(y, dm[2], dm[1]); // 假設 日/月/年（港式）
      }
    }

    // ---- 店名（盡力而為：第一行有中文、不是純數字的）----
    let supplier = null;
    for (const line of lines.slice(0, 5)) {
      const clean = line.replace(/[^一-龥A-Za-z0-9]/g, '');
      if (clean.length >= 2 && clean.length <= 20 && /[一-龥A-Za-z]/.test(clean) && !/^\d+$/.test(clean)) {
        supplier = line.replace(/\s{2,}/g, ' ').trim();
        break;
      }
    }

    return { amount, date, supplier };
  }

  function iso(y, m, d) {
    const mm = String(parseInt(m, 10)).padStart(2, '0');
    const dd = String(parseInt(d, 10)).padStart(2, '0');
    if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null;
    return `${y}-${mm}-${dd}`;
  }

  return { recognize, parse };
})();
