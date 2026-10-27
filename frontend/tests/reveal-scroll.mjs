import assert from "node:assert/strict";
import { revealScrollTop } from "../src/lib/scroll.ts";

// 「标记不采纳」等按钮展开的确认区追加在详情内容末尾。
// 窗口高度较低时确认区落在可视区下方，点击后看不出任何变化；
// 下面的用例锁定「滚到能看全确认区」的规则。

// 1) 矮屏 + 内容很长：确认区在可视区下方 → 让确认区底部刚好露出在可视区底部。
const shortScreen = revealScrollTop({ boxTop: 900, boxHeight: 230, viewHeight: 400, maxTop: 1000, currentTop: 0 });
assert.equal(shortScreen.changed, true, "看不见的确认区必须滚动");
assert.equal(shortScreen.scrollTop, 742, "滚动量最小：确认区底部距可视区底部留 12px");
assert.equal(900 + 230 - shortScreen.scrollTop, 400 - 12, "确认区整体进入可视区");

// 2) 窗口足够高、确认区本来就完整可见 → 不做任何跳动。
const tallScreen = revealScrollTop({ boxTop: 100, boxHeight: 230, viewHeight: 700, maxTop: 400, currentTop: 0 });
assert.equal(tallScreen.changed, false);
assert.equal(tallScreen.scrollTop, 0);

// 3) 只露出一半也算看不见：仍然要滚到完整可见。
const partial = revealScrollTop({ boxTop: 500, boxHeight: 230, viewHeight: 600, maxTop: 800, currentTop: 0 });
assert.equal(partial.changed, true);
assert.equal(500 + 230 - partial.scrollTop, 600 - 12);

// 4) 确认区比可视区还高（矮窗口 + 带说明的确认表单）→ 对齐顶部，先露出标题和输入框。
const tallerThanViewport = revealScrollTop({ boxTop: 900, boxHeight: 500, viewHeight: 400, maxTop: 1000, currentTop: 0 });
assert.equal(tallerThanViewport.changed, true);
assert.equal(tallerThanViewport.scrollTop, 888, "顶部保留 12px 间距");

// 5) 内容已经滚到底，目标位置不能超出可滚动范围。
const atBottom = revealScrollTop({ boxTop: 1380, boxHeight: 230, viewHeight: 400, maxTop: 700, currentTop: 690 });
assert.equal(atBottom.changed, true);
assert.equal(atBottom.scrollTop, 700, "夹在 maxTop 内，不会滚出边界");

// 6) 用户已经滚到确认区下方（往回看内容）→ 需要滚回去。
const scrolledPast = revealScrollTop({ boxTop: 900, boxHeight: 230, viewHeight: 400, maxTop: 1000, currentTop: 980 });
assert.equal(scrolledPast.changed, true);
assert.equal(900 + 230 - scrolledPast.scrollTop, 400 - 12);

// 7) 容器本身不可滚动（内容比可视区短）→ 位置固定在 0。
const noScroll = revealScrollTop({ boxTop: 900, boxHeight: 230, viewHeight: 400, maxTop: 0, currentTop: 0 });
assert.equal(noScroll.scrollTop, 0);
