/* 餐廳記帳 App —— 第一版（本機）主邏輯 */
(() => {
  'use strict';

  // ---- 狀態 ----
  let receipts = [];            // 全部單據（記憶體快取）
  let suppliersMap = {};        // { 供應商名稱: 分類id }
  let editingId = null;         // 正在編輯的單據 id（null = 新增）
  let selectedCat = null;       // 目前選的分類 id
  let manualCatOverride = false;// 使用者是否手動點過分類
  let pendingPhoto = null;      // 待存的照片 Blob（null = 沒有）
  let photoChanged = false;     // 這次編輯有沒有改動照片
  let photoURL = null;          // 預覽用的 object URL（記得 revoke）

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---- 小工具 ----
  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function todayISO() {
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  }
  function money(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function monthKey(iso) { return (iso || '').slice(0, 7); }
  // 合理的單據日期：不可未來、不早於約 2 年前（防 OCR 看錯年份）
  function plausibleDate(iso) {
    const t = todayISO();
    if (iso > t) return false;
    const past = new Date(); past.setFullYear(past.getFullYear() - 2);
    const off = past.getTimezoneOffset();
    const limit = new Date(past.getTime() - off * 60000).toISOString().slice(0, 10);
    return iso >= limit;
  }
  function fmtDayLabel(iso) {
    if (iso === todayISO()) return '今天';
    return iso;
  }

  // ---- 導覽 ----
  function show(screen) {
    $$('.screen').forEach((s) => { s.hidden = s.dataset.screen !== screen; });
    $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.go === screen));
  }

  // ---- 首頁 ----
  function renderHome() {
    const mk = monthKey(todayISO());
    const mine = receipts.filter((r) => monthKey(r.date) === mk);
    const total = mine.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    $('#homeMonthLabel').textContent = mk.replace('-', ' 年 ') + ' 月';
    $('#homeTotal').textContent = money(total);
    $('#homeCount').textContent = `共 ${mine.length} 張單據`;
    const recent = [...receipts].sort(byNewest).slice(0, 6);
    $('#homeRecent').innerHTML = recent.length
      ? recent.map(itemHTML).join('')
      : '<div class="empty">還沒有單據。<br>按右下角 ＋ 新增第一張。</div>';
    bindItemClicks('#homeRecent');
  }

  function byNewest(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  }

  function itemHTML(r) {
    const c = catOf(r.categoryId);
    const title = r.supplier || r.employee || c.name;
    const sub = `${c.name} · ${fmtDayLabel(r.date)}${r.employee ? ' · ' + r.employee : ''}${r.hasPhoto ? ' · 📎' : ''}`;
    return `<div class="item" data-id="${r.id}">
      <div class="dot" style="background:${hexA(c.color, .15)}">${c.icon}</div>
      <div class="mid"><div class="n">${esc(title)}</div><div class="s">${esc(sub)}</div></div>
      <div class="amt">${money(r.amount)}</div>
    </div>`;
  }

  function hexA(hex, a) {
    const m = hex.replace('#', '');
    const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---- 單據庫 ----
  function renderList() {
    $('#listCount').textContent = `共 ${receipts.length} 張`;
    if (!receipts.length) {
      $('#listAll').innerHTML = '<div class="empty">還沒有單據。<br>按右下角 ＋ 新增。</div>';
      return;
    }
    const sorted = [...receipts].sort(byNewest);
    let html = '';
    let curDay = null;
    for (const r of sorted) {
      if (r.date !== curDay) { curDay = r.date; html += `<div class="day-head">${fmtDayLabel(r.date)}</div>`; }
      html += itemHTML(r);
    }
    $('#listAll').innerHTML = html;
    bindItemClicks('#listAll');
  }

  function bindItemClicks(container) {
    $$(`${container} .item`).forEach((el) => {
      el.onclick = () => openAdd(el.dataset.id);
    });
  }

  // ---- 新增 / 編輯 ----
  function renderCatGrid() {
    $('#catGrid').innerHTML = CATEGORIES.map((c) =>
      `<div class="cat${selectedCat === c.id ? ' on' : ''}" data-cat="${c.id}">
        <span class="ico">${c.icon}</span>${esc(c.name)}</div>`).join('');
    $$('#catGrid .cat').forEach((el) => {
      el.onclick = () => { manualCatOverride = true; setCat(el.dataset.cat); };
    });
  }

  function setCat(id) {
    selectedCat = id;
    renderCatGrid();
    const labor = id === 'labor';
    $('#laborBox').hidden = !labor;
    $('#supplierBox').hidden = labor;
    $('#amountRow').hidden = labor; // 人工的金額用時薪×工時自動算
  }

  function computeLabor() {
    const w = parseFloat($('#fWage').value) || 0;
    const h = parseFloat($('#fHours').value) || 0;
    $('#laborTotal').textContent = money(w * h);
    return w * h;
  }

  function refreshSupplierList() {
    const names = Object.keys(suppliersMap).sort();
    $('#supplierList').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
  }

  function onSupplierInput() {
    const name = $('#fSupplier').value.trim();
    if (manualCatOverride) { updateSupplierHint(name); return; }
    const guess = autoClassify(name, suppliersMap);
    if (guess) setCat(guess);
    updateSupplierHint(name);
  }

  function updateSupplierHint(name) {
    const hint = $('#supplierHint');
    if (!name) { hint.textContent = ''; return; }
    if (suppliersMap[name]) hint.textContent = `記得這家 → ${catOf(suppliersMap[name]).name}`;
    else if (keywordGuess(name)) hint.textContent = `猜：${catOf(keywordGuess(name)).name}（可改）`;
    else hint.textContent = '新供應商，請選種類（下次會自動記住）';
  }

  // ---- 照片 / OCR ----
  function setPhotoPreview(blob) {
    if (photoURL) { URL.revokeObjectURL(photoURL); photoURL = null; }
    if (blob) {
      photoURL = URL.createObjectURL(blob);
      $('#photoImg').src = photoURL;
      $('#photoPreview').hidden = false;
    } else {
      $('#photoImg').removeAttribute('src');
      $('#photoPreview').hidden = true;
    }
  }

  function clearPhotoUI() {
    pendingPhoto = null;
    photoChanged = false;
    setPhotoPreview(null);
    $('#ocrStatus').textContent = '';
    $('#ocrStatus').classList.remove('err');
    $('#fileCamera').value = '';
    $('#fileAlbum').value = '';
  }

  // 壓縮：最長邊 1280、JPEG 0.7（省空間，也方便日後上傳 Drive）
  function compressImage(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const max = 1280;
        let { width: w, height: h } = img;
        if (w > max || h > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        cv.toBlob((b) => { URL.revokeObjectURL(img.src); resolve(b || file); }, 'image/jpeg', 0.7);
      };
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }

  async function onPhotoPicked(file, autoOCR) {
    if (!file) return;
    const blob = await compressImage(file);
    pendingPhoto = blob;
    photoChanged = true;
    setPhotoPreview(blob);
    if (autoOCR) runOCR(blob);
  }

  async function runOCR(blob) {
    const st = $('#ocrStatus');
    st.classList.remove('err');
    st.textContent = '辨識中… 0%（首次需下載辨識模組，請稍候）';
    try {
      const text = await OCR.recognize(blob, (p) => { st.textContent = `辨識中… ${p}%`; });
      const got = OCR.parse(text);
      let filled = [];
      let dateWarn = false;
      // 只填空欄位，不蓋掉使用者已打好的字
      if (got.amount && selectedCat !== 'labor' && !$('#fAmount').value) { $('#fAmount').value = got.amount; filled.push('金額'); }
      // 日期防呆：未來、或太舊（>2年）多半是看錯，改用今天
      if (got.date) {
        if (plausibleDate(got.date)) { $('#fDate').value = got.date; filled.push('日期'); }
        else dateWarn = true; // 保留今天（預設）
      }
      if (got.supplier && selectedCat !== 'labor' && !$('#fSupplier').value.trim()) {
        $('#fSupplier').value = got.supplier; onSupplierInput(); filled.push('店名');
      }
      let msg = filled.length ? `已自動填：${filled.join('、')} —— 請核對是否正確` : '讀不太到，請手動輸入';
      if (dateWarn) msg += '（日期看不準，已用今天，請改）';
      st.textContent = msg;
    } catch (err) {
      st.classList.add('err');
      st.textContent = String(err.message || err);
    }
  }

  async function openAdd(id) {
    editingId = id || null;
    manualCatOverride = false;
    clearPhotoUI();
    setMode('manual');
    const r = id ? receipts.find((x) => x.id === id) : null;

    $('#addTitle').textContent = r ? '編輯單據' : '新增單據';
    $('#btnDelete').hidden = !r;

    $('#fAmount').value = r && r.categoryId !== 'labor' ? r.amount : '';
    $('#fWage').value = r ? (r.wage ?? '') : '';
    $('#fHours').value = r ? (r.hours ?? '') : '';
    $('#fEmployee').value = r ? (r.employee ?? '') : '';
    $('#fSupplier').value = r ? (r.supplier ?? '') : '';
    $('#fNote').value = r ? (r.note ?? '') : '';
    $('#fDate').value = r ? r.date : todayISO();

    selectedCat = r ? r.categoryId : null;
    if (r) manualCatOverride = true; // 編輯時不自動覆蓋既有分類
    renderCatGrid();
    setCat(selectedCat || 'food');
    if (!r) { selectedCat = null; renderCatGrid(); $('#laborBox').hidden = true; $('#supplierBox').hidden = false; $('#amountRow').hidden = false; }
    computeLabor();
    refreshSupplierList();
    updateSupplierHint($('#fSupplier').value.trim());

    if (r && r.hasPhoto) {
      const p = await DB.get('photos', r.id);
      if (p && p.blob) { pendingPhoto = p.blob; photoChanged = false; setPhotoPreview(p.blob); }
    }

    show('add');
  }

  function setMode(mode) {
    $$('#modeSeg div').forEach((d) => d.classList.toggle('on', d.dataset.mode === mode));
  }

  async function save() {
    const labor = selectedCat === 'labor';
    if (!selectedCat) { alert('請先選種類'); return; }

    let amount;
    if (labor) {
      amount = computeLabor();
      if (amount <= 0) { alert('請輸入時薪和工作小時'); return; }
    } else {
      amount = Math.round((parseFloat($('#fAmount').value) || 0) * 100) / 100;
      if (amount <= 0) { alert('請輸入金額'); return; }
    }

    const supplier = labor ? '' : $('#fSupplier').value.trim();
    const employee = labor ? $('#fEmployee').value.trim() : '';

    const rec = {
      id: editingId || genId(),
      amount,
      categoryId: selectedCat,
      supplier,
      employee,
      wage: labor ? (parseFloat($('#fWage').value) || 0) : null,
      hours: labor ? (parseFloat($('#fHours').value) || 0) : null,
      date: $('#fDate').value || todayISO(),
      note: $('#fNote').value.trim(),
      hasPhoto: !!pendingPhoto,
      createdAt: editingId ? (receipts.find((x) => x.id === editingId)?.createdAt || Date.now()) : Date.now(),
      synced: false,
    };

    await DB.put('receipts', rec);
    // 照片：本機存放（將來第 2 步同步到 Google Drive）
    if (photoChanged) {
      if (pendingPhoto) await DB.put('photos', { receiptId: rec.id, blob: pendingPhoto });
      else await DB.remove('photos', rec.id);
    }
    // 供應商記憶：記住這家歸哪類
    if (supplier) { suppliersMap[supplier] = selectedCat; await DB.put('suppliers', { name: supplier, categoryId: selectedCat }); }

    await reload();
    show('list');
    renderList();
  }

  async function del() {
    if (!editingId) return;
    if (!confirm('確定刪除這張單據？')) return;
    await DB.remove('receipts', editingId);
    await DB.remove('photos', editingId);
    await reload();
    show('list');
    renderList();
  }

  // ---- 載入 ----
  async function reload() {
    receipts = await DB.getAll('receipts');
    const sup = await DB.getAll('suppliers');
    suppliersMap = Object.fromEntries(sup.map((s) => [s.name, s.categoryId]));
    renderHome();
  }

  // ---- 綁定 ----
  function bind() {
    $$('.tab').forEach((t) => {
      t.onclick = () => {
        const g = t.dataset.go;
        show(g);
        if (g === 'home') renderHome();
        if (g === 'list') renderList();
      };
    });
    $('#fab').onclick = () => openAdd(null);
    $('#addCancel').onclick = () => { clearPhotoUI(); show('home'); renderHome(); };

    // 模式切換：掃描 = 直接拍照
    $$('#modeSeg div').forEach((d) => {
      d.onclick = () => {
        setMode(d.dataset.mode);
        if (d.dataset.mode === 'scan') $('#fileCamera').click();
      };
    });
    // 拍照 / 選相
    $('#btnCamera').onclick = () => $('#fileCamera').click();
    $('#btnAlbum').onclick = () => $('#fileAlbum').click();
    $('#fileCamera').onchange = (e) => onPhotoPicked(e.target.files[0], true);
    $('#fileAlbum').onchange = (e) => onPhotoPicked(e.target.files[0], true);
    $('#btnRemovePhoto').onclick = () => {
      pendingPhoto = null; photoChanged = true; setPhotoPreview(null);
      $('#ocrStatus').textContent = ''; $('#fileCamera').value = ''; $('#fileAlbum').value = '';
    };
    $('#btnSave').onclick = save;
    $('#btnDelete').onclick = del;
    $('#fWage').oninput = computeLabor;
    $('#fHours').oninput = computeLabor;
    $('#fSupplier').oninput = onSupplierInput;
    $('#btnClearAll').onclick = async () => {
      if (!confirm('清空所有單據？此動作不可還原（雲端同步後會以雲端為準）。')) return;
      await DB.clear('receipts');
      await reload();
      renderList();
      alert('已清空');
    };
  }

  // ---- 啟動 ----
  (async function init() {
    await DB.open();
    bind();
    await reload();
    show('home');
  })();
})();
