import type { UUID } from "@fundip/shared-types";
import { DEV_CONVERSATION_ID, DEV_PROFILE_ID, DEV_USER_ID } from "../config/dev";

export interface CurrentUser {
  user_id: UUID;
  profile_id: UUID;
  conversation_id: UUID;
}

/**
 * Stubbed auth hook. Replaced in Phase 8 when Google OAuth lands.
 * Returns hardcoded dev ids so the UI can render end-to-end without
 * a real auth session.
 */
export function useCurrentUser(): CurrentUser {
  return {
    user_id: DEV_USER_ID,
    profile_id: DEV_PROFILE_ID,
    conversation_id: DEV_CONVERSATION_ID,
  };
}
