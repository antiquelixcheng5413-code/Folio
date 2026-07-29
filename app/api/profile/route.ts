import { getD1, getSession, json } from "../../../lib/db";
import type { LearningProfile } from "../../../lib/types";

export async function GET(request: Request) {
  const session = await getSession(request);
  const profile = await getD1()
    .prepare(`SELECT direction, level, project, known_topics AS knownTopics,
      preferences FROM profiles WHERE session_id = ?`)
    .bind(session.sessionId)
    .first<LearningProfile>();
  return json({ profile }, {}, session.cookie);
}

export async function PATCH(request: Request) {
  const session = await getSession(request);
  const payload = (await request.json()) as Partial<LearningProfile>;
  const fields: Array<Exclude<keyof LearningProfile, "skills">> = [
    "direction",
    "level",
    "project",
    "knownTopics",
    "preferences",
  ];
  const current = await getD1()
    .prepare(`SELECT direction, level, project, known_topics AS knownTopics,
      preferences FROM profiles WHERE session_id = ?`)
    .bind(session.sessionId)
    .first<LearningProfile>();
  const next = { ...current } as LearningProfile;
  for (const field of fields) {
    if (typeof payload[field] === "string") {
      next[field] = payload[field]!.trim().slice(0, 1200);
    }
  }
  if (fields.some((field) => !next[field])) {
    return json({ error: "个人画像字段不能为空" }, { status: 400 }, session.cookie);
  }
  await getD1()
    .prepare(`UPDATE profiles SET direction = ?, level = ?, project = ?,
      known_topics = ?, preferences = ?, updated_at = CURRENT_TIMESTAMP
      WHERE session_id = ?`)
    .bind(
      next.direction,
      next.level,
      next.project,
      next.knownTopics,
      next.preferences,
      session.sessionId
    )
    .run();
  return json({ profile: next }, {}, session.cookie);
}
