import { useLocation } from "react-router-dom";
import type { PageContext } from "@fundip/shared-types";

/**
 * Maps the current router location to the `PageContext` enum the chat
 * pipeline and Ghost `messages.page_context` field expect.
 * Default to `"dashboard"` for unknown paths.
 */
export function useCurrentPage(): PageContext {
  const { pathname } = useLocation();
  if (pathname.startsWith("/profile")) return "profile";
  if (pathname.startsWith("/programs")) return "programs";
  if (pathname.startsWith("/submissions")) return "submissions";
  return "dashboard";
}
