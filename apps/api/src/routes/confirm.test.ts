import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { signDeepLinkToken } from "../deep-links/tokens.js";
import { signSession, SESSION_COOKIE_NAME } from "./auth.js";
import { createConfirmRouter } from "./confirm.js";

const signingKey = "k".repeat(40);

function mountApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(createConfirmRouter({ signingKey, sessionSigningKey: signingKey }));
  return app;
}

function validToken(): string {
  return signDeepLinkToken(
    { purpose: "submission_confirm", profile_id: "p1", submission_id: "s1" },
    600,
    signingKey,
  );
}

describe("GET /confirm", () => {
  it("renders 200 HTML with a POST form when token + submission are valid", async () => {
    const token = validToken();
    const res = await request(mountApp()).get(
      `/confirm?token=${encodeURIComponent(token)}&submission=s1`,
    );
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/html");
    expect(res.text).toContain("<form");
    expect(res.text).toContain('action="/confirm/submit"');
    expect(res.text).toContain(`value="${token}"`);
  });

  it("returns 400 HTML on missing submission query param", async () => {
    const token = validToken();
    const res = await request(mountApp()).get(`/confirm?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(400);
    expect(res.type).toBe("text/html");
  });

  it("returns 401 HTML when the token is expired", async () => {
    const expired = signDeepLinkToken(
      { purpose: "submission_confirm", profile_id: "p1", submission_id: "s1" },
      1,
      signingKey,
    );
    // Wait so the token's exp falls in the past relative to verifier's now.
    await new Promise((r) => setTimeout(r, 1100));
    const res = await request(mountApp()).get(
      `/confirm?token=${encodeURIComponent(expired)}&submission=s1`,
    );
    expect(res.status).toBe(401);
    expect(res.text).toContain("expired");
  });

  it("returns 400 HTML when the token is tampered (bad signature)", async () => {
    const token = validToken();
    const [payloadB64, mac] = token.split(".");
    const flipped = Buffer.from(payloadB64!, "utf8");
    flipped[0] = flipped[0]! ^ 0x01;
    const tampered = `${flipped.toString("utf8")}.${mac}`;
    const res = await request(mountApp()).get(
      `/confirm?token=${encodeURIComponent(tampered)}&submission=s1`,
    );
    expect(res.status).toBe(400);
    expect(res.text).toContain("not valid");
  });
});

describe("POST /confirm/submit", () => {
  it("requires an authenticated session (401 without cookie)", async () => {
    const token = validToken();
    const res = await request(mountApp()).post("/confirm/submit").type("form").send({
      token,
      submission: "s1",
      profile_id: "p1",
      program_id: "prog1",
    });
    expect(res.status).toBe(401);
  });

  it("requires both token AND session: still 503 when invoker is absent but auth passes and token is valid", async () => {
    const token = validToken();
    const session = signSession({ id: "u1", email: "a@b.test" }, signingKey);
    const res = await request(mountApp())
      .post("/confirm/submit")
      .set("Cookie", `${SESSION_COOKIE_NAME}=${session}`)
      .type("form")
      .send({
        token,
        submission: "s1",
        profile_id: "p1",
        program_id: "prog1",
      });
    // Auth passed, token verified, but no invoker mounted in this harness.
    expect(res.status).toBe(503);
  });

  it("rejects an expired token even with a valid session", async () => {
    const expired = signDeepLinkToken(
      { purpose: "submission_confirm", profile_id: "p1", submission_id: "s1" },
      1,
      signingKey,
    );
    await new Promise((r) => setTimeout(r, 1100));
    const session = signSession({ id: "u1", email: "a@b.test" }, signingKey);
    const res = await request(mountApp())
      .post("/confirm/submit")
      .set("Cookie", `${SESSION_COOKIE_NAME}=${session}`)
      .type("form")
      .send({
        token: expired,
        submission: "s1",
        profile_id: "p1",
        program_id: "prog1",
      });
    expect(res.status).toBe(401);
  });
});
