import type { DatabaseClient } from "../database/client";
import { createId, nowIso } from "../database/ids";

export const ADMIN_SESSION_COOKIE = "luma_admin_session";
const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;
const MIN_SESSION_TTL_SECONDS = 60 * 60;
const MAX_SESSION_TTL_SECONDS = 24 * 60 * 60;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_COOLDOWN_MS = 5 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;

export type AdminAuthErrorCode =
  | "not_configured"
  | "invalid_credentials"
  | "rate_limited"
  | "unauthorized"
  | "csrf_required";

export class AdminAuthError extends Error {
  readonly code: AdminAuthErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(code: AdminAuthErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "AdminAuthError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface AdminAuthEnvironment {
  readonly ADMIN_AUTH_SECRET?: string;
  readonly ADMIN_SESSION_TTL_SECONDS?: string;
  readonly LUMA_ENVIRONMENT?: string;
}

export interface AdminSession {
  readonly id: string;
  readonly tokenHash: string;
  readonly csrfTokenHash: string;
  readonly secretFingerprint: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastSeenAt: string;
  readonly revokedAt: string | null;
}

export interface LoginResult {
  readonly session: AdminSession;
  readonly csrfToken: string;
  readonly setCookie: string;
}

interface SessionRow {
  id: string;
  token_hash: string;
  csrf_token_hash: string;
  secret_fingerprint: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

interface LoginBucketRow {
  identity_hash: string;
  failed_count: number;
  first_failed_at: string;
  cooldown_until: string | null;
  updated_at: string;
}

function mapSession(row: SessionRow): AdminSession {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    csrfTokenHash: row.csrf_token_hash,
    secretFingerprint: row.secret_fingerprint,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function parseCookies(header: string | null): Readonly<Record<string, string>> {
  if (!header) return {};
  const values: Record<string, string> = {};
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (name.length > 0) values[name] = value;
  }
  return values;
}

function parseTtl(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_SESSION_TTL_SECONDS || parsed > MAX_SESSION_TTL_SECONDS) {
    return DEFAULT_SESSION_TTL_SECONDS;
  }
  return parsed;
}

function requestIdentity(request: Request): string {
  const forwarded = request.headers.get("CF-Connecting-IP")
    ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    ?? "unknown";
  return forwarded.slice(0, 128);
}

function isLocalRequest(request: Request, environment: string | undefined): boolean {
  if (environment === "local") return true;
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function cookieValue(token: string, request: Request, ttlSeconds: number, environment: string | undefined): string {
  const secure = isLocalRequest(request, environment) ? "" : " Secure;";
  return `${ADMIN_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict;${secure} Max-Age=${ttlSeconds}`;
}

export class AdminAuthService {
  private readonly secret: string;
  private readonly ttlSeconds: number;
  private readonly environment: string | undefined;

  constructor(
    private readonly database: DatabaseClient,
    environment: AdminAuthEnvironment,
  ) {
    this.secret = environment.ADMIN_AUTH_SECRET?.trim() ?? "";
    this.ttlSeconds = parseTtl(environment.ADMIN_SESSION_TTL_SECONDS);
    this.environment = environment.LUMA_ENVIRONMENT;
  }

  get configured(): boolean {
    return this.secret.length >= 32;
  }

  async login(request: Request, accessKey: string): Promise<LoginResult> {
    if (!this.configured) {
      throw new AdminAuthError("not_configured", "admin authentication is not configured");
    }

    const fingerprint = await sha256Hex(this.secret);
    const identityHash = await sha256Hex(`admin-login:${fingerprint}:${requestIdentity(request)}`);
    const now = Date.now();
    const bucket = await this.database
      .prepare("SELECT * FROM admin_login_buckets WHERE identity_hash = ?")
      .bind(identityHash)
      .first<LoginBucketRow>();

    if (bucket?.cooldown_until && Date.parse(bucket.cooldown_until) > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(bucket.cooldown_until) - now) / 1000));
      throw new AdminAuthError("rate_limited", "too many failed login attempts", retryAfterSeconds);
    }

    const candidateHash = await sha256Hex(typeof accessKey === "string" ? accessKey : "");
    const valid = constantTimeEqual(candidateHash, fingerprint);
    if (!valid) {
      await this.recordFailure(identityHash, bucket, now);
      throw new AdminAuthError("invalid_credentials", "invalid operator access key");
    }

    await this.database.prepare("DELETE FROM admin_login_buckets WHERE identity_hash = ?").bind(identityHash).run();
    const rawSessionToken = randomToken();
    const rawCsrfToken = randomToken();
    const timestamp = new Date(now).toISOString();
    const expiresAt = new Date(now + this.ttlSeconds * 1000).toISOString();
    const sessionId = createId("admin-session");
    const session: AdminSession = {
      id: sessionId,
      tokenHash: await sha256Hex(rawSessionToken),
      csrfTokenHash: await sha256Hex(rawCsrfToken),
      secretFingerprint: fingerprint,
      createdAt: timestamp,
      expiresAt,
      lastSeenAt: timestamp,
      revokedAt: null,
    };

