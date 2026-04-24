import type { GoogleIdTokenPayload, GoogleTokenVerifier } from "./oauth.js";

/**
 * Build a `GoogleTokenVerifier` backed by `google-auth-library`. The
 * SDK is loaded lazily so that tests (which do not exercise this code
 * path) and dev environments without the full Google config can boot
 * without paying its import cost. Mirrors the lazy-import pattern Phase
 * 3 used for `@modelcontextprotocol/sdk`.
 */
export interface RealVerifierOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function createRealGoogleVerifier(opts: RealVerifierOptions): GoogleTokenVerifier {
  return {
    async verifyCode(code: string): Promise<GoogleIdTokenPayload> {
      const { OAuth2Client } = await import("google-auth-library");
      const client = new OAuth2Client(opts.clientId, opts.clientSecret, opts.redirectUri);
      const { tokens } = await client.getToken(code);
      const idToken = tokens.id_token;
      if (!idToken) {
        throw new Error("google oauth response missing id_token");
      }
      const ticket = await client.verifyIdToken({
        idToken,
        audience: opts.clientId,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub) {
        throw new Error("google id token missing sub");
      }
      return {
        sub: payload.sub,
        ...(payload.email != null ? { email: payload.email } : {}),
        ...(payload.email_verified != null ? { email_verified: payload.email_verified } : {}),
        ...(payload.name != null ? { name: payload.name } : {}),
      };
    },
  };
}
