import { env } from "cloudflare:workers";
import type {
  AnalysisSegment,
  ContentType,
  LearningProfile,
  SkillPoint,
  XianjianAnalysisResult,
} from "./types";
import { skillKey } from "./personalization";

const DEFAULT_BASE_URL = "https://app.infinisynapse.cn";

type ProgressUpdate = {
  stage: string;
  taskId?: string;
  detail?: string;
};

type RunOptions = {
  connId: string;
  transcript: string;
  meetingTitle: string;
  profile: LearningProfile;
  durationSeconds: number;
  contentType?: ContentType;
  onProgress: (update: ProgressUpdate) => Promise<void> | void;
};

function config() {
  const runtime = env as unknown as Record<string, string | undefined>;
  const apiKey = runtime.INFINISYNAPSE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("服务器尚未配置 INFINISYNAPSE_API_KEY");
  }
  return {
    apiKey,
    baseUrl: (runtime.INFINISYNAPSE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""),
  };
}

function headers(apiKey: string, accept = "application/json") {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: accept,
    "Content-Type": "application/json",
    "x-lang": "zh_CN",
  };
}

async function apiJson<T>(path: string, init: RequestInit = {}) {
  const { apiKey, baseUrl } = config();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...headers(apiKey),
      ...(init.headers || {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | { code?: number; message?: string; data?: T }
    | T
    | null;
  if (!response.ok) {
    throw new Error(
      `InfiniSynapse 请求失败（${response.status}）：${
        (payload as { message?: string } | null)?.message || "未知错误"
      }`
    );
  }
  if (
    payload &&
    typeof payload === "object" &&
    "code" in payload &&
    (payload as { code?: number }).code !== 200
  ) {
    const envelope = payload as { code?: number; message?: string };
    if (envelope.code === 1101 || envelope.code === 1105) {
      throw new Error("InfiniSynapse API Key 已失效");
    }
    throw new Error(envelope.message || `InfiniSynapse 业务错误 ${envelope.code}`);
  }
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function buildPrompt(options: RunOptions) {
  const { profile, meetingTitle, transcript, durationSeconds } = options;
  const contentType = options.contentType || "video";
  const markerMatch = transcript.match(/^(VIDEO|ARTICLE|PAPER)_URL:([\s\S]+)$/);
  const sourceUrl = markerMatch?.[2]?.trim() || "";
  const typeLabel = contentType === "video" ? "视频" : contentType === "paper" ? "论文" : "文章";
  const structuredSkills = JSON.stringify(profile.skills || [], null, 2);
  const contentInstruction = sourceUrl
    ? contentType === "video"
      ? `公开视频链接：${sourceUrl}

请先打开该公开视频页面，读取页面提供的字幕、章节、转录或其他可核验的时间码内容。若页面有“显示文字稿 / transcript / 字幕”入口，请使用它。仅根据实际读取到的内容分析，禁止凭标题编造。无法访问或没有任何可核验字幕/章节时，请明确返回错误，不要伪造片段。`
      : `公开${typeLabel}链接：${sourceUrl}

请打开原文并阅读全文，只根据实际可见的正文、标题层级和页码分析，禁止凭标题或摘要编造。每个阅读片段必须提供原文中的准确小标题 heading 和一段可检索的短原句 quote；PDF 论文能确认页码时还要提供 pageNumber。无法访问正文时请明确返回错误，不要伪造章节、引文或页码。`
    : contentType === "video"
      ? `字幕估算总时长：${durationSeconds} 秒

字幕开始：
${transcript}
字幕结束。`
      : `${typeLabel}正文开始：
${transcript}
${typeLabel}正文结束。请用原文小标题和短引文标记每个阅读片段。`;
  const segmentRequirement = contentType === "video"
    ? "提供至少 3 个、最多 7 个有效时间码片段；每段必须来自可核验的字幕、章节或转录时间码，startSeconds < endSeconds。"
    : "提供至少 3 个、最多 7 个阅读片段；按原文顺序排列，每段必须包含 locator.heading 和可在原文检索的 locator.quote；PDF 能确认页码时填写 locator.pageNumber。startSeconds/endSeconds 仅按 0-1、1-2 的章节顺序填写。";
  const segmentEvidence = contentType === "video"
    ? "每个片段标记 watch 或 skip，并说明对该用户的具体价值和字幕证据。"
    : "每个片段标记 watch 或 skip，并用通俗中文说明该章节讲了什么、为何值得读或可跳过。";
  return `你是“先鉴 Peek”的内容价值分析 Agent。你必须基于用户画像逐段分析${typeLabel}，禁止编造来源中不存在的信息。

自动学习画像（由用户已纳入书架的内容持续累计，不要求用户手填）：
- 方向：${profile.direction}
- 当前水平：${profile.level}
- 正在做的项目：${profile.project}
- 已掌握主题：${profile.knownTopics}
- 内容偏好：${profile.preferences}
- 已有技能点（这是结构化画像；mastery 是 0-100 的掌握度估计，不等同于仅看过）：
${structuredSkills}

内容标题：${meetingTitle}
${contentInstruction}

任务：
1. 判断整场内容对该用户是值得看、选择性看，还是跳过。
   若这是第一次分析、画像尚未形成，匹配度应取中性值并说明“暂无足够历史”，不要把未知误判为高匹配或低匹配；含金量仍须独立正常评价。
2. ${segmentRequirement}
3. ${segmentEvidence}
4. 执行“专业技能点抽取”，这是硬性要求，不得把视频标题、人物、事件结论或整句摘要直接当技能节点：
   - 技能点必须是可学习、可练习、可迁移、可验证掌握程度的最小专业单元，例如“用数学归纳法证明递推恒等式”，而不是“某教授证明了某猜想”。
   - 每个技能点必须明确专业领域、类型、前置技能、内容中可核验的证据、学完后能做什么，以及本内容覆盖深度。
   - 相邻但不同层级的概念不能混成一个节点；同义词必须归一为稳定 key。
   - 人物、奖项、产品名、新闻事实只能作为证据，不能单独成为 skill。
   - 若内容只有事实介绍而没有可学习的方法或概念，应减少技能点数量并降低 confidence，禁止为了凑数生成节点。
5. 区分新增知识与用户已掌握/重复知识，并用 skillAssessment.skills 表达真正的专业技能点。方法型内容通常应有 3-12 个；纯事实或资讯内容允许为 0，绝不凑数。
6. 将“主题相关度”和“含金量”严格分开评分：
   - signals.match 只提供本次 Agent 对“主题相关度”的初步判断，最终个性化匹配度由服务端使用统一公式重算。
   - 含金量不受用户画像影响，独立衡量信息密度、专业制作、原创洞察、可验证性与内容完整度。与用户目标不匹配的优质内容仍可获得高含金量。
   - 同时给出技术深度、推广含量、重复度、来源可靠度，所有分数均为 0-100。
7. 在任务工作区写入文件 xianjian-result.json。最终回复也只输出同一份 JSON，不要 Markdown，不要解释。

表达要求：
- 所有用户可见文字使用简洁中文，直接说内容讲了什么、为什么有价值，避免出现 API、抓取过程、网站域名、工具调用和数据获取过程。
- summary 必须先说明内容本身好不好，再说明是否适合当前用户，不超过 60 字。
- evidence 必须是 2-4 条可独立理解的内容精华，每条写成完整句子，不要罗列来源元数据。
- matchReason 和 valueReason 各用一句通俗中文解释评分依据，不超过 45 字。
- contentTitle 填写来源页面或原内容中实际出现的正式标题；无法确认时留空，禁止根据主题自行编造。
- skillAssessment.skills 中的 coverage 表示内容覆盖充分度，depth 表示专业深度，relevance 表示与当前画像目标的主题相关度，userMasteryBefore 表示分析前掌握度，prerequisiteFit 表示前置知识适配度，confidence 表示抽取可信度。全部为 0-100。

JSON 必须严格符合以下结构：
{
  "schemaVersion": "xianjian.v1",
  "contentTitle": "来源中实际出现的正式标题",
  "verdict": "worth | selective | skip",
  "summary": "一句话结论",
  "evidence": ["依据1", "依据2"],
  "signals": {
    "match": 0,
    "matchReason": "为什么与当前用户匹配或不匹配",
    "value": 0,
    "valueReason": "为什么内容本身含金量高或低",
    "depth": 0,
    "promotion": 0,
    "repetition": 0,
    "sourceReliability": 0
  },
  "segments": [{
    "id": "seg-1",
    "startSeconds": 0,
    "endSeconds": 0,
    "decision": "watch | skip",
    "title": "片段标题",
    "value": "为什么对该用户有用或无用",
    "evidence": "字幕中的具体依据",
    "tags": ["主题"],
    "locator": {
      "heading": "文章或论文的小标题；视频留空",
      "quote": "可在原文中检索的短原句；视频留空",
      "pageNumber": 1
    }
  }],
  "skillAssessment": {
    "protocolVersion": "peek.skill.v2",
    "domainSummary": "这份内容覆盖的专业领域与知识层级",
    "skills": [{
      "key": "规范化稳定键，例如 mathematics-induction-proof",
      "domain": "专业领域，例如 数学/离散数学",
      "name": "可学习且可验证的具体技能点",
      "description": "该技能解决什么问题，边界是什么",
      "type": "concept | method | tool | practice",
      "relation": "new | reinforce | prerequisite | advanced",
      "prerequisites": ["前置技能"],
      "evidence": ["内容中的具体论述、推导或演示依据"],
      "learningOutcome": "学完后用户能够完成的具体任务",
      "coverage": 0,
      "depth": 0,
      "relevance": 0,
      "userMasteryBefore": 0,
      "prerequisiteFit": 0,
      "confidence": 0
    }]
  },
  "newKnowledge": [{"topic": "主题", "evidence": "依据"}],
  "repeatedKnowledge": [{"topic": "主题", "evidence": "依据"}]
}`;
}

function recursiveTaskId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = recursiveTaskId(item);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["taskId", "task_id"]) {
    if (typeof record[key] === "string") {
      return String(record[key]);
    }
  }
  for (const item of Object.values(record)) {
    const found = recursiveTaskId(item);
    if (found) return found;
  }
  return null;
}

function recursiveTexts(value: unknown, output: string[] = []) {
  if (!value) return output;
  if (typeof value === "string") {
    if (value.length > 20) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) recursiveTexts(item, output);
    return output;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "content", "message", "result"]) {
      if (key in record) recursiveTexts(record[key], output);
    }
    for (const item of Object.values(record)) {
      if (typeof item === "object") recursiveTexts(item, output);
    }
  }
  return output;
}

