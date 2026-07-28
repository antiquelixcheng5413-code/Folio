import assert from "node:assert/strict";

const baseUrl =
  process.env.XIANJIAN_TEST_URL ||
  "https://xianjian-conference-os.sleek-shrew-6035.chatgpt.site";
const timeoutMs = Number(process.env.XIANJIAN_TIMEOUT_MS || 12 * 60 * 1000);

let cookie = "";

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const setCookie = response.headers.get("set-cookie");
  const sessionCookie = setCookie?.match(
    /(?:^|,\s*)(xianjian_session=[^;,\s]+)/,
  )?.[1];
  if (sessionCookie) cookie = sessionCookie;
  return response;
}

async function jsonRequest(path, init = {}) {
  const response = await request(path, init);
  const payload = await response.json();
  assert.ok(
    response.ok,
    `${path}: ${response.status} ${JSON.stringify(payload)}`,
  );
  return payload;
}

async function durableRequest(analysisId) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await jsonRequest(`/api/analyses/${analysisId}`);
    } catch (error) {
      lastError = error;
      console.log(
        JSON.stringify({
          event: "network-retry",
          attempt,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
  throw lastError;
}

function parseSseBlock(block) {
  let event = "message";
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (!data.length) return null;
  return { event, data: JSON.parse(data.join("\n")) };
}

const health = await jsonRequest("/api/health");
assert.equal(health.infiniSynapse, "configured");

const demo = await jsonRequest("/api/demo");
const meetingPayload = await jsonRequest("/api/meetings", {
  method: "POST",
  body: JSON.stringify({
    title: `${demo.demo.title} · 自动画像验证`,
    source: demo.demo.source,
    transcript: demo.demo.transcript,
  }),
});
const meetingId = meetingPayload.meeting.id;
assert.ok(meetingId);

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);
const response = await request(`/api/meetings/${meetingId}/analyze`, {
  method: "POST",
  signal: controller.signal,
});
assert.ok(response.ok, `Analyze request failed: ${response.status}`);
assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
assert.ok(response.body);

let buffer = "";
let analysisId = "";
let taskId = "";
let completed = null;
const reader = response.body.getReader();
const decoder = new TextDecoder();

try {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const message = parseSseBlock(block);
      if (!message) continue;
      analysisId = message.data.analysisId || analysisId;
      taskId = message.data.taskId || taskId;
      if (message.event === "progress") {
        console.log(
          JSON.stringify({
            event: "progress",
            stage: message.data.stage,
            taskId: taskId || null,
          }),
        );
      }
      if (message.event === "error") {
        throw new Error(
          `Analysis error: ${message.data.error}; taskId=${taskId || "none"}`,
        );
      }
      if (message.event === "completed") completed = message.data;
      if (message.event === "deduplicated") completed = message.data;
      if (message.event === "started") {
        console.log(
          JSON.stringify({
            event: "started",
            analysisId,
            taskId,
          }),
        );
      }
    }
  }
} finally {
  clearTimeout(timeout);
}

assert.ok(analysisId, "No analysisId received");
assert.ok(taskId, "No real taskId received");

let durable = await durableRequest(analysisId);
const recoveryDeadline = Date.now() + timeoutMs;
while (!durable.analysis.result && Date.now() < recoveryDeadline) {
  console.log(
    JSON.stringify({
      event: "recovering",
      status: durable.analysis.status,
      taskId: durable.analysis.taskId,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 8000));
  durable = await durableRequest(analysisId);
}
completed ||= {
  analysisId,
  taskId: durable.analysis.taskId,
  result: durable.analysis.result,
};
assert.ok(completed?.result, "No structured result received after recovery");
assert.ok(completed.result.segments.length >= 3, "Fewer than three segments");
assert.equal(durable.analysis.taskId, taskId);
assert.equal(durable.analysis.status, "completed");

console.log(
  JSON.stringify({
    ok: true,
    profileSource: "shelved-video-knowledge",
    meetingId,
    analysisId,
    taskId,
    verdict: completed.result.verdict,
    recommendedSeconds: completed.result.recommendedSeconds,
    savedSeconds: completed.result.savedSeconds,
    segments: completed.result.segments.map((segment) => ({
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      decision: segment.decision,
      title: segment.title,
    })),
  }),
);
