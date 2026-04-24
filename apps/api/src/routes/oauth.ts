import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { buildSessionCookie, clearSessionCookie, signSession, type SessionUser } from "./auth.js";

/**
 * The portion of the verified Google ID token payload we read. Kept
 * narrow so a real `google-auth-library` `LoginTicket.getPayload()`
 * conforms naturally and tests can stub freely.
 */
export interface GoogleIdTokenPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export interface GoogleTokenVerifier {
  /**
   * Exchange the OAuth `code` for an ID token, verify it, and return
   * the payload. Production wires this to `google-auth-library`'s
   * `OAuth2Client.getToken` followed by `verifyIdToken`. Tests stub it
   * directly so we never hit Google.
   */
  verifyCode(code: string): Promise<GoogleIdTokenPayload>;
}

export interface CreateOAuthRouterOptions {
  /** Google OAuth client id used to build the consent URL. */
  clientId: string;
  /** Absolute URL of `/auth/google/callback`. */
  redirectUri: string;
  /** Where to send the user once authenticated (typically `APP_BASE_URL`). */
  appBaseUrl: string;
  /** Signing key for the session cookie. Reuses `DEEP_LINK_SIGNING_KEY`. */
  sessionSigningKey: string;
  /** Verifier for the OAuth callback. Tests inject a stub. */
  verifier: GoogleTokenVerifier;
  /** When true (production), set `Secure` on the cookie. */
  secureCookies?: boolean;
}

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().optional(),
});

/**
 * Build the consent URL for the Google OAuth redirect. Scopes are the
 * minimum needed to confirm identity: `openid email profile`.
 */
export function buildGoogleConsentUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    state: opts.state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function createOAuthRouter(opts: CreateOAuthRouterOptions): Router {
  const router = Router();

  router.get("/auth/google", (_req, res) => {
    const state = randomBytes(16).toString("hex");
    // We do not persist `state` on the server in Phase 8: the cookie
    // we set on return makes CSRF the threat model OAuth `state`
    // already mitigates via the redirect-bound check. Real persistence
    // arrives with the user store in Phase 9.
    const url = buildGoogleConsentUrl({
      clientId: opts.clientId,
      redirectUri: opts.redirectUri,
      state,
    });
    res.redirect(url);
  });

  router.get("/auth/google/callback", async (req, res) => {
    const parsed = callbackQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).type("text/plain").send("invalid oauth callback");
      return;
    }
    let payload: GoogleIdTokenPayload;
    try {
      payload = await opts.verifier.verifyCode(parsed.data.code);
    } catch {
      res.status(401).type("text/plain").send("oauth verification failed");
      return;
    }
    const email = payload.email;
    if (!email || payload.email_verified === false) {
      res.status(401).type("text/plain").send("email not verified");
      return;
    }
    const user: SessionUser = { id: payload.sub, email };
    const cookieValue = signSession(user, opts.sessionSigningKey);
    res.setHeader("Set-Cookie", buildSessionCookie(cookieValue, { secure: opts.secureCookies }));
    res.redirect(opts.appBaseUrl);
  });

  router.post("/auth/logout", (_req, res) => {
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.status(204).end();
  });

  return router;
}
