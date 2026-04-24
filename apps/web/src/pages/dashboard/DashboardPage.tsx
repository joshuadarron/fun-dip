import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { MatchTier, Profile, ProgramMatch } from "@fundip/shared-types";
import { Badge } from "../../components/ui/badge";
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
import { StatusBadge } from "../../components/StatusBadge";
import {
  graphqlRequest,
  ProfileQuery,
  ProgramMatchesQuery,
  SubmissionsQuery,
  type ProfileQueryResult,
  type ProfileQueryVariables,
  type ProgramMatchesQueryResult,
  type ProgramMatchesQueryVariables,
  type SubmissionsQueryResult,
  type SubmissionsQueryVariables,
} from "../../lib/graphql";
import { useCurrentUser } from "../../hooks/useCurrentUser";

const PROFILE_FIELDS: (keyof Profile)[] = [
  "startup_name",
  "stage",
  "location",
  "market",
  "goals",
  "looking_for",
  "narrative",
];

export function DashboardPage() {
  const { profile_id } = useCurrentUser();

  const profileQuery = useQuery({
    queryKey: ["profile", profile_id],
    queryFn: () =>
      graphqlRequest<ProfileQueryResult, ProfileQueryVariables>(ProfileQuery, { id: profile_id }),
    retry: false,
  });

  const matchesQuery = useQuery({
    queryKey: ["programMatches", profile_id],
    queryFn: () =>
      graphqlRequest<ProgramMatchesQueryResult, ProgramMatchesQueryVariables>(ProgramMatchesQuery, {
        profileId: profile_id,
      }),
    retry: false,
  });

  const submissionsQuery = useQuery({
    queryKey: ["submissions", profile_id],
    queryFn: () =>
      graphqlRequest<SubmissionsQueryResult, SubmissionsQueryVariables>(SubmissionsQuery, {
        profileId: profile_id,
      }),
    retry: false,
  });

  const readiness = computeProfileReadiness(profileQuery.data?.profile ?? null);
  const tierCounts = countTiers(matchesQuery.data?.programMatches ?? []);
  const pending = (submissionsQuery.data?.submissions ?? []).filter(
    (submission) => submission.status === "awaiting_user_input",
  );
  const topMatches = [...(matchesQuery.data?.programMatches ?? [])]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Overview" title="Dashboard" />

      <div className="stats-grid">
        <Card>
          <CardContent>
            <p className="stat-value">{Math.round(readiness * 100)}%</p>
            <p className="muted">Profile readiness</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="tier-counts">
              <span>
                <strong>{tierCounts.hot}</strong> <Badge className="tier-badge tier-hot">Hot</Badge>
              </span>
              <span>
                <strong>{tierCounts.warm}</strong>{" "}
                <Badge className="tier-badge tier-warm">Warm</Badge>
              </span>
              <span>
                <strong>{tierCounts.cold}</strong>{" "}
                <Badge className="tier-badge tier-cold">Cold</Badge>
              </span>
            </div>
            <p className="muted">Program matches by tier</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="stat-value">{pending.length}</p>
            <p className="muted">Submissions awaiting input</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top matches</CardTitle>
          <CardDescription>Highest-scoring programs for your profile.</CardDescription>
        </CardHeader>
        <CardContent>
          {matchesQuery.isLoading ? (
            <p className="muted">Loading matches...</p>
          ) : matchesQuery.isError ? (
            <p className="muted">Matches unavailable right now.</p>
          ) : topMatches.length === 0 ? (
            <p className="muted">No matches yet. The weekly scrape will populate this.</p>
          ) : (
            <ul className="match-list" data-testid="top-matches">
              {topMatches.map((match) => (
                <li key={match.id} className="match-row compact">
                  <div className="match-row-main">
                    <strong>{match.program?.name ?? match.program_id}</strong>
                    <p className="muted">{match.positioning_summary}</p>
                  </div>
                  <div className="match-row-meta">
                    <ScoreMeter score={match.score} />
                    <TierBadge tier={match.tier} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending actions</CardTitle>
          <CardDescription>Submissions that need information from you.</CardDescription>
        </CardHeader>
        <CardContent>
          {submissionsQuery.isLoading ? (
            <p className="muted">Loading submissions...</p>
          ) : submissionsQuery.isError ? (
            <p className="muted">Submissions unavailable right now.</p>
          ) : pending.length === 0 ? (
            <p className="muted">Nothing waiting on you right now.</p>
          ) : (
            <ul className="pending-list">
              {pending.map((submission) => (
                <li key={submission.id} className="pending-row">
                  <div>
                    <strong>{submission.program?.name ?? submission.program_id}</strong>
                    <p className="muted">
                      {submission.missing_fields.length} field
                      {submission.missing_fields.length === 1 ? "" : "s"} needed
                    </p>
                  </div>
                  <div className="pending-row-meta">
                    <StatusBadge status={submission.status} />
                    <Link to="/submissions" className="btn btn-secondary btn-sm">
                      Review
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function computeProfileReadiness(profile: Profile | null): number {
  if (!profile) return 0;
  const filled = PROFILE_FIELDS.reduce((count, field) => {
    const value = profile[field];
    if (Array.isArray(value)) {
      return value.length > 0 ? count + 1 : count;
    }
    if (typeof value === "string") {
      return value.trim().length > 0 ? count + 1 : count;
    }
    if (value !== null && value !== undefined) {
      return count + 1;
    }
    return count;
  }, 0);
  return filled / PROFILE_FIELDS.length;
}

function countTiers(matches: ProgramMatch[]): Record<MatchTier, number> {
  const counts: Record<MatchTier, number> = { hot: 0, warm: 0, cold: 0 };
  for (const match of matches) {
    counts[match.tier] += 1;
  }
  return counts;
}
