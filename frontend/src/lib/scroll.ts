export type RevealBoxMetrics = {
  /** 确认区在滚动容器内容坐标系里的顶部位置（等于可视区偏移 + 当前 scrollTop）。 */
  boxTop: number;
  boxHeight: number;
  /** 容器可见高度（clientHeight）。 */
  viewHeight: number;
  /** 容器最大可滚动距离（scrollHeight - clientHeight）。 */
  maxTop: number;
  /** 容器当前滚动位置。 */
  currentTop: number;
  /** 与可视区边缘保留的间距。 */
  margin?: number;
};

export type RevealBoxResult = {
  /** 建议的滚动位置；`changed` 为 false 时保持原样即可。 */
  scrollTop: number;
  changed: boolean;
};

/**
 * 计算把内联确认区滚进可视区所需的位置。
 *
 * 详情抽屉内容较长（或屏幕较矮）时，确认区会追加在可视区下方，点击「标记不采纳」等按钮后
 * 看起来毫无反应。规则：
 * - 确认区已经完整可见 → 不滚动，避免无谓跳动；
 * - 确认区比可视区还高 → 对齐顶部，先露出标题与第一个输入项；
 * - 其余情况 → 让确认区底部刚好露出在可视区底部，滚动量最小。
 * 结果始终夹在 [0, maxTop] 内，不会破坏容器的滚动范围。
 */
export function revealScrollTop({ boxTop, boxHeight, viewHeight, maxTop, currentTop, margin = 12 }: RevealBoxMetrics): RevealBoxResult {
  const safeMargin = Math.max(0, margin);
  const visibleTop = boxTop - currentTop;
  const visibleBottom = visibleTop + boxHeight;
  const alreadyVisible = visibleTop >= safeMargin && visibleBottom <= viewHeight - safeMargin;
  if (alreadyVisible) return { scrollTop: currentTop, changed: false };
  const target = boxHeight + safeMargin * 2 > viewHeight
    ? boxTop - safeMargin
    : boxTop + boxHeight - viewHeight + safeMargin;
  const clamped = Math.min(Math.max(target, 0), Math.max(0, maxTop));
  return { scrollTop: clamped, changed: Math.abs(clamped - currentTop) > 0.5 };
}
