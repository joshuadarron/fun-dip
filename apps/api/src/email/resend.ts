import { Resend } from "resend";
import type { EmailClient } from "./client.js";

export interface ResendEmailClientOptions {
  apiKey: string;
  /** Verified sender address, e.g. `Fundip <noreply@fundip.app>`. */
  from: string;
}

/**
 * Production email client backed by Resend. The Resend SDK validates the
 * API key on first send. Connection lifetime is the SDK's responsibility;
 * we hold one client instance per process.
 *
 * The noop client in `./client.ts` remains the test default; this real
 * client is selected by `createApp` only when `NODE_ENV !== "test"` and
 * a Resend API key is present.
 */
export function createResendEmailClient(opts: ResendEmailClientOptions): EmailClient {
  if (!opts.apiKey) throw new Error("RESEND_API_KEY required");
  if (!opts.from) throw new Error("Resend `from` address required");
  const client = new Resend(opts.apiKey);
  return {
    async send(message) {
      const result = await client.emails.send({
        from: opts.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        ...(message.text ? { text: message.text } : {}),
      });
      if (result.error) {
        throw new Error(`resend send failed: ${result.error.message}`);
      }
      return { id: result.data?.id ?? "unknown" };
    },
  };
}
