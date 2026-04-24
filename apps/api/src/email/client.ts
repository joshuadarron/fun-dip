export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailClient {
  send(message: EmailMessage): Promise<{ id: string }>;
}

/**
 * Real Resend-backed implementation lands in Phase 8 when digest +
 * missing-info emails actually need to go out. Until then, this stub
 * keeps the interface usable by the callback handlers without pulling
 * the SDK dependency.
 */
export function createNoopEmailClient(opts: { label?: string } = {}): EmailClient {
  const label = opts.label ?? "noop-email";
  return {
    async send(message) {
      console.log(`[${label}] would send`, { to: message.to, subject: message.subject });
      return { id: `stub-${Date.now().toString(36)}` };
    },
  };
}
