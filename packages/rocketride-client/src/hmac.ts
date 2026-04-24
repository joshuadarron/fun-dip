import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";

export function signBody(body: string, secret: string): string {
  if (!secret) throw new Error("HMAC secret required");
  const mac = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return `${PREFIX}${mac}`;
}

export function verifySignature(body: string, header: string | undefined, secret: string): boolean {
  if (!secret) throw new Error("HMAC secret required");
  if (!header || !header.startsWith(PREFIX)) return false;
  const expected = signBody(body, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
