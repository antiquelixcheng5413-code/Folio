import { env } from "cloudflare:workers";
import { getD1 } from "./db";

export type InfiniUser = {
  id: string;
  email?: string | null;
  username?: string | null;
  nickname?: string | null;
  avatar?: string | null;
  phone?: string | null;
};

type PartnerEnvelope<T> = {
  code: number;
  message?: string;
  data?: T;
};

function authEnv() {
  const values = env as unknown as Record<string, string | undefined>;
  return {
    clientId: values.INFINI_CLIENT_ID?.trim() || "",
    clientSecret: values.INFINI_CLIENT_SECRET?.trim() || "",
    baseUrl: (values.INFINI_AUTH_BASE_URL?.trim() || "https://api.infinisynapse.cn/api").replace(/\/$/, ""),
  };
}

export function infiniAuthConfigured() {
  const config = authEnv();
  return Boolean(config.clientId && config.clientSecret);
}

async function partnerRequest<T>(path: string, init: RequestInit) {
  const config = authEnv();
  if (!config.clientId || !config.clientSecret) {
    throw new Error("InfiniSynapse 登录尚未配置");
  }
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": config.clientId,
      "X-Client-Secret": config.clientSecret,
      ...init.headers,
    },
  });
  const payload = await response.json() as PartnerEnvelope<T>;
  if (!response.ok || payload.code !== 200 || !payload.data) {
    throw new Error(payload.message || `InfiniSynapse 登录请求失败（${response.status}）`);
  }
  return payload.data;
}

export async function createInfiniLoginSession(input: {
  returnUrl: string;
  cancelUrl: string;
  state: string;
  sessionId: string;
}) {
  return partnerRequest<{ sessionId: string; entryUrl: string; expiresIn: number }>(
    "/auth/partner/sessions",
    {
      method: "POST",
      body: JSON.stringify({
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
        state: input.state,
        externalUserId: input.sessionId,
        metadata: { product: "Peek" },
      }),
    }
  );
}

export async function exchangeInfiniCode(code: string) {
  return partnerRequest<{ user: InfiniUser }>(
    "/auth/partner/token",
    {
      method: "POST",
      body: JSON.stringify({
        code,
        grant_type: "authorization_code",
      }),
    }
  );
}

export async function accountForSession(sessionId: string) {
  return getD1()
    .prepare(`SELECT infini_user_id AS id, email, username, nickname, avatar, phone
      FROM auth_users WHERE session_id = ?`)
    .bind(sessionId)
    .first<InfiniUser>();
}

export async function bindInfiniUser(currentSessionId: string, user: InfiniUser) {
  if (!user.id) throw new Error("InfiniSynapse 未返回有效用户 ID");
  const db = getD1();
  const existing = await db
    .prepare("SELECT session_id AS sessionId FROM auth_users WHERE infini_user_id = ?")
    .bind(user.id)
    .first<{ sessionId: string }>();
  const targetSessionId = existing?.sessionId || currentSessionId;

  if (targetSessionId !== currentSessionId) {
    await db.batch([
      db.prepare("UPDATE meetings SET session_id = ? WHERE session_id = ?").bind(targetSessionId, currentSessionId),
      db.prepare("UPDATE analyses SET session_id = ? WHERE session_id = ?").bind(targetSessionId, currentSessionId),
      db.prepare("UPDATE notes SET session_id = ? WHERE session_id = ?").bind(targetSessionId, currentSessionId),
      db.prepare("UPDATE knowledge_items SET session_id = ? WHERE session_id = ?").bind(targetSessionId, currentSessionId),
      db.prepare("UPDATE discovery_candidates SET session_id = ? WHERE session_id = ?").bind(targetSessionId, currentSessionId),
      db.prepare("UPDATE analysis_translations SET session_id = ? WHERE session_id = ?").bind(targetSessionId, currentSessionId),
    ]);
  }

  await db
    .prepare("DELETE FROM auth_users WHERE session_id = ? AND infini_user_id <> ?")
    .bind(currentSessionId, user.id)
    .run();
  await db
    .prepare(`INSERT INTO auth_users
      (infini_user_id, session_id, email, username, nickname, avatar, phone)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(infini_user_id) DO UPDATE SET
        email = excluded.email,
        username = excluded.username,
        nickname = excluded.nickname,
        avatar = excluded.avatar,
        phone = excluded.phone,
        updated_at = CURRENT_TIMESTAMP`)
    .bind(
      user.id,
      targetSessionId,
      user.email || null,
      user.username || null,
      user.nickname || null,
      user.avatar || null,
      user.phone || null
    )
    .run();
  return targetSessionId;
}

export function sessionCookie(sessionId: string) {
  return `xianjian_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}
