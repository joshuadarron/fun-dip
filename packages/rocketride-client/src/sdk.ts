import type { RocketRideClientLike } from "./invoker.js";

/**
 * Lazily load the real `rocketride` SDK and return a client that satisfies
 * `RocketRideClientLike`. The SDK is a runtime dependency of the `@fundip/api`
 * app, not of this package, to keep this package test-free from the SDK's
 * transitive deps. Install it in the app or alongside at the caller.
 *
 * Intentionally `Promise<RocketRideClientLike>` so tests and the non-happy
 * path (SDK not installed) can substitute a fake without module resolution
 * pain.
 */
export async function createRocketRideClient(opts: {
  uri: string;
  auth: string;
}): Promise<RocketRideClientLike> {
  // Dynamic import keeps the dep optional at this layer. The specifier is
  // kept in a variable so bundlers do not try to statically resolve it.
  const moduleName = "rocketride";
  let mod: { RocketRideClient: new (cfg: { uri: string; auth: string }) => RocketRideClientLike };
  try {
    mod = (await import(moduleName)) as typeof mod;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load "rocketride" SDK. Install it in the consuming app, e.g. ` +
        `"pnpm --filter @fundip/api add rocketride". Original error: ${reason}`,
    );
  }
  const client = new mod.RocketRideClient({ uri: opts.uri, auth: opts.auth });
  return client;
}
