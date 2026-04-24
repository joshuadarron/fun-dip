import type { SubmissionStatus } from "@fundip/shared-types";
import { Badge } from "./ui/badge";

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  draft: "Draft",
  prefilled: "Prefilled",
  awaiting_user_input: "Awaiting input",
  ready: "Ready",
  submitting: "Submitting",
  submitted: "Submitted",
  awaiting_program_response: "Awaiting response",
  accepted: "Accepted",
  rejected: "Rejected",
  error: "Error",
};

export function StatusBadge({ status }: { status: SubmissionStatus }) {
  return (
    <Badge className={`status-badge status-${status.replace(/_/g, "-")}`}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
