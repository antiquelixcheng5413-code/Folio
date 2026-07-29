import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("build contains the Peek product and deployable worker", async () => {
  const [
    page,
    layout,
    client,
    styles,
    prompt,
    personalization,
    meetingState,
    analysisRoute,
    taxonomy,
    learningAssistant,
    notebook,
    notesAsk,
    notesTranslate,
    coreReport,
    migration,
  ] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/peek-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/infinisynapse.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/personalization.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/meetings/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analyses/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/skill-taxonomy.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/learning-assistant.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/notebook.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/notes/ask/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/notes/translate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/PEEK_CORE_MODEL_AND_SCORING_REPORT.md", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_notebook_translations.sql", import.meta.url), "utf8"),
    access(new URL("../dist/server/index.js", import.meta.url)),
    access(new URL("../dist/.openai/hosting.json", import.meta.url)),
  ]);
  assert.match(page, /PeekApp/);
  assert.match(layout, /先鉴 Peek｜先判断值不值得看/);
  assert.match(client, /Peek 内容助手/);
  assert.match(client, /内容链接/);
  assert.match(client, /稍后看/);
  assert.match(client, /历史记录/);
  assert.match(client, /技能树/);
  assert.match(client, /English/);
  assert.match(client, /时间码笔记/);
  assert.doesNotMatch(client, /空白核验空间/);
  assert.match(client, /自动保存/);
  assert.match(client, /settings-trigger/);
  assert.match(client, /书架/);
  assert.match(client, /我的笔记本/);
  assert.match(client, /技能树还是空的/);
  assert.match(client, /精华内容/);
  assert.match(client, /内容含金量/);
  assert.match(client, /纳入书架并更新技能树/);
  assert.match(client, /shelfTopics/);
  assert.match(client, /访客/);
  assert.match(client, /已同步学习空间/);
  assert.match(client, /由纳入书架的内容自动累计/);
  assert.match(client, /每次分析自动生成笔记/);
  assert.match(client, /导出笔记/);
assert.match(client, /打开原视频并定位到此时间码/);
assert.match(client, /定位原文章节/);
assert.match(client, /\["video", "article", "paper"\]/);
assert.match(client, /contentLocatorUrl/);
assert.match(client, /自动生成内容标题/);
assert.match(client, /沿用当前方式/);
assert.match(client, /titleMode/);
  assert.match(client, /登录或以访客使用/);
  assert.match(client, /登录并同步/);
  assert.match(client, /LearningCalendar/);
  assert.match(client, /skill-donut/);
  assert.match(client, /knowledge-tree/);
  assert.match(client, /font-size-control/);
  assert.match(client, /报告语言/);
  assert.match(client, /translateReport/);
  assert.match(client, /analysis-progress-bar/);
  assert.match(client, /notebook-document/);
  assert.match(client, /RichNote/);
  assert.match(client, /notebook-companion/);
  assert.match(client, /笔记语言/);
  assert.match(client, /\/api\/notes\/ask/);
  assert.match(client, /\/api\/notes\/translate/);
  assert.match(client, /问 Peek/);
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
  assert.match(client, /已加入分析列表/);
  assert.match(client, /showAdd && \(/);
  assert.match(client, /currentAnalysisAlreadyListed/);
  assert.match(client, /setInterval\(\(\) => void loadMeetings\(\), 8_000\)/);
  assert.match(client, /view === "detail" && !analysis\?\.result/);
  assert.match(client, /info-tip/);
  assert.match(client, /matchExplanation/);
  assert.doesNotMatch(client, /计算目标内容时会排除它自己/);
  assert.doesNotMatch(client, /REAL AGENT TASK|HttpOnly|保存到 D1/);
  assert.match(client, /知识与技能关系树/);
  assert.match(client, /加入书架只代表接触过/);
  assert.match(prompt, /专业技能点抽取/);
  assert.match(prompt, /人物、奖项、产品名、新闻事实只能作为证据/);
  assert.match(prompt, /skillAssessment/);
  assert.match(prompt, /peek\.skill\.v2/);
  assert.match(prompt, /2-20 字的规范名词短语/);
  assert.match(prompt, /recursiveJsonObjects/);
  assert.match(prompt, /fromText/);
  assert.match(prompt, /上一条回复只是计划/);
  assert.match(client, /类别 → 专业领域 → 知识与技能点/);
  assert.match(taxonomy, /豪斯多夫维数/);
  assert.match(taxonomy, /extractLegacySkillPoints/);
  assert.match(meetingState, /peek\.taxonomy\.v3/);
  assert.match(personalization, /0\.15 \+ 0\.85/);
  assert.match(analysisRoute, /k\.meeting_id !=/);
  assert.match(meetingState, /mastery_level/);
  assert.match(meetingState, /DELETE FROM analysis_translations/);
  assert.match(learningAssistant, /buildLearningQaPrompt/);
  assert.match(learningAssistant, /SOURCE_TEXT/);
  assert.match(learningAssistant, /用户不需要写提示词/);
  assert.match(learningAssistant, /完整翻译/);
  assert.match(notebook, /buildStructuredNote/);
  assert.doesNotMatch(notebook, /matchReason/);
  assert.match(notesAsk, /answerLearningQuestion/);
  assert.match(notesTranslate, /notebook_translations/);
  assert.match(notesTranslate, /translatableItems/);
  assert.match(coreReport, /Peek 模型调用与评分核心报告/);
  assert.match(coreReport, /最终匹配度/);
  assert.match(migration, /CREATE TABLE `notebook_translations`/);
  assert.doesNotMatch(`${page}${layout}${client}`, /codex-preview|SkeletonPreview|Starter Project/);
});
