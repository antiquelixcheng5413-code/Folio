import { env } from "cloudflare:workers";
import { ensureSchema, json } from "../../../lib/db";

export async function GET() {
  try {
    await ensureSchema();
    const runtime = env as unknown as Record<string, string | undefined>;
    return json({
      ok: true,
      database: "ready",
      infiniSynapse: runtime.INFINISYNAPSE_API_KEY ? "configured" : "missing_api_key",
      time: new Date().toISOString(),
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "health check failed" },
      { status: 500 }
    );
  }
}
