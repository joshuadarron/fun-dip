import type { MatchTier } from "@fundip/shared-types";
import { Badge } from "./ui/badge";

const TIER_LABEL: Record<MatchTier, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
};

export function TierBadge({ tier }: { tier: MatchTier }) {
  return <Badge className={`tier-badge tier-${tier}`}>{TIER_LABEL[tier]}</Badge>;
}
