import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Base64url-encode a Buffer without padding.
 */
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

export interface DeepLinkPayload {
  purpose: "submission_confirm" | "profile_edit";
  submission_id?: string;
  profile_id?: string;
  /** Epoch seconds. */
  exp: number;
  /** Opaque nonce for single-use enforcement at the callsite. */
  nonce?: string;
}

export function signDeepLinkToken(
  payload: Omit<DeepLinkPayload, "exp">,
  ttlSeconds: number,
  key: string,
): string {
  if (!key) throw new Error("DEEP_LINK_SIGNING_KEY required");
  if (ttlSeconds <= 0) throw new Error("ttlSeconds must be positive");
  const full: DeepLinkPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(full), "utf8"));
  const mac = macFor(payloadB64, key);
  return `${payloadB64}.${mac}`;
}

export type VerifyResult =
  | { ok: true; payload: DeepLinkPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyDeepLinkToken(
  token: string,
  key: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  if (!key) throw new Error("DEEP_LINK_SIGNING_KEY required");
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payloadB64, mac] = parts as [string, string];
  const expected = macFor(payloadB64, key);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(mac, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }
  let payload: DeepLinkPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as DeepLinkPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}
