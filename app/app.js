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
  let batchDrafts = [];         // 批次入單的草稿列
  const ocrQueue = [];          // 待辨識的草稿 id 佇列
  let ocrBusy = false;          // 批次 OCR 是否正在跑

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

  // ---- 結算（日/月/年）----
  let sumMode = 'month';
  let sumAnchor = todayISO();

  function periodRange(mode, anchor) {
    const y = anchor.slice(0, 4), ym = anchor.slice(0, 7);
    if (mode === 'day') return { start: anchor, end: anchor, label: anchor === todayISO() ? `今天（${anchor}）` : anchor };
    if (mode === 'year') return { start: `${y}-01-01`, end: `${y}-12-31`, label: `${y} 年` };
    return { start: `${ym}-01`, end: `${ym}-31`, label: `${ym.slice(0, 4)} 年 ${ym.slice(5, 7)} 月` };
  }

  function shiftAnchor(delta) {
    const d = new Date(sumAnchor + 'T00:00:00');
    if (sumMode === 'day') d.setDate(d.getDate() + delta);
    else if (sumMode === 'year') d.setFullYear(d.getFullYear() + delta);
    else d.setMonth(d.getMonth() + delta);
    const off = d.getTimezoneOffset();
    sumAnchor = new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  }

  function renderSummary() {
    $$('#sumSeg div').forEach((el) => el.classList.toggle('on', el.dataset.m === sumMode));
    const { start, end, label } = periodRange(sumMode, sumAnchor);
    $('#sumLabel').textContent = label;
    const mine = receipts.filter((r) => r.date >= start && r.date <= end);
    const total = mine.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    $('#sumTotal').textContent = money(total);
    $('#sumCount').textContent = `共 ${mine.length} 張`;

    if (!mine.length) { $('#sumBreakdown').innerHTML = '<div class="empty">這段期間沒有單據。</div>'; return; }
    const byCat = {};
    for (const r of mine) byCat[r.categoryId] = (byCat[r.categoryId] || 0) + (Number(r.amount) || 0);
    const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    $('#sumBreakdown').innerHTML = rows.map(([cid, val]) => {
      const c = catOf(cid);
      const pct = total ? Math.round((val / total) * 100) : 0;
      return `<div class="sbar">
        <span class="lab">${c.icon} ${esc(c.name)}</span>
        <span class="track"><span class="fill" style="width:${pct}%;background:${c.color}"></span></span>
        <span class="val">${money(val)}</span><span class="pct">${pct}%</span>
      </div>`;
    }).join('');
  }

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
    // 選了種類才更新「這個種類的供應商」清單與提示
    if (!labor) { refreshSupplierList(); updateSupplierHint($('#fSupplier').value.trim()); }
  }

  function computeLabor() {
    const w = parseFloat($('#fWage').value) || 0;
    const h = parseFloat($('#fHours').value) || 0;
    $('#laborTotal').textContent = money(w * h);
    return w * h;
  }

  // 某種類底下的供應商（內建 + 使用者記過的）
  function suppliersForCat(catId) {
    if (!catId) return [];
    const set = new Set();
    for (const [name, cid] of Object.entries(DEFAULT_SUPPLIER_MAP)) if (cid === catId) set.add(name);
    for (const [name, cid] of Object.entries(suppliersMap)) if (cid === catId) set.add(name);
    return Array.from(set).sort();
  }

  // 供應商自動補全清單：只列出目前所選種類的供應商
  function refreshSupplierList() {
    const names = suppliersForCat(selectedCat);
    $('#supplierList').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
  }

  // 拍照 OCR 用：整段文字裡若出現已知供應商名（記過的優先、長名優先）就命中
  function matchKnownSupplier(text) {
    if (!text) return null;
    const t = text.replace(/\s+/g, '').toLowerCase();
    const entries = [...Object.entries(suppliersMap), ...Object.entries(DEFAULT_SUPPLIER_MAP)];
    entries.sort((a, b) => b[0].length - a[0].length); // 長名優先，避免短名誤中
    for (const [name, cat] of entries) {
      const n = name.replace(/\s+/g, '').toLowerCase();
      if (n.length >= 2 && t.includes(n)) return { supplier: name, cat };
    }
    return null;
  }

  function onSupplierInput() {
    // 種類先選，供應商不再回頭改種類，只更新提示
    updateSupplierHint($('#fSupplier').value.trim());
  }

  function updateSupplierHint(name) {
    const hint = $('#supplierHint');
    if (!selectedCat || selectedCat === 'labor') { hint.textContent = ''; return; }
    const known = suppliersForCat(selectedCat);
    if (!name) { hint.textContent = known.length ? '選擇或輸入供應商' : '輸入供應商（會記住這類）'; return; }
    if (known.includes(name)) hint.textContent = '';
    else hint.textContent = `新供應商，會記到「${catOf(selectedCat).name}」`;
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

      // 認名字：OCR 文字裡若出現已知供應商 → 自動選種類 + 填供應商
      const known = matchKnownSupplier(text);
      if (known && !manualCatOverride && selectedCat !== 'labor') {
        setCat(known.cat); // 展開供應商/金額欄、篩該類供應商
        if (!$('#fSupplier').value.trim()) { $('#fSupplier').value = known.supplier; onSupplierInput(); }
        filled.push(`種類（${catOf(known.cat).name}）`, `供應商（${known.supplier}）`);
      }

      // 只填空欄位，不蓋掉使用者已打好的字
      if (got.amount && selectedCat !== 'labor' && !$('#fAmount').value) { $('#fAmount').value = got.amount; filled.push('金額'); }
      // 日期防呆：未來、或太舊（>2年）多半是看錯，改用今天
      if (got.date) {
        if (plausibleDate(got.date)) { $('#fDate').value = got.date; filled.push('日期'); }
        else dateWarn = true; // 保留今天（預設）
      }
      // 沒認到已知供應商、但有選過種類 → 用 OCR 猜的店名填（標明是「猜」）
      if (!known && got.supplier && selectedCat && selectedCat !== 'labor' && !$('#fSupplier').value.trim()) {
        $('#fSupplier').value = got.supplier; onSupplierInput(); filled.push('店名（猜，請核對）');
      }

      let msg = filled.length ? `已自動填：${filled.join('、')} —— 請核對是否正確` : '讀不太到，請手動選種類';
      if (!selectedCat) msg += '（金額已幫你記著，請先選種類就會顯示）';
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
    if (!r) { selectedCat = null; renderCatGrid(); $('#laborBox').hidden = true; $('#supplierBox').hidden = true; $('#amountRow').hidden = true; }
    computeLabor();
    refreshSupplierList();
    updateSupplierHint($('#fSupplier').value.trim());

    if (r && r.hasPhoto) {
      const p = await DB.get('photos', r.id);
      if (p && p.blob) { pendingPhoto = p.blob; photoChanged = false; setPhotoPreview(p.blob); }
      else if (r.photoUrl) { $('#ocrStatus').innerHTML = `📎 這張照片在雲端：<a href="${esc(r.photoUrl)}" target="_blank" rel="noopener" style="color:var(--accent)">在 Drive 開啟</a>`; }
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
    const existing = editingId ? receipts.find((x) => x.id === editingId) : null;
    // 照片旗標：有新照片=有；按過移除=無；沒動過=沿用原本（保住雲端下載回來的照片連結）
    const hasPhoto = pendingPhoto ? true : (photoChanged ? false : !!(existing && existing.hasPhoto));

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
      hasPhoto,
      photoUrl: (existing && existing.photoUrl) || '',
      createdAt: editingId ? (existing?.createdAt || Date.now()) : Date.now(),
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
    syncNow();
  }

  async function del() {
    if (!editingId) return;
    if (!confirm('確定刪除這張單據？')) return;
    // 軟刪除（墓碑）：標記已刪 + 待同步，這樣刪除才能同步到其他裝置
    const rec = (receipts.find((x) => x.id === editingId)) || (await DB.get('receipts', editingId));
    if (rec) { rec.deleted = true; rec.synced = false; await DB.put('receipts', rec); }
    await DB.remove('photos', editingId); // 本機照片可清（雲端保留連結）
    await reload();
    show('list');
    renderList();
    syncNow();
  }

  // ---- 批次入單 ----
  function openBatch() {
    clearBatch();
    renderBatch();
    show('batch');
  }

  function clearBatch() {
    for (const d of batchDrafts) if (d.thumbURL) URL.revokeObjectURL(d.thumbURL);
    batchDrafts = [];
    ocrQueue.length = 0;
  }

  // 批次種類下拉（不含「人工」，人工用時薪×工時另記）
  function batchCatOptions(selected) {
    const opts = ['<option value="">種類…</option>'];
    for (const c of CATEGORIES) {
      if (c.id === 'labor') continue;
      opts.push(`<option value="${c.id}"${selected === c.id ? ' selected' : ''}>${c.icon} ${esc(c.name)}</option>`);
    }
    return opts.join('');
  }

  function supplierOptionsFor(catId) {
    return suppliersForCat(catId).map((n) => `<option value="${esc(n)}">`).join('');
  }

  function draftRowHTML(d) {
    const supListId = 'supList-' + d.id;
    const stCls = d.status === 'done' ? ' done' : d.status === 'err' ? ' err' : '';
    return `<div class="draft" data-id="${d.id}">
      <div class="draft-top">
        <div class="draft-thumb"><img src="${d.thumbURL}" alt=""></div>
        <select class="draft-cat">${batchCatOptions(d.categoryId)}</select>
        <button class="draft-del" title="刪除">🗑</button>
      </div>
      <div class="draft-row2">
        <input class="text-input draft-sup" list="${supListId}" placeholder="供應商" value="${esc(d.supplier)}">
        <datalist id="${supListId}">${supplierOptionsFor(d.categoryId)}</datalist>
        <input class="text-input draft-amt" inputmode="decimal" placeholder="金額" value="${esc(d.amount)}">
      </div>
      <div class="draft-status${stCls}">${esc(d.statusText)}</div>
    </div>`;
  }

  function wireBatchRow(el) {
    const d = batchDrafts.find((x) => x.id === el.dataset.id);
    if (!d) return;
    const catSel = el.querySelector('.draft-cat');
    const supInp = el.querySelector('.draft-sup');
    const amtInp = el.querySelector('.draft-amt');
    catSel.onchange = () => {
      d.categoryId = catSel.value;
      el.querySelector('datalist').innerHTML = supplierOptionsFor(d.categoryId);
      el.classList.remove('invalid');
    };
    supInp.oninput = () => { d.supplier = supInp.value; };
    amtInp.oninput = () => { d.amount = amtInp.value; el.classList.remove('invalid'); };
    el.querySelector('.draft-del').onclick = () => removeDraft(d.id);
  }

  function renderBatch() {
    $('#batchCount').textContent = batchDrafts.length ? `共 ${batchDrafts.length} 張` : '';
    const list = $('#batchList');
    if (!batchDrafts.length) {
      list.innerHTML = '<div class="empty">還沒有相片。<br>按上面「連拍」或「多選」加入單據。</div>';
      $('#btnBatchSaveAll').hidden = true;
      return;
    }
    list.innerHTML = batchDrafts.map(draftRowHTML).join('');
    $$('#batchList .draft').forEach(wireBatchRow);
    $('#btnBatchSaveAll').hidden = false;
    $('#btnBatchSaveAll').textContent = `✓ 全部儲存（${batchDrafts.length} 張）`;
  }

  // 只更新某一列的值與狀態（不重建整張清單，避免打斷其他列打字）
  function refreshDraftRow(d) {
    const el = $(`#batchList .draft[data-id="${d.id}"]`);
    if (!el) return;
    const catSel = el.querySelector('.draft-cat');
    const supInp = el.querySelector('.draft-sup');
    const amtInp = el.querySelector('.draft-amt');
    if (!catSel.value && d.categoryId) {
      catSel.value = d.categoryId;
      el.querySelector('datalist').innerHTML = supplierOptionsFor(d.categoryId);
    }
    if (!supInp.value && d.supplier) supInp.value = d.supplier;
    if (!amtInp.value && d.amount) amtInp.value = d.amount;
    const stEl = el.querySelector('.draft-status');
    stEl.textContent = d.statusText;
    stEl.className = 'draft-status' + (d.status === 'done' ? ' done' : d.status === 'err' ? ' err' : '');
  }

  function removeDraft(id) {
    const i = batchDrafts.findIndex((x) => x.id === id);
    if (i < 0) return;
    if (batchDrafts[i].thumbURL) URL.revokeObjectURL(batchDrafts[i].thumbURL);
    batchDrafts.splice(i, 1);
    renderBatch();
  }

  async function addBatchPhotos(files) {
    const incoming = Array.from(files || []);
    if (!incoming.length) return;
    const room = 20 - batchDrafts.length;
    if (room <= 0) { alert('最多 20 張，請先儲存或刪掉一些'); return; }
    if (incoming.length > room) { alert(`最多 20 張，這次只加前 ${room} 張`); incoming.length = room; }

    const list = $('#batchList');
    if (list.querySelector('.empty')) list.innerHTML = '';
    for (const f of incoming) {
      const blob = await compressImage(f);
      const d = {
        id: genId(), blob, thumbURL: URL.createObjectURL(blob),
        categoryId: '', supplier: '', amount: '', date: todayISO(),
        status: 'queued', statusText: '排隊辨識中…',
      };
      batchDrafts.push(d);
      ocrQueue.push(d.id);
      list.insertAdjacentHTML('beforeend', draftRowHTML(d));
      wireBatchRow(list.querySelector(`.draft[data-id="${d.id}"]`));
    }
    $('#batchCount').textContent = `共 ${batchDrafts.length} 張`;
    $('#btnBatchSaveAll').hidden = false;
    $('#btnBatchSaveAll').textContent = `✓ 全部儲存（${batchDrafts.length} 張）`;
    runBatchOCR();
  }

  // 逐張辨識（Tesseract 慢，排隊一張一張跑，不阻塞使用者編輯）
  async function runBatchOCR() {
    if (ocrBusy) return;
    ocrBusy = true;
    while (ocrQueue.length) {
      const id = ocrQueue.shift();
      const d = batchDrafts.find((x) => x.id === id);
      if (!d) continue;
      d.status = 'ocr'; d.statusText = '辨識中…';
      refreshDraftRow(d);
      try {
        const text = await OCR.recognize(d.blob);
        const got = OCR.parse(text);
        const known = matchKnownSupplier(text);
        if (known && !d.categoryId) { d.categoryId = known.cat; if (!d.supplier) d.supplier = known.supplier; }
        if (got.amount && d.amount === '') d.amount = String(got.amount);
        if (got.date && plausibleDate(got.date)) d.date = got.date;
        if (!known && got.supplier && !d.supplier && d.categoryId) d.supplier = got.supplier;
        d.status = 'done';
        d.statusText = d.categoryId ? '✓ 已辨識，請核對'
          : d.amount ? '只讀到金額，請選種類'
          : '讀不太到，請自己選種類/填金額';
      } catch (err) {
        d.status = 'err'; d.statusText = '辨識失敗，請手動填';
      }
      refreshDraftRow(d);
    }
    ocrBusy = false;
  }

  async function saveAllBatch() {
    if (!batchDrafts.length) return;
    const invalid = [];
    for (const d of batchDrafts) {
      const amt = Math.round((parseFloat(d.amount) || 0) * 100) / 100;
      if (!d.categoryId || amt <= 0) invalid.push(d.id);
    }
    if (invalid.length) {
      $$('#batchList .draft').forEach((el) => el.classList.toggle('invalid', invalid.includes(el.dataset.id)));
      alert(`有 ${invalid.length} 張未填「種類」或「金額」（已用紅框標出），請補齊或刪掉再存。`);
      return;
    }
    const toSave = [...batchDrafts];
    for (let i = 0; i < toSave.length; i++) {
      const d = toSave[i];
      const amount = Math.round((parseFloat(d.amount) || 0) * 100) / 100;
      const supplier = (d.supplier || '').trim();
      const rec = {
        id: genId(), amount, categoryId: d.categoryId, supplier, employee: '',
        wage: null, hours: null,
        date: (d.date && plausibleDate(d.date)) ? d.date : todayISO(),
        note: '', hasPhoto: !!d.blob, createdAt: Date.now() + i, synced: false,
      };
      await DB.put('receipts', rec);
      if (d.blob) await DB.put('photos', { receiptId: rec.id, blob: d.blob });
      if (supplier) { suppliersMap[supplier] = d.categoryId; await DB.put('suppliers', { name: supplier, categoryId: d.categoryId }); }
    }
    const n = toSave.length;
    clearBatch();
    await reload();
    show('list');
    renderList();
    syncNow();
    alert(`已儲存 ${n} 張`);
  }

  // ---- 雲端同步 ----
  let syncing = false;

  function updateSyncStatus(text) { const el = $('#syncStatus'); if (el) el.textContent = text; }

  function updateSyncState() {
    const el = $('#syncState'); if (!el) return;
    if (!Sync.isConfigured()) { el.textContent = '尚未設定（照教學建好 Apps Script，把網址和 Token 貼下面）'; return; }
    const pending = receipts.filter((r) => !r.synced).length;
    el.textContent = pending ? `已設定 · 尚有 ${pending} 筆待上傳` : '已設定 · 全部已同步 ✓';
  }

  function nameToCatId(name) { const c = CATEGORIES.find((x) => x.name === name); return c ? c.id : null; }

  // 雲端一筆 → 本機單據格式
  function srvToRec(s) {
    return {
      id: String(s.id), amount: Number(s.amount) || 0,
      categoryId: s.categoryId || nameToCatId(s.categoryName) || 'other',
      supplier: s.supplier || '', employee: s.employee || '', wage: null, hours: null,
      date: s.date || todayISO(), note: s.note || '',
      hasPhoto: !!s.photoUrl, photoUrl: s.photoUrl || '',
      createdAt: Number(s.createdAt) || Date.now(), synced: true,
    };
  }

  // 雙向同步：先把本機未同步的（含刪除記號）上傳，再把雲端全部抓回合併
  async function syncNow(manual) {
    if (syncing) return;
    if (!Sync.isConfigured()) { if (manual) updateSyncStatus('請先填網址與 Token 並儲存'); return; }
    if (!navigator.onLine) { if (manual) updateSyncStatus('目前離線，等有網再同步'); return; }
    syncing = true;
    let done = 0, fail = 0, pulled = 0, removed = 0;
    try {
      // 1) 上傳
      const all = await DB.getAll('receipts');
      const pending = all.filter((r) => !r.synced);
      if (pending.length) updateSyncStatus(`上傳中… 0/${pending.length}`);
      for (const r of pending) {
        try {
          let blob = null;
          if (r.hasPhoto && !r.deleted) { const p = await DB.get('photos', r.id); blob = p && p.blob; }
          await Sync.pushReceipt({ ...r, categoryName: catOf(r.categoryId).name }, blob);
          r.synced = true;
          await DB.put('receipts', r);
          done++;
        } catch (e) { fail++; }
        updateSyncStatus(`上傳中… ${done + fail}/${pending.length}${fail ? `（失敗 ${fail}）` : ''}`);
      }
      // 2) 下載合併
      updateSyncStatus('下載中…');
      const res = await Sync.pull();
      const server = (res && res.receipts) || [];
      for (const s of server) {
        const local = await DB.get('receipts', String(s.id));
        if (s.deleted) {
          // 雲端已刪 → 本機也移除（除非本機有未上傳的更動）
          if (local && local.synced !== false) { await DB.remove('receipts', String(s.id)); await DB.remove('photos', String(s.id)); removed++; }
          continue;
        }
        if (!local) { await DB.put('receipts', srvToRec(s)); pulled++; }
        else if (local.synced) { await DB.put('receipts', srvToRec(s)); pulled++; } // 本機無待傳更動 → 以雲端為準
        // else：本機有未上傳更動 → 保留本機，下次上傳
      }
    } catch (e) {
      syncing = false;
      updateSyncStatus('同步中斷：' + (e.message || e));
      return;
    }
    await reload();
    renderList();
    syncing = false;
    const bits = [];
    if (pulled) bits.push(`下載 ${pulled}`);
    if (removed) bits.push(`移除 ${removed}`);
    if (fail) bits.push(`${fail} 筆上傳失敗`);
    updateSyncStatus((fail ? '完成（部分失敗，稍後再試）' : '同步完成 ✓') + (bits.length ? `（${bits.join('、')}）` : ''));
    updateSyncState();
  }

  // ---- 載入 ----
  async function reload() {
    const all = await DB.getAll('receipts');
    receipts = all.filter((r) => !r.deleted); // 已刪除的墓碑不顯示（仍留 DB 等同步）
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
        if (g === 'summary') renderSummary();
        if (g === 'settings') updateSyncState();
      };
    });
    $$('#sumSeg div').forEach((el) => {
      el.onclick = () => { sumMode = el.dataset.m; sumAnchor = todayISO(); renderSummary(); };
    });
    $('#sumPrev').onclick = () => { shiftAnchor(-1); renderSummary(); };
    $('#sumNext').onclick = () => { shiftAnchor(1); renderSummary(); };
    $('#fab').onclick = () => openAdd(null);
    $('#addCancel').onclick = () => { clearPhotoUI(); show('home'); renderHome(); };

    // 批次入單
    $('#btnBatch').onclick = () => { clearPhotoUI(); openBatch(); };
    $('#batchCancel').onclick = () => { clearBatch(); show('home'); renderHome(); };
    $('#btnBatchCam').onclick = () => $('#fileBatchCam').click();
    $('#btnBatchAlbum').onclick = () => $('#fileBatchAlbum').click();
    $('#fileBatchCam').onchange = (e) => { addBatchPhotos(e.target.files); e.target.value = ''; };
    $('#fileBatchAlbum').onchange = (e) => { addBatchPhotos(e.target.files); e.target.value = ''; };
    $('#btnBatchSaveAll').onclick = saveAllBatch;

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
    // 雲端同步設定
    const cfg = Sync.getConfig();
    $('#fSyncUrl').value = cfg.url || '';
    $('#fSyncToken').value = cfg.token || '';
    updateSyncState();
    $('#btnSyncSave').onclick = () => {
      Sync.setConfig($('#fSyncUrl').value, $('#fSyncToken').value);
      updateSyncState();
      updateSyncStatus('已儲存，開始同步…');
      syncNow(true);
    };
    $('#btnSyncTest').onclick = async () => {
      Sync.setConfig($('#fSyncUrl').value, $('#fSyncToken').value); // 先存目前輸入再測
      updateSyncStatus('測試中…');
      try { await Sync.test(); updateSyncStatus('✓ 連線成功，可以儲存了'); updateSyncState(); }
      catch (err) { updateSyncStatus('✗ ' + (err.message || err)); }
    };
    $('#btnSyncNow').onclick = () => syncNow(true);
    window.addEventListener('online', () => syncNow());

    $('#btnClearAll').onclick = async () => {
      if (!confirm('清空所有單據、照片與供應商記憶？此動作不可還原（雲端同步後會以雲端為準）。')) return;
      await DB.clear('receipts');
      await DB.clear('photos');
      await DB.clear('suppliers');
      await reload();
      renderList();
      alert('已清空，可從新種類重新開始');
    };
  }

  // ---- 啟動 ----
  (async function init() {
    await DB.open();
    bind();
    await reload();
    show('home');
    updateSyncState();
    syncNow(); // 開 App 就把上次沒傳完的補傳
  })();
})();
