import { getD1, getSession, json } from "../../../../../lib/db";
import { cancelInfiniTask } from "../../../../../lib/infinisynapse";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);
  const { id } = await context.params;
  const db = getD1();
  const row = await db
    .prepare("SELECT task_id AS taskId FROM analyses WHERE id = ? AND session_id = ?")
    .bind(id, session.sessionId)
    .first<{ taskId: string | null }>();
  if (!row) return json({ error: "分析任务不存在" }, { status: 404 }, session.cookie);
  if (row.taskId) await cancelInfiniTask(row.taskId);
  await db
    .prepare(`UPDATE analyses SET status = 'cancelled', progress_text = '已取消',
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND session_id = ?`)
    .bind(id, session.sessionId)
    .run();
  return json({ analysis: { id, status: "cancelled" } }, {}, session.cookie);
}