    await this.database.prepare(
      `INSERT INTO admin_sessions (
        id, token_hash, csrf_token_hash, secret_fingerprint,
        created_at, expires_at, last_seen_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}')`,
    ).bind(
      session.id,
      session.tokenHash,
      session.csrfTokenHash,
      session.secretFingerprint,
      session.createdAt,
      session.expiresAt,
      session.lastSeenAt,
    ).run();

    return {
      session,
      csrfToken: rawCsrfToken,
      setCookie: cookieValue(rawSessionToken, request, this.ttlSeconds, this.environment),
    };
  }

  async authenticate(request: Request): Promise<AdminSession | null> {
    if (!this.configured) return null;
    const rawToken = parseCookies(request.headers.get("cookie"))[ADMIN_SESSION_COOKIE];
    if (!rawToken) return null;
    const tokenHash = await sha256Hex(rawToken);
    const row = await this.database.prepare(
      `SELECT * FROM admin_sessions
       WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
       LIMIT 1`,
    ).bind(tokenHash, nowIso()).first<SessionRow>();
    if (!row) return null;

    const fingerprint = await sha256Hex(this.secret);
    if (!constantTimeEqual(row.secret_fingerprint, fingerprint)) {
      await this.revoke(row.id);
      return null;
    }

    await this.database.prepare(
      "UPDATE admin_sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL",
    ).bind(nowIso(), row.id).run();
    return mapSession(row);
  }

  async requireSession(request: Request): Promise<AdminSession> {
    if (!this.configured) {
      throw new AdminAuthError("not_configured", "admin authentication is not configured");
    }
    const session = await this.authenticate(request);
    if (!session) throw new AdminAuthError("unauthorized", "admin session is missing or expired");
    return session;
  }

  async issueCsrfToken(session: AdminSession): Promise<string> {
    const rawToken = randomToken();
    await this.database.prepare(
      "UPDATE admin_sessions SET csrf_token_hash = ?, last_seen_at = ? WHERE id = ? AND revoked_at IS NULL",
    ).bind(await sha256Hex(rawToken), nowIso(), session.id).run();
    return rawToken;
  }

  async requireCsrf(request: Request, session: AdminSession): Promise<void> {
    const supplied = request.headers.get("X-CSRF-Token");
    if (!supplied) throw new AdminAuthError("csrf_required", "CSRF token is required");
    const suppliedHash = await sha256Hex(supplied);
    const row = await this.database.prepare(
      "SELECT csrf_token_hash FROM admin_sessions WHERE id = ? AND revoked_at IS NULL",
    ).bind(session.id).first<{ csrf_token_hash: string }>();
    if (!row || !constantTimeEqual(row.csrf_token_hash, suppliedHash)) {
      throw new AdminAuthError("csrf_required", "CSRF token is invalid or expired");
    }
  }

  async revoke(id: string): Promise<void> {
    await this.database.prepare(
      "UPDATE admin_sessions SET revoked_at = ?, last_seen_at = ? WHERE id = ? AND revoked_at IS NULL",
    ).bind(nowIso(), nowIso(), id).run();
  }

  clearCookie(request: Request): string {
    const secure = isLocalRequest(request, this.environment) ? "" : " Secure;";
    return `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict;${secure} Max-Age=0`;
  }

  private async recordFailure(
    identityHash: string,
    bucket: LoginBucketRow | null,
    now: number,
  ): Promise<void> {
    const timestamp = new Date(now).toISOString();
    const withinWindow = bucket !== null && now - Date.parse(bucket.first_failed_at) <= LOGIN_WINDOW_MS;
    const failedCount = withinWindow ? bucket.failed_count + 1 : 1;
    const firstFailedAt = withinWindow ? bucket.first_failed_at : timestamp;
    const cooldownUntil = failedCount >= LOGIN_FAILURE_LIMIT
      ? new Date(now + LOGIN_COOLDOWN_MS).toISOString()
      : null;
    await this.database.prepare(
      `INSERT INTO admin_login_buckets (
        identity_hash, failed_count, first_failed_at, cooldown_until, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(identity_hash) DO UPDATE SET
        failed_count = excluded.failed_count,
        first_failed_at = excluded.first_failed_at,
        cooldown_until = excluded.cooldown_until,
        updated_at = excluded.updated_at`,
    ).bind(identityHash, failedCount, firstFailedAt, cooldownUntil, timestamp).run();
  }
}

export function withAdminSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function sessionCookieHeader(result: LoginResult, request: Request, environment?: string): string {
  const secure = isLocalRequest(request, environment) ? "" : " Secure;";
  return result.setCookie.replace(" Secure;", secure);
}