function parseJsonCandidate(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const options = [fenced, trimmed].filter(Boolean) as string[];
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) options.push(trimmed.slice(first, last + 1));
  for (const option of options) {
    try {
      return JSON.parse(option);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function score(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function valueScore(signals: Record<string, unknown>) {
  if (signals.value !== undefined) return score(signals.value);
  return Math.round(
    score(signals.depth) * 0.35 +
      score(signals.sourceReliability) * 0.35 +
      (100 - score(signals.promotion)) * 0.15 +
      (100 - score(signals.repetition)) * 0.15
  );
}

function scoreReason(kind: "match" | "value", value: number) {
  if (kind === "match") {
    if (value >= 75) return "与当前学习方向和项目高度相关，可以直接吸收使用。";
    if (value >= 45) return "与当前方向部分相关，建议只看标出的关键片段。";
    return "内容与当前技能树关联较弱，可按兴趣决定是否保留。";
  }
  if (value >= 75) return "信息密度、专业度和可信度较高，内容本身值得保留。";
  if (value >= 45) return "有可用信息，但深度或原创性一般，适合选择性观看。";
  return "有效信息较少或重复、推广较多，整体含金量有限。";
}

function normalizeSegment(
  value: unknown,
  index: number,
  contentType: ContentType
): AnalysisSegment | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const rawStart = Math.round(Number(item.startSeconds));
  const rawEnd = Math.round(Number(item.endSeconds));
  if (
    contentType === "video" &&
    (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart)
  ) {
    return null;
  }
  const startSeconds = contentType === "video" ? Math.max(0, rawStart) : index;
  const endSeconds = contentType === "video" ? Math.max(0, rawEnd) : index + 1;
  const rawLocator = item.locator && typeof item.locator === "object"
    ? item.locator as Record<string, unknown>
    : {};
  const heading = String(rawLocator.heading || "").trim();
  const quote = String(rawLocator.quote || "").trim();
  const rawPage = Number(rawLocator.pageNumber);
  const pageNumber = Number.isFinite(rawPage) && rawPage > 0 ? Math.round(rawPage) : undefined;
  return {
    id: String(item.id || `seg-${index + 1}`),
    startSeconds,
    endSeconds,
    decision: item.decision === "skip" ? "skip" : "watch",
    title: String(item.title || `片段 ${index + 1}`),
    value: String(item.value || ""),
    evidence: String(item.evidence || ""),
    tags: Array.isArray(item.tags) ? item.tags.map(String).slice(0, 6) : [],
    ...(contentType === "video" || (!heading && !quote && !pageNumber)
      ? {}
      : { locator: { ...(heading ? { heading } : {}), ...(quote ? { quote } : {}), ...(pageNumber ? { pageNumber } : {}) } }),
  };
}

function unionDuration(segments: AnalysisSegment[]) {
  const intervals = segments
    .filter((segment) => segment.decision === "watch")
    .map((segment) => [segment.startSeconds, segment.endSeconds] as const)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let start = -1;
  let end = -1;
  for (const [nextStart, nextEnd] of intervals) {
    if (start < 0) {
      start = nextStart;
      end = nextEnd;
    } else if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      total += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  if (start >= 0) total += end - start;
  return total;
}

export function normalizeResult(
  value: unknown,
  durationSeconds: number,
  contentType: ContentType = "video"
): XianjianAnalysisResult {
  if (!value || typeof value !== "object") throw new Error("未获得结构化 JSON 结果");
  const raw = value as Record<string, unknown>;
  const segments = (Array.isArray(raw.segments) ? raw.segments : [])
    .map((segment, index) => normalizeSegment(segment, index, contentType))
    .filter(Boolean) as AnalysisSegment[];
  if (segments.length < 3) {
    throw new Error(contentType === "video"
      ? "结构化结果少于 3 个有效时间码片段"
      : "结构化结果少于 3 个有效阅读片段");
  }
  const signals =
    raw.signals && typeof raw.signals === "object"
      ? (raw.signals as Record<string, unknown>)
      : {};
  const maxSegmentEnd = Math.max(...segments.map((segment) => segment.endSeconds));
  const totalDurationSeconds = Math.max(durationSeconds, maxSegmentEnd);
  const recommendedSeconds = unionDuration(segments);
  const verdict =
    raw.verdict === "worth" || raw.verdict === "skip" ? raw.verdict : "selective";
  const match = score(signals.match);
  const contentValue = valueScore(signals);

  const knowledge = (input: unknown) =>
    (Array.isArray(input) ? input : [])
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        topic: String((item as Record<string, unknown>).topic || ""),
        evidence: String((item as Record<string, unknown>).evidence || ""),
      }))
      .filter((item) => item.topic);

  const rawSkillAssessment =
    raw.skillAssessment && typeof raw.skillAssessment === "object"
      ? (raw.skillAssessment as Record<string, unknown>)
      : {};
  const hasSkillAssessment = Boolean(
    raw.skillAssessment && typeof raw.skillAssessment === "object"
  );
  const skills = (Array.isArray(rawSkillAssessment.skills) ? rawSkillAssessment.skills : [])
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const record = item as Record<string, unknown>;
      const domain = String(record.domain || "未分类").trim().slice(0, 80);
      const name = String(record.name || "").trim().slice(0, 120);
      if (!name) return null;
      const type = ["concept", "method", "tool", "practice"].includes(String(record.type))
        ? String(record.type) as SkillPoint["type"]
        : "concept";
      const relation = ["new", "reinforce", "prerequisite", "advanced"].includes(String(record.relation))
        ? String(record.relation) as SkillPoint["relation"]
        : "new";
      const evidence = Array.isArray(record.evidence)
        ? record.evidence.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 6)
        : [];
      const description = String(record.description || "").trim().slice(0, 500);
      const learningOutcome = String(record.learningOutcome || "").trim().slice(0, 500);
      if (!description || !learningOutcome || !evidence.length || name.length > 80) return null;
      return {
        key: String(record.key || skillKey(domain, name) || `skill-${index + 1}`).slice(0, 160),
        domain,
        name,
        description,
        type,
        relation,
        prerequisites: Array.isArray(record.prerequisites)
          ? record.prerequisites.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 8)
          : [],
        evidence,
        learningOutcome,
        coverage: score(record.coverage),
        depth: score(record.depth),
        relevance: score(record.relevance),
        userMasteryBefore: score(record.userMasteryBefore),
        prerequisiteFit: score(record.prerequisiteFit),
        confidence: score(record.confidence),
      } satisfies SkillPoint;
    })
    .filter(Boolean) as SkillPoint[];
  const rawPersonalization =
    raw.personalization && typeof raw.personalization === "object"
      ? (raw.personalization as Record<string, unknown>)
      : null;

  return {
    schemaVersion: "xianjian.v1",
    ...(String(raw.contentTitle || "").trim()
      ? { contentTitle: String(raw.contentTitle).trim().slice(0, 180) }
      : {}),
    verdict,
    summary: String(raw.summary || "已完成个性化会议分析"),
    evidence: Array.isArray(raw.evidence) ? raw.evidence.map(String).slice(0, 8) : [],
    signals: {
      match,
      matchReason: String(signals.matchReason || scoreReason("match", match)),
      value: contentValue,
      valueReason: String(signals.valueReason || scoreReason("value", contentValue)),
      depth: score(signals.depth),
      promotion: score(signals.promotion),
      repetition: score(signals.repetition),
      sourceReliability: score(signals.sourceReliability),
    },
    segments,
    newKnowledge: knowledge(raw.newKnowledge),
    repeatedKnowledge: knowledge(raw.repeatedKnowledge),
    ...(hasSkillAssessment
      ? {
          skillAssessment: {
            protocolVersion: "peek.skill.v2" as const,
            domainSummary: String(rawSkillAssessment.domainSummary || "").trim().slice(0, 500),
            skills,
          },
        }
      : {}),
    ...(rawPersonalization?.formulaVersion === "peek.match.v2"
      ? {
          personalization: {
            formulaVersion: "peek.match.v2" as const,
            profileFingerprint: String(rawPersonalization.profileFingerprint || ""),
            evaluatedAt: String(rawPersonalization.evaluatedAt || ""),
            relevance: score(rawPersonalization.relevance),
            skillFit: score(rawPersonalization.skillFit),
            knowledgeGain: score(rawPersonalization.knowledgeGain),
            difficultyFit: score(rawPersonalization.difficultyFit),
            valueMultiplier: Math.max(
              0,
              Math.min(1, Number(rawPersonalization.valueMultiplier) || 0)
            ),
            basis: String(rawPersonalization.basis || ""),
          },
        }
      : {}),
    totalDurationSeconds,
    recommendedSeconds,
    savedSeconds: Math.max(0, totalDurationSeconds - recommendedSeconds),
  };
}

