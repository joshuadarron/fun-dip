import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Phase 8 session shape. We do not have a user store yet; the OAuth
 * callback builds this directly from the verified Google ID token.
 * Replace with a proper user record once Phase 9 introduces one.
 */
export interface SessionUser {
  id: string;
  email: string;
}

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_COOKIE_NAME = "fundip_session";

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text: string): Buffer {
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  return Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function macFor(payloadB64: string, key: string): string {
  return createHmac("sha256", key).update(payloadB64, "utf8").digest("hex");
}

/**
 * Sign a session cookie. Uses the same HMAC primitive as deep-link
 * tokens. Payload includes `exp` for server-side rejection on expiry.
 */
export function signSession(
  user: SessionUser,
  key: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  if (!key) throw new Error("DEEP_LINK_SIGNING_KEY required");
  const payload = {
    id: user.id,
    email: user.email,
    exp: nowSeconds + SESSION_TTL_SECONDS,
  };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const mac = macFor(payloadB64, key);
  return `${payloadB64}.${mac}`;
}

export type VerifySessionResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "expired" };

export function verifySession(
  cookie: string | undefined,
  key: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifySessionResult {
  if (!cookie) return { ok: false, reason: "missing" };
  const parts = cookie.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payloadB64, mac] = parts as [string, string];
  const expected = macFor(payloadB64, key);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(mac, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }
  let payload: { id?: unknown; email?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as typeof payload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload.id !== "string" || typeof payload.email !== "string") {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, user: { id: payload.id, email: payload.email } };
}

/**
 * Read the session cookie out of a `Cookie:` header. Tiny parser:
 * Express's cookie-parser is not in the deps, and we only need one
 * known name. RFC 6265 says cookies are `name=value; name=value`.
 */
export function readSessionCookie(req: Request): string | undefined {
  const header = req.header("cookie");
  if (!header) return undefined;
  for (const piece of header.split(";")) {
    const [rawName, ...rest] = piece.trim().split("=");
    if (rawName === SESSION_COOKIE_NAME) {
      return rest.join("=");
    }
  }
  return undefined;
}

export function buildSessionCookie(value: string, opts: { secure?: boolean } = {}): string {
  const secure = opts.secure ?? false;
  const flags = [
    `${SESSION_COOKIE_NAME}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${String(SESSION_TTL_SECONDS)}`,
  ];
  if (secure) flags.push("Secure");
  return flags.join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Read `req.user` after `requireAuth` has run. Avoids a global module
 * augmentation: the middleware writes the user to `(req as any).user`
 * via this helper, callers read it back through the typed accessor.
 */
export function getRequestUser(req: Request): SessionUser | undefined {
  return (req as Request & { user?: SessionUser }).user;
}

export interface RequireAuthOptions {
  signingKey: string;
}

/**
 * Require an authenticated session cookie. Attaches the verified
 * `SessionUser` to the request (read it back via `getRequestUser`).
 * Responds with 401 JSON on any failure.
 *
 * Mounted on routes that need both a signed deep-link token and an
 * authenticated session per `.claude/docs/ARCHITECTURE.md` rule 13:
 * the confirmation page POST handler and `POST /api/submissions/:id/submit`.
 */
export function requireAuth(opts: RequireAuthOptions): RequestHandler {
  if (!opts.signingKey) throw new Error("session signing key required");
  return (req: Request, res: Response, next: NextFunction) => {
    const cookie = readSessionCookie(req);
    const result = verifySession(cookie, opts.signingKey);
    if (!result.ok) {
      res.status(401).json({ error: "unauthorized", reason: result.reason });
      return;
    }
    (req as Request & { user?: SessionUser }).user = result.user;
    next();
  };
}
