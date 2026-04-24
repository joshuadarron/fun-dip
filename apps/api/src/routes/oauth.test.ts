import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  buildSessionCookie,
  getRequestUser,
  readSessionCookie,
  requireAuth,
  signSession,
  SESSION_COOKIE_NAME,
  verifySession,
} from "./auth.js";
import { buildGoogleConsentUrl, createOAuthRouter, type GoogleTokenVerifier } from "./oauth.js";

const signingKey = "k".repeat(40);

function mountOAuthApp(verifier: GoogleTokenVerifier) {
  const app = express();
  app.use(
    createOAuthRouter({
      clientId: "client.test",
      redirectUri: "https://app.fundip.test/auth/google/callback",
      appBaseUrl: "https://app.fundip.test",
      sessionSigningKey: signingKey,
      verifier,
    }),
  );
  return app;
}

describe("buildGoogleConsentUrl", () => {
  it("includes client_id, redirect_uri, scope, and state", () => {
    const url = buildGoogleConsentUrl({
      clientId: "abc",
      redirectUri: "https://r/cb",
      state: "xyz",
    });
    expect(url).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    expect(url).toContain("client_id=abc");
    expect(url).toContain("redirect_uri=https%3A%2F%2Fr%2Fcb");
    expect(url).toContain("scope=openid+email+profile");
    expect(url).toContain("state=xyz");
  });
});

describe("GET /auth/google", () => {
  it("redirects to a Google consent URL", async () => {
    const verifier: GoogleTokenVerifier = { verifyCode: vi.fn() };
    const res = await request(mountOAuthApp(verifier)).get("/auth/google");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
  });
});

describe("GET /auth/google/callback", () => {
  it("verifies the code, sets a signed session cookie, and redirects to APP_BASE_URL", async () => {
    const verifier: GoogleTokenVerifier = {
      verifyCode: vi.fn(async () => ({
        sub: "google-uid-1",
        email: "founder@acme.test",
        email_verified: true,
        name: "Founder",
      })),
    };
    const res = await request(mountOAuthApp(verifier)).get(
      "/auth/google/callback?code=abc&state=s",
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://app.fundip.test");
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as unknown as string);
    expect(cookieStr).toContain(`${SESSION_COOKIE_NAME}=`);
    // Extract value and verify it parses back to our user.
    const match = cookieStr.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    expect(match).toBeTruthy();
    const verifyResult = verifySession(match![1], signingKey);
    expect(verifyResult.ok).toBe(true);
    if (verifyResult.ok) {
      expect(verifyResult.user.id).toBe("google-uid-1");
      expect(verifyResult.user.email).toBe("founder@acme.test");
    }
  });

  it("returns 401 when email is unverified", async () => {
    const verifier: GoogleTokenVerifier = {
      verifyCode: vi.fn(async () => ({
        sub: "google-uid-1",
        email: "founder@acme.test",
        email_verified: false,
      })),
    };
    const res = await request(mountOAuthApp(verifier)).get("/auth/google/callback?code=abc");
    expect(res.status).toBe(401);
  });

  it("returns 401 when verifier throws", async () => {
    const verifier: GoogleTokenVerifier = {
      verifyCode: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const res = await request(mountOAuthApp(verifier)).get("/auth/google/callback?code=abc");
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/logout", () => {
  it("clears the session cookie", async () => {
    const verifier: GoogleTokenVerifier = { verifyCode: vi.fn() };
    const res = await request(mountOAuthApp(verifier)).post("/auth/logout");
    expect(res.status).toBe(204);
    const setCookie = res.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as unknown as string);
    expect(cookieStr).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookieStr).toContain("Max-Age=0");
  });
});

describe("requireAuth middleware", () => {
  function withMw() {
    const app = express();
    app.get("/protected", requireAuth({ signingKey }), (req, res) => {
      res.json({ user: getRequestUser(req) });
    });
    return app;
  }

  it("attaches req.user when a valid session cookie is present", async () => {
    const app = withMw();
    const session = signSession({ id: "u1", email: "a@b.test" }, signingKey);
    const cookieHeader = buildSessionCookie(session);
    const res = await request(app).get("/protected").set("Cookie", cookieHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: "u1", email: "a@b.test" } });
  });

  it("401s when no cookie is present", async () => {
    const res = await request(withMw()).get("/protected");
    expect(res.status).toBe(401);
  });

  it("401s when the cookie signature is invalid", async () => {
    const session = signSession({ id: "u1", email: "a@b.test" }, "x".repeat(40));
    const res = await request(withMw())
      .get("/protected")
      .set("Cookie", `${SESSION_COOKIE_NAME}=${session}`);
    expect(res.status).toBe(401);
  });
});

describe("readSessionCookie", () => {
  it("reads the session value out of a Cookie header", () => {
    const fakeReq = {
      header: (name: string) =>
        name.toLowerCase() === "cookie" ? "other=1; fundip_session=abc.def; foo=bar" : undefined,
    } as unknown as Parameters<typeof readSessionCookie>[0];
    expect(readSessionCookie(fakeReq)).toBe("abc.def");
  });
});
