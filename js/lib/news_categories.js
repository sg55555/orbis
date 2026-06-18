// ニュースカテゴリの定義（label/color）。news.js と selection.js で共用しimport cycleを避ける。
export const CATEGORY = {
  politics: { label: '政治・外交', color: [120, 170, 255] },
  conflict: { label: '紛争・安全保障', color: [255, 70, 90] },
  disaster: { label: '災害・事故', color: [255, 170, 60] },
  economy: { label: '経済・市場', color: [80, 220, 160] },
  society: { label: '社会', color: [200, 140, 255] },
  science: { label: '科学・技術', color: [90, 220, 255] },
  environment: { label: '環境', color: [150, 220, 90] },
  other: { label: 'その他', color: [180, 190, 205] },
};

export function categoryOf(key) {
  return CATEGORY[key] || CATEGORY.other;
}