async function fetchWorkspaceCandidates(taskId: string) {
  const candidates: string[] = [];
  let workspace: unknown = null;
  try {
    workspace = await apiJson<unknown>(`/api/ai_task/getTaskWorkspace/${encodeURIComponent(taskId)}`);
    const serialized = JSON.stringify(workspace);
    const names = [...serialized.matchAll(/"([^"]*xianjian-result\.json)"/gi)].map(
      (match) => match[1]
    );
    for (const fileName of [...new Set(names)].slice(0, 3)) {
      const preview = await apiJson<unknown>("/api/ai_task/previewFile", {
        method: "POST",
        body: JSON.stringify({ taskId, fileName }),
      });
      candidates.push(...recursiveTexts(preview));
      if (typeof preview === "string") candidates.push(preview);
    }
  } catch {
    // The final message remains a valid fallback.
  }
  return { workspace, candidates };
}

export async function recoverInfiniTask(
  taskId: string,
  durationSeconds: number,
  contentType: ContentType = "video"
) {
  const [taskInfo, messages, workspaceResult] = await Promise.all([
    apiJson<unknown>(`/api/ai_task/getTaskInfo/${encodeURIComponent(taskId)}`),
    apiJson<unknown>(`/api/ai_task/getUiMessageById?id=${encodeURIComponent(taskId)}`),
    fetchWorkspaceCandidates(taskId),
  ]);
  const candidates = [
    ...workspaceResult.candidates,
    ...recursiveTexts(messages),
    ...recursiveTexts(taskInfo),
  ];
  for (const candidate of candidates.reverse()) {
    const parsed = parseJsonCandidate(candidate);
    if (!parsed) continue;
    try {
      return {
        result: normalizeResult(parsed, durationSeconds, contentType),
        taskInfo,
        messages,
        workspace: workspaceResult.workspace,
      };
    } catch {
      // Continue to older candidates.
    }
  }
  return { result: null, taskInfo, messages, workspace: workspaceResult.workspace };
}

