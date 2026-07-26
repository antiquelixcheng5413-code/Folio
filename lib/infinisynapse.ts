import { env } from "cloudflare:workers";
import type {
  AnalysisSegment,
  LearningProfile,
  XianjianAnalysisResult,
} from "./types";

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
  return `你是“先鉴”的会议内容价值分析 Agent。你必须基于用户画像逐段分析字幕，禁止编造字幕中不存在的内容。

用户画像：
- 方向：${profile.direction}
- 当前水平：${profile.level}
- 正在做的项目：${profile.project}
- 已掌握主题：${profile.knownTopics}
- 内容偏好：${profile.preferences}

会议标题：${meetingTitle}
字幕估算总时长：${durationSeconds} 秒

任务：
1. 判断整场内容对该用户是值得看、选择性看，还是跳过。
2. 提供至少 3 个、最多 7 个有效时间码片段；每段必须来自字幕时间码，startSeconds < endSeconds。
3. 每个片段标记 watch 或 skip，并说明对该用户的具体价值和字幕证据。
4. 区分新增知识与用户已掌握/重复知识。
5. 从匹配度、技术深度、推广含量、重复度、来源可靠度五个维度给出 0-100 分。
6. 在任务工作区写入文件 xianjian-result.json。最终回复也只输出同一份 JSON，不要 Markdown，不要解释。

JSON 必须严格符合以下结构：
{
  "schemaVersion": "xianjian.v1",
  "verdict": "worth | selective | skip",
  "summary": "一句话结论",
  "evidence": ["依据1", "依据2"],
  "signals": {
    "match": 0,
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
    "tags": ["主题"]
  }],
  "newKnowledge": [{"topic": "主题", "evidence": "依据"}],
  "repeatedKnowledge": [{"topic": "主题", "evidence": "依据"}]
}

字幕开始：
${transcript}
字幕结束。`;
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

function normalizeSegment(value: unknown, index: number): AnalysisSegment | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const startSeconds = Math.max(0, Math.round(Number(item.startSeconds)));
  const endSeconds = Math.max(0, Math.round(Number(item.endSeconds)));
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
    return null;
  }
  return {
    id: String(item.id || `seg-${index + 1}`),
    startSeconds,
    endSeconds,
    decision: item.decision === "skip" ? "skip" : "watch",
    title: String(item.title || `片段 ${index + 1}`),
    value: String(item.value || ""),
    evidence: String(item.evidence || ""),
    tags: Array.isArray(item.tags) ? item.tags.map(String).slice(0, 6) : [],
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
  durationSeconds: number
): XianjianAnalysisResult {
  if (!value || typeof value !== "object") throw new Error("未获得结构化 JSON 结果");
  const raw = value as Record<string, unknown>;
  const segments = (Array.isArray(raw.segments) ? raw.segments : [])
    .map(normalizeSegment)
    .filter(Boolean) as AnalysisSegment[];
  if (segments.length < 3) throw new Error("结构化结果少于 3 个有效时间码片段");
  const signals =
    raw.signals && typeof raw.signals === "object"
      ? (raw.signals as Record<string, unknown>)
      : {};
  const maxSegmentEnd = Math.max(...segments.map((segment) => segment.endSeconds));
  const totalDurationSeconds = Math.max(durationSeconds, maxSegmentEnd);
  const recommendedSeconds = unionDuration(segments);
  const verdict =
    raw.verdict === "worth" || raw.verdict === "skip" ? raw.verdict : "selective";

  const knowledge = (input: unknown) =>
    (Array.isArray(input) ? input : [])
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        topic: String((item as Record<string, unknown>).topic || ""),
        evidence: String((item as Record<string, unknown>).evidence || ""),
      }))
      .filter((item) => item.topic);

  return {
    schemaVersion: "xianjian.v1",
    verdict,
    summary: String(raw.summary || "已完成个性化会议分析"),
    evidence: Array.isArray(raw.evidence) ? raw.evidence.map(String).slice(0, 8) : [],
    signals: {
      match: score(signals.match),
      depth: score(signals.depth),
      promotion: score(signals.promotion),
      repetition: score(signals.repetition),
      sourceReliability: score(signals.sourceReliability),
    },
    segments,
    newKnowledge: knowledge(raw.newKnowledge),
    repeatedKnowledge: knowledge(raw.repeatedKnowledge),
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

export async function recoverInfiniTask(taskId: string, durationSeconds: number) {
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
        result: normalizeResult(parsed, durationSeconds),
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
    const recovery = await recoverInfiniTask(taskId, options.durationSeconds);
    if (recovery.result) return { taskId, ...recovery };
    for (const candidate of [...collected].reverse()) {
      const parsed = parseJsonCandidate(candidate);
      if (!parsed) continue;
      try {
        return {
          taskId,
          result: normalizeResult(parsed, options.durationSeconds),
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
        text: "上一份结果未通过 xianjian.v1 校验。请修复为严格 JSON，必须包含至少 3 个 startSeconds < endSeconds 的有效时间码片段，并覆盖写入 xianjian-result.json；最终回复只输出 JSON。",
      }),
      signal: controller.signal,
    });
    if (repairResponse.ok) {
      await readUntilCompletion();
      const repaired = await recoverInfiniTask(taskId, options.durationSeconds);
      if (repaired.result) return { taskId, ...repaired };
      for (const candidate of [...collected].reverse()) {
        const parsed = parseJsonCandidate(candidate);
        if (!parsed) continue;
        try {
          return {
            taskId,
            result: normalizeResult(parsed, options.durationSeconds),
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

export async function cancelInfiniTask(taskId: string) {
  return apiJson<unknown>(
    `/api/ai_task/cancelTask?taskId=${encodeURIComponent(taskId)}`,
    { method: "POST" }
  );
}
