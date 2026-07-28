import { getD1, getSession, getWorkspaceSettings, json } from "../../../lib/db";

export async function GET(request: Request) {
  const session = await getSession(request);
  const settings = await getWorkspaceSettings(session.sessionId);
  return json({ settings }, {}, session.cookie);
}

export async function PATCH(request: Request) {
  const session = await getSession(request);
  const payload = (await request.json()) as {
    autoCreateNote?: unknown;
    autoDiscoverVideos?: unknown;
    autoAnalyzeDiscoveries?: unknown;
    titleMode?: unknown;
  };
  const booleanFields = ["autoCreateNote", "autoDiscoverVideos", "autoAnalyzeDiscoveries"] as const;
  const hasValidField = booleanFields.some((field) => field in payload) || "titleMode" in payload;
  const invalidBoolean = booleanFields.some((field) => field in payload && typeof payload[field] !== "boolean");
  const invalidTitleMode = "titleMode" in payload && !["automatic", "source"].includes(String(payload.titleMode));
  if (!hasValidField || invalidBoolean || invalidTitleMode) {
    return json({ error: "工作区设置无效" }, { status: 400 }, session.cookie);
  }
  const current = await getWorkspaceSettings(session.sessionId);
  const settings = {
    autoCreateNote: typeof payload.autoCreateNote === "boolean" ? payload.autoCreateNote : current.autoCreateNote,
    autoDiscoverVideos: typeof payload.autoDiscoverVideos === "boolean" ? payload.autoDiscoverVideos : current.autoDiscoverVideos,
    autoAnalyzeDiscoveries: typeof payload.autoAnalyzeDiscoveries === "boolean" ? payload.autoAnalyzeDiscoveries : current.autoAnalyzeDiscoveries,
    titleMode: payload.titleMode === "automatic" || payload.titleMode === "source" ? payload.titleMode : current.titleMode,
  };
  await getD1()
    .prepare(`UPDATE workspace_settings
      SET auto_create_note = ?, auto_discover_videos = ?, auto_analyze_discoveries = ?, title_mode = ?,
      updated_at = CURRENT_TIMESTAMP WHERE session_id = ?`)
    .bind(
      settings.autoCreateNote ? 1 : 0,
      settings.autoDiscoverVideos ? 1 : 0,
      settings.autoAnalyzeDiscoveries ? 1 : 0,
      settings.titleMode,
      session.sessionId
    )
    .run();
  return json({ settings }, {}, session.cookie);
}
