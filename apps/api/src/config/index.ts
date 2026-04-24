import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_BASE_URL: z.string().url(),

  GHOST_MCP_URL: z.string().url(),
  GHOST_MCP_TOKEN: z.string().min(1),

  ROCKETRIDE_API_URL: z.string().url(),
  ROCKETRIDE_API_KEY: z.string().min(1),

  CALLBACK_SHARED_SECRET: z.string().min(32),
  DEEP_LINK_SIGNING_KEY: z.string().min(32),

  RESEND_API_KEY: z.string().min(1),

  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
});

export type Config = z.infer<typeof envSchema>;

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment config:\n  ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
