import { accountForSession, infiniAuthConfigured } from "../../../../lib/auth";
import { getSession, json } from "../../../../lib/db";

export async function GET(request: Request) {
  const session = await getSession(request);
  const user = await accountForSession(session.sessionId);
  return json({
    configured: infiniAuthConfigured(),
    authenticated: Boolean(user),
    user: user || null,
  }, {}, session.cookie);
}

