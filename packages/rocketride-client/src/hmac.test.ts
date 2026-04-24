import { describe, expect, it } from "vitest";
import { signBody, verifySignature } from "./hmac.js";

const secret = "a".repeat(32);

describe("signBody", () => {
  it("produces a sha256= prefixed hex digest", () => {
    const sig = signBody('{"hello":"world"}', secret);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("is deterministic for the same body and secret", () => {
    const body = '{"a":1}';
    expect(signBody(body, secret)).toBe(signBody(body, secret));
  });

  it("differs when the body changes by one byte", () => {
    expect(signBody("a", secret)).not.toBe(signBody("b", secret));
  });

  it("throws when secret is empty", () => {
    expect(() => signBody("x", "")).toThrow(/secret required/);
  });
});

describe("verifySignature", () => {
  const body = '{"profile_id":"p1","match_count":3,"max_tier":"hot"}';
  const good = signBody(body, secret);

  it("accepts a valid signature", () => {
    expect(verifySignature(body, good, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifySignature(body + " ", good, secret)).toBe(false);
  });

  it("rejects a signature produced with a different secret", () => {
    const other = signBody(body, "b".repeat(32));
    expect(verifySignature(body, other, secret)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifySignature(body, undefined, secret)).toBe(false);
  });

  it("rejects a header without the sha256= prefix", () => {
    expect(verifySignature(body, good.slice(PREFIX_LENGTH), secret)).toBe(false);
  });
});

const PREFIX_LENGTH = "sha256=".length;
