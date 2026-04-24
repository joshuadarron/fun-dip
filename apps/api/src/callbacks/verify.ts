import { CALLBACK_SIGNATURE_HEADER } from "@fundip/shared-types";
import { verifySignature } from "@fundip/rocketride-client";
import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express middleware that requires a raw-body `X-Fundip-Signature` HMAC match
 * against `CALLBACK_SHARED_SECRET`. Must be mounted with a route-level
 * `express.raw({ type: "application/json" })` body parser so `req.body` is a
 * Buffer. After verification, the middleware replaces `req.body` with the
 * parsed JSON for downstream handlers.
 */
export function hmacCallbackMiddleware(secret: string): RequestHandler {
  if (!secret) throw new Error("CALLBACK_SHARED_SECRET required");
  return (req: Request, res: Response, next: NextFunction) => {
    const raw = req.body;
    if (!Buffer.isBuffer(raw)) {
      res.status(400).json({ error: "expected raw body" });
      return;
    }
    const header = req.header(CALLBACK_SIGNATURE_HEADER);
    const bodyText = raw.toString("utf8");
    if (!verifySignature(bodyText, header, secret)) {
      res.status(401).json({ error: "invalid signature" });
      return;
    }
    try {
      req.body = bodyText.length ? JSON.parse(bodyText) : {};
    } catch {
      res.status(400).json({ error: "invalid json" });
      return;
    }
    next();
  };
}