export async function startInfiniTask(options: RunOptions) {
  const { apiKey, baseUrl } = config();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("task start timeout"), 45_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    await options.onProgress({ stage: "正在连接 InfiniSynapse Agent" });
    const streamResponse = await fetch(
      `${baseUrl}/api/ai/events?connId=${encodeURIComponent(options.connId)}`,
      {
        headers: headers(apiKey, "text/event-stream"),
        signal: controller.signal,
      }
    );
    if (!streamResponse.ok || !streamResponse.body) {
      throw new Error(`SSE 连接失败（${streamResponse.status}）`);
    }
    reader = streamResponse.body.getReader();
    await options.onProgress({ stage: "Agent 已连接，正在创建真实任务" });
    const createResponse = await fetch(`${baseUrl}/api/ai/message`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        type: "newTask",
        text: buildPrompt(options),
        connId: options.connId,
        chatSettings: { mode: "act" },
      }),
      signal: controller.signal,
    });
    const createPayload = await createResponse.json().catch(() => null);
    if (!createResponse.ok) {
      throw new Error(
        `创建任务失败（${createResponse.status}）：${
          (createPayload as { message?: string } | null)?.message || "未知错误"
        }`
      );
    }

    let taskId = recursiveTaskId(createPayload) || "";
    const decoder = new TextDecoder();
    let buffer = "";
    while (!taskId) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const dataText = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!dataText || dataText === "[DONE]") continue;
        const payload = parseJsonCandidate(dataText) || dataText;
        taskId = recursiveTaskId(payload) || "";
        if (taskId) break;
      }
    }
    if (!taskId) throw new Error("真实任务已发送，但未返回 taskId");
    await options.onProgress({ stage: "真实任务已创建，等待结果恢复", taskId });
    return { taskId, createPayload };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("创建真实任务超时，尚未获得可恢复的 taskId");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    await reader?.cancel().catch(() => undefined);
  }
}

