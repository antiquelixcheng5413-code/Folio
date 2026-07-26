import assert from "node:assert/strict";

const baseUrl = process.env.XIANJIAN_TEST_URL || "http://localhost:3001";

async function request(path, init = {}, cookie = "") {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json();
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(payload)}`);
  return { payload, cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie };
}

const demoResponse = await request("/api/demo");
const cookie = demoResponse.cookie;
const meetingResponse = await request(
  "/api/meetings",
  {
    method: "POST",
    body: JSON.stringify({
      title: "笔记接口验收会议",
      source: "自动验收",
      transcript: demoResponse.payload.demo.transcript,
    }),
  },
  cookie,
);
const meetingId = meetingResponse.payload.meeting.id;
assert.ok(meetingId);

const noteResponse = await request(
  "/api/notes",
  {
    method: "POST",
    body: JSON.stringify({
      meetingId,
      segmentId: "seg-test",
      timecodeSeconds: 80,
      content: "第一版时间码笔记",
    }),
  },
  cookie,
);
const noteId = noteResponse.payload.note.id;
assert.ok(noteId);

const patchResponse = await request(
  `/api/notes/${noteId}`,
  { method: "PATCH", body: JSON.stringify({ content: "已更新的时间码笔记" }) },
  cookie,
);
assert.equal(patchResponse.payload.note.content, "已更新的时间码笔记");

const listResponse = await request("/api/library?view=notes", {}, cookie);
assert.ok(listResponse.payload.items.some((item) => item.id === noteId));

const deleteResponse = await request(
  `/api/notes/${noteId}`,
  { method: "DELETE" },
  cookie,
);
assert.equal(deleteResponse.payload.deleted, true);

console.log(JSON.stringify({
  meetingCreated: true,
  noteCreated: true,
  noteUpdated: true,
  noteListed: true,
  noteDeleted: true,
}));
