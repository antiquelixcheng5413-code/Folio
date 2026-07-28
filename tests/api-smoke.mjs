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
const defaultSettings = await request("/api/settings", {}, cookie);
assert.equal(defaultSettings.payload.settings.autoCreateNote, true);
assert.equal(defaultSettings.payload.settings.autoDiscoverVideos, false);
assert.equal(defaultSettings.payload.settings.autoAnalyzeDiscoveries, false);
assert.equal(defaultSettings.payload.settings.titleMode, "automatic");
const sourceTitleSettings = await request(
  "/api/settings",
  { method: "PATCH", body: JSON.stringify({ titleMode: "source" }) },
  cookie,
);
assert.equal(sourceTitleSettings.payload.settings.titleMode, "source");
const automaticTitleSettings = await request(
  "/api/settings",
  { method: "PATCH", body: JSON.stringify({ titleMode: "automatic" }) },
  cookie,
);
assert.equal(automaticTitleSettings.payload.settings.titleMode, "automatic");
const discoveryEnabledSettings = await request(
  "/api/settings",
  { method: "PATCH", body: JSON.stringify({ autoDiscoverVideos: true, autoAnalyzeDiscoveries: true }) },
  cookie,
);
assert.equal(discoveryEnabledSettings.payload.settings.autoDiscoverVideos, true);
assert.equal(discoveryEnabledSettings.payload.settings.autoAnalyzeDiscoveries, true);
const discoveryDisabledSettings = await request(
  "/api/settings",
  { method: "PATCH", body: JSON.stringify({ autoDiscoverVideos: false, autoAnalyzeDiscoveries: false }) },
  cookie,
);
assert.equal(discoveryDisabledSettings.payload.settings.autoDiscoverVideos, false);
assert.equal(discoveryDisabledSettings.payload.settings.autoAnalyzeDiscoveries, false);
const disabledSettings = await request(
  "/api/settings",
  { method: "PATCH", body: JSON.stringify({ autoCreateNote: false }) },
  cookie,
);
assert.equal(disabledSettings.payload.settings.autoCreateNote, false);
const enabledSettings = await request(
  "/api/settings",
  { method: "PATCH", body: JSON.stringify({ autoCreateNote: true }) },
  cookie,
);
assert.equal(enabledSettings.payload.settings.autoCreateNote, true);
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

const videoMeetingResponse = await request(
  "/api/meetings",
  {
    method: "POST",
    body: JSON.stringify({
      title: "播放链接验收视频",
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    }),
  },
  cookie,
);
assert.equal(videoMeetingResponse.payload.meeting.videoUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
const videoLibrary = await request("/api/library?view=meetings", {}, cookie);
assert.ok(videoLibrary.payload.items.some((item) => item.id === videoMeetingResponse.payload.meeting.id && item.videoUrl));

const articleMeetingResponse = await request(
  "/api/meetings",
  {
    method: "POST",
    body: JSON.stringify({
      title: "原文定位验收文章",
      contentType: "article",
      contentUrl: "https://example.com/research/article",
    }),
  },
  cookie,
);
assert.equal(articleMeetingResponse.payload.meeting.contentType, "article");
assert.equal(articleMeetingResponse.payload.meeting.contentUrl, "https://example.com/research/article");
const articleLibrary = await request("/api/library?view=meetings", {}, cookie);
assert.ok(articleLibrary.payload.items.some((item) => item.id === articleMeetingResponse.payload.meeting.id && item.contentType === "article" && item.contentUrl));

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
  automaticNotesSetting: true,
  videoUrlPersisted: true,
  articleUrlPersisted: true,
  titleModeSetting: true,
  automaticDiscoverySettings: true,
}));
