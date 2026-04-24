import { describe, expect, it } from "vitest";
import { signDeepLinkToken, verifyDeepLinkToken } from "./tokens.js";

const key = "k".repeat(32);

describe("deep link tokens", () => {
  it("round-trips a signed payload", () => {
    const token = signDeepLinkToken(
      { purpose: "submission_confirm", submission_id: "s1" },
      600,
      key,
    );
    const res = verifyDeepLinkToken(token, key);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.payload.purpose).toBe("submission_confirm");
      expect(res.payload.submission_id).toBe("s1");
      expect(res.payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    }
  });

  it("rejects a tampered payload", () => {
    const token = signDeepLinkToken({ purpose: "submission_confirm" }, 600, key);
    const [payload, mac] = token.split(".");
    const flipped = Buffer.from(payload!, "utf8");
    flipped[0] = flipped[0]! ^ 0x01;
    const bad = `${flipped.toString("utf8")}.${mac}`;
    expect(verifyDeepLinkToken(bad, key)).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("rejects a token signed with a different key", () => {
    const token = signDeepLinkToken({ purpose: "profile_edit" }, 600, key);
    const res = verifyDeepLinkToken(token, "x".repeat(32));
    expect(res).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("rejects an expired token", () => {
    const token = signDeepLinkToken({ purpose: "submission_confirm" }, 60, key);
    const res = verifyDeepLinkToken(token, key, Math.floor(Date.now() / 1000) + 120);
    expect(res).toMatchObject({ ok: false, reason: "expired" });
  });

  it("rejects a malformed token", () => {
    expect(verifyDeepLinkToken("not-a-token", key)).toMatchObject({
      ok: false,
      reason: "malformed",
    });
  });

  it("throws when ttl is not positive", () => {
    expect(() => signDeepLinkToken({ purpose: "profile_edit" }, 0, key)).toThrow(/ttl/);
  });
});
