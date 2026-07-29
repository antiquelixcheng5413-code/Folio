import type { XianjianAnalysisResult } from "./types";

function conciseSkillNames(result: XianjianAnalysisResult) {
  const generic = new Set(["数学", "数学史", "几何测度论", "调和分析", "证明策略", "核心方法", "技术细节"]);
  const assessed = (result.skillAssessment?.skills || [])
    .map((skill) => skill.name)
    .filter((name) => name.length <= 20 && !/[，。；！？：]/.test(name));
  const tags = result.segments.flatMap((segment) => segment.tags || []);
  return [...new Set([...assessed, ...tags])]
    .filter((name) => !generic.has(name))
    .slice(0, 10);
}

export function buildStructuredNote(result: XianjianAnalysisResult) {
  const coreSegments = result.segments.filter((segment) => segment.decision === "watch").slice(0, 7);
  const skillNames = conciseSkillNames(result);
  const skillLines = skillNames.map((name) => {
    const assessed = result.skillAssessment?.skills.find((skill) => skill.name === name);
    const segment = result.segments.find(
      (item) => item.tags.includes(name) || `${item.title}${item.value}${item.evidence}`.includes(name)
    );
    return `- **${name}**：${assessed?.description || segment?.value || segment?.evidence || "本内容涉及的关键知识点。"}`;
  });
  const routeLines = coreSegments.map((segment) => {
    const location = result.totalDurationSeconds > 0
      ? `${Math.floor(segment.startSeconds / 60)}:${String(segment.startSeconds % 60).padStart(2, "0")}`
      : segment.locator?.heading || (segment.locator?.pageNumber ? `第 ${segment.locator.pageNumber} 页` : "");
    return `- **${segment.title}**${location ? `（${location}）` : ""}：${segment.value}${segment.evidence ? `\n  - 依据：${segment.evidence}` : ""}`;
  });
  const knowledgeLines = result.newKnowledge.slice(0, 7).map(
    (item) => `- **${item.topic}**：${item.evidence}`
  );
  return [
    "# 核心结论",
    result.summary,
    "",
    "## 这篇内容解决什么问题",
    ...(result.evidence.length ? result.evidence.slice(0, 5).map((item) => `- ${item}`) : ["- 当前报告没有提供足够证据。"]),
    "",
    "## 关键知识点",
    ...(skillLines.length ? skillLines : knowledgeLines.length ? knowledgeLines : ["- 暂无可独立提取的知识点。"]),
    "",
    "## 核心思路与具体内容",
    ...(routeLines.length ? routeLines : ["- 当前报告没有标出建议保留的核心部分。"]),
    "",
    "## 新获得的知识",
    ...(knowledgeLines.length ? knowledgeLines : ["- 暂无明确新增知识。"]),
    "",
    "## 对我的价值",
    `- **匹配度 ${result.signals.match}%**：${result.signals.matchReason}`,
    `- **内容含金量 ${result.signals.value}%**：${result.signals.valueReason}`,
    "",
    "## 可以继续追问",
    "- 这篇内容最关键的概念分别是什么？",
    "- 核心结论经过了哪些步骤？",
    "- 哪些前提、证据或限制需要特别注意？",
  ].join("\n").slice(0, 4000);
}
