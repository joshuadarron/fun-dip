import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MissingField, UUID } from "@fundip/shared-types";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import {
  graphqlRequest,
  SubmissionsQuery,
  type SubmissionsQueryResult,
  type SubmissionsQueryVariables,
  type SubmissionWithProgram,
} from "../../lib/graphql";
import { fetcher, FetcherError } from "../../lib/fetcher";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useSelection } from "../../context/selection-context-internal";
import { useToast } from "../../context/toast-context-internal";

interface SubmitResponse {
  submission_id: UUID;
  status: string;
}

interface SubmitInput {
  submission_id: UUID;
  provided_data: Record<string, unknown>;
}

export function SubmissionsPage() {
  const { profile_id } = useCurrentUser();
  const { selection, setSelection } = useSelection();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const submissionsQuery = useQuery({
    queryKey: ["submissions", profile_id],
    queryFn: () =>
      graphqlRequest<SubmissionsQueryResult, SubmissionsQueryVariables>(SubmissionsQuery, {
        profileId: profile_id,
      }),
    retry: false,
  });

  const submissions = useMemo(
    () => submissionsQuery.data?.submissions ?? [],
    [submissionsQuery.data],
  );

  const selected = useMemo<SubmissionWithProgram | null>(() => {
    if (selection?.type !== "submission") return null;
    return submissions.find((submission) => submission.id === selection.id) ?? null;
  }, [selection, submissions]);

  const submitMutation = useMutation<SubmitResponse, unknown, SubmitInput>({
    mutationFn: (input) =>
      fetcher<SubmitResponse>(`/api/submissions/${input.submission_id}/resume`, {
        method: "POST",
        body: { provided_data: input.provided_data },
      }),
    onSuccess: (data) => {
      pushToast(`Submission updated (${data.status}).`, "success");
      void queryClient.invalidateQueries({ queryKey: ["submissions", profile_id] });
    },
    onError: (error) => {
      const message =
        error instanceof FetcherError && error.status === 404
          ? "Submissions pipeline not available yet."
          : error instanceof Error
            ? error.message
            : "Could not resume submission.";
      pushToast(message, "error");
    },
  });

  return (
    <div className="page-grid submissions-grid">
      <PageHeader eyebrow="Submissions" title="Applications" />

      <div className="submissions-layout">
        <Card className="submissions-list-card">
          <CardHeader>
            <CardTitle>Submissions</CardTitle>
            <CardDescription>Click a row to inspect and complete required fields.</CardDescription>
          </CardHeader>
          <CardContent>
            {submissionsQuery.isLoading ? (
              <p className="muted">Loading submissions...</p>
            ) : submissionsQuery.isError ? (
              <p className="muted">Submissions unavailable right now.</p>
            ) : submissions.length === 0 ? (
              <p className="muted">No submissions yet.</p>
            ) : (
              <ul className="submission-list" data-testid="submission-list">
                {submissions.map((submission) => (
                  <li
                    key={submission.id}
                    className={`submission-row ${selected?.id === submission.id ? "selected" : ""}`}
                    onClick={() => setSelection({ type: "submission", id: submission.id })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelection({ type: "submission", id: submission.id });
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected?.id === submission.id}
                    data-testid="submission-row"
                  >
                    <div>
                      <strong>{submission.program?.name ?? submission.program_id}</strong>
                      <p className="muted">
                        Updated {new Date(submission.updated_at).toLocaleString()}
                      </p>
                    </div>
                    <StatusBadge status={submission.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="submissions-detail-card">
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>
              {selected
                ? "Resolve any required fields to move the submission forward."
                : "Select a submission to see details."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selected ? (
              <SubmissionDetail
                submission={selected}
                submitting={submitMutation.isPending}
                onSubmit={(provided) =>
                  submitMutation.mutate({ submission_id: selected.id, provided_data: provided })
                }
              />
            ) : (
              <p className="muted">Nothing selected.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SubmissionDetail({
  submission,
  submitting,
  onSubmit,
}: {
  submission: SubmissionWithProgram;
  submitting: boolean;
  onSubmit: (provided: Record<string, unknown>) => void;
}) {
  const missing = submission.missing_fields ?? [];
  const awaiting = submission.status === "awaiting_user_input";

  if (!awaiting || missing.length === 0) {
    return (
      <div className="submission-detail">
        <StatusBadge status={submission.status} />
        <p className="muted">No user input required at this stage.</p>
      </div>
    );
  }

  return <MissingFieldsForm missing={missing} submitting={submitting} onSubmit={onSubmit} />;
}

function MissingFieldsForm({
  missing,
  submitting,
  onSubmit,
}: {
  missing: MissingField[];
  submitting: boolean;
  onSubmit: (provided: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    missing.reduce<Record<string, string | boolean>>((acc, field) => {
      acc[field.field_name] = field.type === "boolean" ? false : "";
      return acc;
    }, {}),
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: Record<string, unknown> = {};
    for (const field of missing) {
      const raw = values[field.field_name];
      if (field.type === "number") {
        payload[field.field_name] = raw === "" ? null : Number(raw);
      } else {
        payload[field.field_name] = raw;
      }
    }
    onSubmit(payload);
  }

  return (
    <form className="missing-fields-form" onSubmit={handleSubmit} aria-label="Missing fields form">
      {missing.map((field) => (
        <label key={field.field_name} className="field">
          <span>
            {field.field_name}
            <small className="muted"> &middot; {field.description}</small>
          </span>
          {field.type === "text" ? (
            <textarea
              className="input textarea"
              rows={4}
              value={String(values[field.field_name] ?? "")}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.field_name]: event.target.value }))
              }
            />
          ) : field.type === "boolean" ? (
            <input
              type="checkbox"
              checked={Boolean(values[field.field_name])}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.field_name]: event.target.checked }))
              }
            />
          ) : field.type === "enum" ? (
            <select
              className="input"
              value={String(values[field.field_name] ?? "")}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.field_name]: event.target.value }))
              }
            >
              <option value="">Select...</option>
              {(field.enum_values ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : field.type === "file" ? (
            <Input
              type="text"
              placeholder="Paste a URL to the file"
              value={String(values[field.field_name] ?? "")}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.field_name]: event.target.value }))
              }
            />
          ) : (
            <Input
              type={field.type === "number" ? "number" : "text"}
              value={String(values[field.field_name] ?? "")}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.field_name]: event.target.value }))
              }
            />
          )}
        </label>
      ))}
      <div className="form-actions">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Submitting..." : "Submit answers"}
        </Button>
      </div>
    </form>
  );
}
