import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("build contains the Peek product and deployable worker", async () => {
  const [page, layout, client, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/peek-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    access(new URL("../dist/server/index.js", import.meta.url)),
    access(new URL("../dist/.openai/hosting.json", import.meta.url)),
  ]);
  assert.match(page, /PeekApp/);
  assert.match(layout, /先鉴 Peek｜先判断值不值得看/);
  assert.match(client, /InfiniSynapse Agent/);
  assert.match(client, /内容链接/);
  assert.match(client, /稍后看/);
  assert.match(client, /历史记录/);
  assert.match(client, /技能树/);
  assert.match(client, /English/);
  assert.match(client, /时间码笔记/);
  assert.doesNotMatch(client, /空白核验空间/);
  assert.match(client, /真实并持久化/);
  assert.match(client, /settings-trigger/);
  assert.match(client, /书架/);
  assert.match(client, /我的笔记本/);
  assert.match(client, /技能树还是空的/);
  assert.match(client, /精华内容/);
  assert.match(client, /内容含金量/);
  assert.match(client, /纳入书架并更新技能树/);
  assert.match(client, /访客/);
  assert.match(client, /个人信息与设置/);
  assert.match(client, /由纳入书架的内容自动累计/);
  assert.match(client, /每次分析自动生成笔记/);
  assert.match(client, /导出 Markdown/);
assert.match(client, /打开原视频并定位到此时间码/);
assert.match(client, /定位原文章节/);
assert.match(client, /\["video", "article", "paper"\]/);
assert.match(client, /contentLocatorUrl/);
assert.match(client, /自动生成内容标题/);
assert.match(client, /沿用当前方式/);
assert.match(client, /titleMode/);
  assert.match(client, /登录或以访客使用/);
  assert.match(client, /登录并同步/);
  assert.match(client, /自动发现候选视频/);
  assert.match(client, /发现后自动分析/);
  assert.match(client, /每天最多 1 条/);
  assert.doesNotMatch(client, /请先完成个人画像/);
  assert.doesNotMatch(client, /你会得到什么/);
  assert.match(client, /ACTIVE_ANALYSIS_STATUSES/);
  assert.match(client, /searchParams\.set\("analysis"/);
  assert.match(client, /isAnalysisActive\(item\.status\)/);
  assert.match(client, /side-note-open/);
  assert.match(client, /Peek/);
  assert.match(client, /\/mascot-v2\.png/);
  assert.match(styles, /\.side-note \{[\s\S]*min-height: 214px/);
  assert.match(styles, /\.mini-mascot \{[\s\S]*width: 128px/);
  assert.match(client, /<strong>先鉴<\/strong>/);
  assert.match(client, /route-meta/);
  assert.match(client, /route-decision/);
  assert.match(client, /analysisRequestVersion/);
  assert.match(client, /analysisRequestVersion\.current !== requestVersion/);
  assert.match(client, /运行中任务/);
  assert.match(client, /activeTaskItems/);
  assert.match(client, /activeTasks\.length/);
  assert.match(client, /add-content-button/);
  assert.match(client, /RunningTasksView/);
  assert.match(client, /查看完整运行列表/);
  assert.match(client, /任务已提交，正在加入运行列表/);
  assert.match(client, /showAdd && \(/);
  assert.match(client, /currentAnalysisAlreadyListed/);
  assert.match(client, /setInterval\(\(\) => void loadMeetings\(\), 8_000\)/);
  assert.match(client, /view === "detail" && !analysis\?\.result/);
  assert.doesNotMatch(`${page}${layout}${client}`, /codex-preview|SkeletonPreview|Starter Project/);
});
