import { useMutation, useQuery } from "@tanstack/react-query";
import type { UUID } from "@fundip/shared-types";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { PageHeader } from "../../components/PageHeader";
import { ScoreMeter } from "../../components/ScoreMeter";
import { TierBadge } from "../../components/TierBadge";
import {
  graphqlRequest,
  ProgramMatchesQuery,
  type ProgramMatchesQueryResult,
  type ProgramMatchesQueryVariables,
  type ProgramMatchWithProgram,
} from "../../lib/graphql";
import { fetcher, FetcherError } from "../../lib/fetcher";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useSelection } from "../../context/selection-context-internal";
import { useToast } from "../../context/toast-context-internal";

interface PrefillResponse {
  submission_id: UUID;
  status: string;
}

interface PrefillInput {
  program_id: UUID;
  profile_id: UUID;
  program_match_id: UUID;
}

export function ProgramsPage() {
  const { profile_id } = useCurrentUser();
  const { selection, setSelection } = useSelection();
  const { pushToast } = useToast();

  const matchesQuery = useQuery({
    queryKey: ["programMatches", profile_id],
    queryFn: () =>
      graphqlRequest<ProgramMatchesQueryResult, ProgramMatchesQueryVariables>(ProgramMatchesQuery, {
        profileId: profile_id,
      }),
    retry: false,
  });

  const prefillMutation = useMutation<PrefillResponse, unknown, PrefillInput>({
    mutationFn: (input) =>
      fetcher<PrefillResponse>("/api/submissions/prefill", {
        method: "POST",
        body: input,
      }),
    onSuccess: (data) => {
      pushToast(`Submission drafted (${data.status}).`, "success");
    },
    onError: (error) => {
      const message =
        error instanceof FetcherError && error.status === 404
          ? "Submissions pipeline not available yet."
          : error instanceof Error
            ? error.message
            : "Could not prefill submission.";
      pushToast(message, "error");
    },
  });

  const matches = matchesQuery.data?.programMatches ?? [];

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Programs" title="Program matches" />

      <Card>
        <CardHeader>
          <CardTitle>Matches</CardTitle>
          <CardDescription>
            Click a row to select it. The chat agent can help you decide whether to apply.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {matchesQuery.isLoading ? (
            <p className="muted">Loading matches...</p>
          ) : matchesQuery.isError ? (
            <p className="muted">Matches unavailable right now.</p>
          ) : matches.length === 0 ? (
            <p className="muted">
              No matches yet. The Sunday scrape will populate program matches automatically.
            </p>
          ) : (
            <ul className="match-list" data-testid="match-list">
              {matches.map((match) => (
                <ProgramMatchRow
                  key={match.id}
                  match={match}
                  selected={selection?.type === "match" && selection.id === match.id}
                  onSelect={() => setSelection({ type: "match", id: match.id })}
                  onApply={() =>
                    prefillMutation.mutate({
                      program_id: match.program_id,
                      profile_id,
                      program_match_id: match.id,
                    })
                  }
                  applying={prefillMutation.isPending}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProgramMatchRow({
  match,
  selected,
  onSelect,
  onApply,
  applying,
}: {
  match: ProgramMatchWithProgram;
  selected: boolean;
  onSelect: () => void;
  onApply: () => void;
  applying: boolean;
}) {
  return (
    <li
      className={`match-row ${selected ? "selected" : ""}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-testid="match-row"
    >
      <div className="match-row-main">
        <div className="match-row-title">
          <strong>{match.program?.name ?? match.program_id}</strong>
          <TierBadge tier={match.tier} />
        </div>
        <p className="muted">{match.positioning_summary}</p>
      </div>
      <div className="match-row-meta">
        <ScoreMeter score={match.score} />
        <Button
          variant="secondary"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onApply();
          }}
          disabled={applying}
        >
          {applying ? "Applying..." : "Apply"}
        </Button>
      </div>
    </li>
  );
}