export async function requestInfiniRepair(
  taskId: string,
  connId: string,
  contentType: ContentType = "video"
) {
  const { apiKey, baseUrl } = config();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("repair timeout"), 45_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const streamResponse = await fetch(
      `${baseUrl}/api/ai/events?connId=${encodeURIComponent(connId)}`,
      {
        headers: headers(apiKey, "text/event-stream"),
        signal: controller.signal,
      }
    );
    if (!streamResponse.ok || !streamResponse.body) {
      throw new Error(`修复任务 SSE 连接失败（${streamResponse.status}）`);
    }
    reader = streamResponse.body.getReader();
    const repairResponse = await fetch(`${baseUrl}/api/ai/message`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        type: "askResponse",
        taskId,
        connId,
        askResponse: "messageResponse",
        text: contentType === "video"
          ? "xianjian-result.json 不是合法 JSON。请修复并覆盖原文件：所有字符串内部的双引号必须转义；保持 xianjian.v1 字段不变；至少保留 3 个 startSeconds < endSeconds 的片段。最终回复只输出严格 JSON，不要 Markdown。"
          : "xianjian-result.json 不是合法 JSON。请修复并覆盖原文件：保持 xianjian.v1 字段不变；至少保留 3 个按原文顺序排列的阅读片段，每段包含 locator.heading 和 locator.quote，PDF 可确认时包含 locator.pageNumber。最终回复只输出严格 JSON，不要 Markdown。",
      }),
      signal: controller.signal,
    });
    const payload = await repairResponse.json().catch(() => null);
    if (!repairResponse.ok) {
      throw new Error(
        `请求 JSON 修复失败（${repairResponse.status}）：${
          (payload as { message?: string } | null)?.message || "未知错误"
        }`
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("请求 JSON 修复超时");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    await reader?.cancel().catch(() => undefined);
  }
}

