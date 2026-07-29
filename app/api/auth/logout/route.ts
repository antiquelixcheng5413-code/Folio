import { ensureSchema, getD1, json } from "../../../../lib/db";
import { sessionCookie } from "../../../../lib/auth";

export async function POST() {
  await ensureSchema();
  const sessionId = crypto.randomUUID();
  await getD1().prepare("INSERT INTO sessions (id) VALUES (?)").bind(sessionId).run();
  return json({ ok: true }, {}, sessionCookie(sessionId));
}

