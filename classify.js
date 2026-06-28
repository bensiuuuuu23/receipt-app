/* 分類設定 + 自動分類（供應商記憶 + 關鍵字規則）—— 第一版不接 AI */

const CATEGORIES = [
  { id: 'food',      name: '食材入貨', icon: '🥬', color: '#3ddc84' },
  { id: 'drink',     name: '飲料酒水', icon: '🍶', color: '#5aa9ff' },
  { id: 'labor',     name: '人工',     icon: '👨‍🍳', color: '#ffb648' },
  { id: 'rent',      name: '租金',     icon: '🏠', color: '#b58cff' },
  { id: 'utility',   name: '水電煤',   icon: '💡', color: '#ff8fa3' },
  { id: 'equipment', name: '設備維修', icon: '🔧', color: '#ff6b6b' },
  { id: 'supplies',  name: '清潔耗材', icon: '🧻', color: '#4dd0c0' },
  { id: 'other',     name: '其他',     icon: '📦', color: '#c0c7d0' },
];

const CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
function catOf(id) { return CAT_MAP[id] || CAT_MAP['other']; }

/* 第一次遇到的新店：靠名字關鍵字猜分類 */
const KEYWORD_RULES = [
  { cat: 'utility',  words: ['電力', '中電', '港燈', '電燈', '水務', '煤氣', '中華煤氣', '能源'] },
  { cat: 'food',     words: ['蔬果', '菜', '肉', '凍肉', '海鮮', '魚', '雞', '豬', '牛', '米', '糧油', '食品', '食材', '街市', '農'] },
  { cat: 'drink',    words: ['可樂', '汽水', '飲', '酒', '啤', '茶', '咖啡', '果汁', '礦泉', '水店'] },
  { cat: 'rent',     words: ['租', '物業', '地產', '業主'] },
  { cat: 'supplies', words: ['清潔', '紙巾', '餐具', '包裝', '膠', '碗', '杯', '盒', '耗材', '百貨'] },
  { cat: 'equipment',words: ['維修', '冷氣', '電器', '工程', '五金', '爐', '雪櫃', '機'] },
];

function keywordGuess(supplier) {
  if (!supplier) return null;
  const s = supplier.trim();
  for (const rule of KEYWORD_RULES) {
    if (rule.words.some((w) => s.includes(w))) return rule.cat;
  }
  return null;
}

/*
 * 自動分類：
 * 1) 供應商記憶（以前把這家歸過某類）→ 直接用
 * 2) 關鍵字猜
 * 3) 都猜不到 → null（讓使用者自己選）
 * suppliersMap：{ 供應商名稱: 分類id }
 */
function autoClassify(supplier, suppliersMap) {
  if (!supplier) return null;
  const key = supplier.trim();
  if (suppliersMap && suppliersMap[key]) return suppliersMap[key];
  return keywordGuess(key);
}
