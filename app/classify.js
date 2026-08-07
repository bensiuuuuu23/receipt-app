/* 分類設定 + 自動分類（供應商記憶 + 內建供應商對應表 + 關鍵字規則）—— 第一版不接 AI */

const CATEGORIES = [
  { id: 'labor',      name: '人工',     icon: '👨‍🍳', color: '#ffb648' },
  { id: 'food',       name: '食材',     icon: '🥬', color: '#3ddc84' },
  { id: 'kitchen',    name: '廚房小件', icon: '🍽', color: '#5aa9ff' },
  { id: 'transport',  name: '交通',     icon: '🚚', color: '#b58cff' },
  { id: 'consumable', name: '消耗品',   icon: '🧻', color: '#4dd0c0' },
  { id: 'misc',       name: '雜項',     icon: '📦', color: '#c0c7d0' },
  { id: 'utility',    name: '公用',     icon: '💡', color: '#ff8fa3' },
  { id: 'taobao',     name: '淘寶',     icon: '📮', color: '#ff7a45' },
  { id: 'other',      name: '其他',     icon: '➕', color: '#8a93a0' },
];

const CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
function catOf(id) { return CAT_MAP[id] || CAT_MAP['other']; }

/* 「人工」種類的員工名單（下拉選單用） */
const EMPLOYEES = ['李定妹', '鄭小貞', '余詠詩', '張曉東', '吳嘉雯', '陳幸兒', '張鳳娟', '馮曉彤', '張美玲'];

/* 內建供應商對應表：選了這些常用供應商就自動帶對應種類（仍可手動改） */
const DEFAULT_SUPPLIER_MAP = {
  // 食材
  '自購食材': 'food', '港聯': 'food', '唐順興': 'food', '潤富': 'food',
  // 廚房小件
  '李光記': 'kitchen', '陳枝記': 'kitchen', '恆盛': 'kitchen', '沈華記': 'kitchen', '光榮': 'kitchen',
  // 交通
  'GoGoVan': 'transport',
  // 消耗品
  '文具店': 'consumable', '藥房': 'consumable', 'JETCO': 'consumable', '供應易': 'consumable',
  // 雜項
  '惠康': 'misc', 'AEON': 'misc', '日本城': 'misc', '五金': 'misc',
  // 公用
  '水費': 'utility', '電費': 'utility', 'CSL': 'utility', 'HKT': 'utility',
  'STRATTON': 'utility', '洗衣': 'utility', '維修': 'utility',
};

/* 第一次遇到的新店：靠名字關鍵字猜分類（英文不分大小寫） */
const KEYWORD_RULES = [
  { cat: 'utility',    words: ['水費', '電費', '煤氣', '中電', '港燈', '電力', '洗衣', '冷氣', 'stratton'] },
  { cat: 'transport',  words: ['gogovan', 'van', '速遞', '速運', '運費', '的士', '快遞'] },
  { cat: 'taobao',     words: ['淘寶', 'taobao', '天貓', '1688'] },
  { cat: 'food',       words: ['食材', '蔬果', '菜', '肉', '凍肉', '海鮮', '魚', '雞', '豬', '牛', '米', '糧油', '食品', '街市', '農'] },
  { cat: 'consumable', words: ['文具', '藥房', '包裝', '耗材', '紙巾', '餐具'] },
  { cat: 'misc',       words: ['惠康', 'aeon', '日本城', '五金', '百貨'] },
];

function keywordGuess(supplier) {
  if (!supplier) return null;
  const s = supplier.trim().toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.words.some((w) => s.includes(w.toLowerCase()))) return rule.cat;
  }
  return null;
}

/*
 * 自動分類：
 * 1) 供應商記憶（以前把這家歸過某類）→ 直接用
 * 2) 內建常用供應商對應表
 * 3) 關鍵字猜
 * 4) 都猜不到 → null（讓使用者自己選）
 * suppliersMap：{ 供應商名稱: 分類id }
 */
function autoClassify(supplier, suppliersMap) {
  if (!supplier) return null;
  const key = supplier.trim();
  if (suppliersMap && suppliersMap[key]) return suppliersMap[key];
  if (DEFAULT_SUPPLIER_MAP[key]) return DEFAULT_SUPPLIER_MAP[key];
  return keywordGuess(key);
}