export async function runInfiniAnalysis(options: RunOptions) {
  const { apiKey, baseUrl } = config();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("analysis timeout"), 11.5 * 60 * 1000);
  let taskId = "";
  const collected: string[] = [];
  try {
    await options.onProgress({ stage: "正在连接 InfiniSynapse Agent" });
    const streamResponse = await fetch(
      `${baseUrl}/api/ai/events?connId=${encodeURIComponent(options.connId)}`,
      {
        headers: headers(apiKey, "text/event-stream"),
        signal: controller.signal,
      }
    );
    if (!streamResponse.ok || !streamResponse.body) {
      throw new Error(`SSE 连接失败（${streamResponse.status}）`);
    }
    const reader = streamResponse.body.getReader();
    await options.onProgress({ stage: "Agent 已连接，正在创建真实任务" });
    const createResponse = await fetch(`${baseUrl}/api/ai/message`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        type: "newTask",
        text: buildPrompt(options),
        connId: options.connId,
        chatSettings: { mode: "act" },
      }),
      signal: controller.signal,
    });
    const createPayload = await createResponse.json().catch(() => null);
    if (!createResponse.ok) {
      throw new Error(
        `创建任务失败（${createResponse.status}）：${
          (createPayload as { message?: string } | null)?.message || "未知错误"
        }`
      );
    }
    taskId = recursiveTaskId(createPayload) || "";
    if (taskId) {
      await options.onProgress({ stage: "真实任务已创建", taskId });
    }

    const decoder = new TextDecoder();
    let buffer = "";
    const readUntilCompletion = async () => {
      let completed = false;
      while (!completed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const eventName = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() || "";
          const dataText = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!dataText || dataText === "[DONE]") continue;
          const payload = parseJsonCandidate(dataText) || dataText;
          taskId ||= recursiveTaskId(payload) || "";
          if (taskId) {
            await options.onProgress({
              stage: eventName.includes("partial")
                ? "Agent 正在逐段分析字幕"
                : "Agent 正在整理结论",
              taskId,
            });
          }
          collected.push(...recursiveTexts(payload));
          const serialized =
            typeof payload === "string" ? payload : JSON.stringify(payload);
          if (serialized.includes("completion_result")) completed = true;
          if (
            eventName === "notification" &&
            /"type"\s*:\s*"error"/i.test(serialized)
          ) {
            throw new Error("InfiniSynapse Agent 返回任务错误");
          }
        }
      }
    };
    await readUntilCompletion();
    if (!taskId) throw new Error("真实任务已发送，但未返回 taskId");
    await options.onProgress({ stage: "正在核验工作区结果", taskId });
    const recovery = await recoverInfiniTask(taskId, options.durationSeconds, options.contentType);
    if (recovery.result) return { taskId, ...recovery };
    for (const candidate of [...collected].reverse()) {
      const parsed = parseJsonCandidate(candidate);
      if (!parsed) continue;
      try {
        return {
          taskId,
          result: normalizeResult(parsed, options.durationSeconds, options.contentType),
          messages: collected,
          workspace: recovery.workspace,
          taskInfo: recovery.taskInfo,
        };
      } catch {
        // Try another message candidate.
      }
    }
    await options.onProgress({ stage: "JSON 结果异常，正在请求 Agent 修复一次", taskId });
    const repairResponse = await fetch(`${baseUrl}/api/ai/message`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        type: "askResponse",
        taskId,
        connId: options.connId,
        askResponse: "messageResponse",
        text: options.contentType === "video"
          ? "上一份结果未通过 xianjian.v1 校验。请修复为严格 JSON，必须包含至少 3 个 startSeconds < endSeconds 的有效时间码片段，并覆盖写入 xianjian-result.json；最终回复只输出 JSON。"
          : "上一份结果未通过 xianjian.v1 校验。请修复为严格 JSON，必须包含至少 3 个按原文顺序排列的阅读片段，每段包含 locator.heading 和 locator.quote，PDF 可确认时包含 locator.pageNumber；覆盖写入 xianjian-result.json，最终回复只输出 JSON。",
      }),
      signal: controller.signal,
    });
    if (repairResponse.ok) {
      await readUntilCompletion();
      const repaired = await recoverInfiniTask(taskId, options.durationSeconds, options.contentType);
      if (repaired.result) return { taskId, ...repaired };
      for (const candidate of [...collected].reverse()) {
        const parsed = parseJsonCandidate(candidate);
        if (!parsed) continue;
        try {
          return {
            taskId,
            result: normalizeResult(parsed, options.durationSeconds, options.contentType),
            messages: collected,
            workspace: repaired.workspace,
            taskInfo: repaired.taskInfo,
          };
        } catch {
          // The single repair attempt did not yield a valid candidate.
        }
      }
    }
    throw new Error("Agent 已完成，但 JSON 结果异常；可通过 taskId 恢复");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        taskId
          ? `分析超过 12 分钟，任务仍可通过 taskId ${taskId} 恢复`
          : "连接超时，尚未获得可恢复的 taskId"
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runInfiniJsonTask(prompt: string) {
  const { apiKey, baseUrl } = config();
  const connId = crypto.randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("json task timeout"), 2.5 * 60 * 1000);
  const collected: string[] = [];
  try {
    const streamResponse = await fetch(
      `${baseUrl}/api/ai/events?connId=${encodeURIComponent(connId)}`,
      { headers: headers(apiKey, "text/event-stream"), signal: controller.signal }
    );
    if (!streamResponse.ok || !streamResponse.body) throw new Error("无法连接翻译与问答 Agent");
    const reader = streamResponse.body.getReader();
    const createResponse = await fetch(`${baseUrl}/api/ai/message`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({ type: "newTask", text: prompt, connId, chatSettings: { mode: "act" } }),
      signal: controller.signal,
    });
    const createPayload = await createResponse.json().catch(() => null);
    if (!createResponse.ok) throw new Error("无法创建翻译与问答任务");
    let taskId = recursiveTaskId(createPayload) || "";
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;
    while (!completed) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const dataText = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!dataText || dataText === "[DONE]") continue;
        const payload = parseJsonCandidate(dataText) || dataText;
        taskId ||= recursiveTaskId(payload) || "";
        collected.push(...recursiveTexts(payload));
        const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
        if (serialized.includes("completion_result")) completed = true;
      }
    }
    if (taskId) {
      const messages = await apiJson<unknown>(`/api/ai_task/getUiMessageById?id=${encodeURIComponent(taskId)}`).catch(() => null);
      collected.push(...recursiveTexts(messages));
    }
    for (const candidate of collected.reverse()) {
      const parsed = parseJsonCandidate(candidate);
      if (parsed && typeof parsed === "object") return { taskId, result: parsed };
    }
    throw new Error("Agent 未返回可读取的结构化结果");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("翻译或问答超时，请稍后重试");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function cancelInfiniTask(taskId: string) {
  return apiJson<unknown>(
    `/api/ai_task/cancelTask?taskId=${encodeURIComponent(taskId)}`,
    { method: "POST" }
  );
}
