import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Profile, ProfileLookingFor, ProfileStage } from "@fundip/shared-types";
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
import {
  graphqlRequest,
  ProfileQuery,
  UpdateProfileMutation,
  type ProfilePatch,
  type ProfileQueryResult,
  type ProfileQueryVariables,
  type UpdateProfileResult,
  type UpdateProfileVariables,
} from "../../lib/graphql";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useToast } from "../../context/toast-context-internal";
import { FetcherError } from "../../lib/fetcher";

const STAGE_OPTIONS: { value: ProfileStage; label: string }[] = [
  { value: "idea", label: "Idea" },
  { value: "pre_seed", label: "Pre-seed" },
  { value: "seed", label: "Seed" },
  { value: "series_a", label: "Series A" },
  { value: "series_b_plus", label: "Series B+" },
];

const LOOKING_FOR_OPTIONS: { value: ProfileLookingFor; label: string }[] = [
  { value: "increase_mrr", label: "Increase MRR" },
  { value: "technology_pea", label: "Technology PEA" },
  { value: "investors", label: "Investors" },
  { value: "incubator", label: "Incubator" },
];

interface FormState {
  startup_name: string;
  stage: ProfileStage | "";
  location: string;
  market: string;
  goals: string;
  looking_for: ProfileLookingFor[];
  narrative: string;
}

const EMPTY_FORM: FormState = {
  startup_name: "",
  stage: "",
  location: "",
  market: "",
  goals: "",
  looking_for: [],
  narrative: "",
};

function profileToForm(profile: Profile | null): FormState {
  if (!profile) return EMPTY_FORM;
  return {
    startup_name: profile.startup_name ?? "",
    stage: profile.stage ?? "",
    location: profile.location ?? "",
    market: profile.market ?? "",
    goals: (profile.goals ?? []).join(", "),
    looking_for: profile.looking_for ?? [],
    narrative: profile.narrative ?? "",
  };
}

function formToPatch(form: FormState): ProfilePatch {
  const patch: ProfilePatch = {
    startup_name: form.startup_name.trim(),
    location: form.location.trim() || "",
    market: form.market.trim() || "",
    goals: form.goals
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    looking_for: form.looking_for,
    narrative: form.narrative,
  };
  if (form.stage !== "") {
    patch.stage = form.stage;
  }
  return patch;
}

export function ProfilePage() {
  const { profile_id } = useCurrentUser();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const profileQuery = useQuery({
    queryKey: ["profile", profile_id],
    queryFn: () =>
      graphqlRequest<ProfileQueryResult, ProfileQueryVariables>(ProfileQuery, { id: profile_id }),
    retry: false,
  });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const loaded = profileQuery.data?.profile ?? null;

  useEffect(() => {
    if (loaded) {
      setForm(profileToForm(loaded));
    }
  }, [loaded]);

  const mutation = useMutation<UpdateProfileResult, unknown, ProfilePatch>({
    mutationFn: (patch) =>
      graphqlRequest<UpdateProfileResult, UpdateProfileVariables>(UpdateProfileMutation, {
        id: profile_id,
        patch,
      }),
    onSuccess: () => {
      pushToast("Profile saved.", "success");
      void queryClient.invalidateQueries({ queryKey: ["profile", profile_id] });
    },
    onError: (error) => {
      const message =
        error instanceof FetcherError && error.status === 404
          ? "Profile API not available yet."
          : error instanceof Error
            ? error.message
            : "Failed to save profile.";
      pushToast(message, "error");
    },
  });

  const summary = profileQuery.data?.profileSummary ?? null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(formToPatch(form));
  }

  function toggleLookingFor(value: ProfileLookingFor) {
    setForm((prev) => {
      const has = prev.looking_for.includes(value);
      return {
        ...prev,
        looking_for: has
          ? prev.looking_for.filter((v) => v !== value)
          : [...prev.looking_for, value],
      };
    });
  }

  const isLoading = profileQuery.isLoading;
  const errored = profileQuery.isError;
  const hasChanges = useMemo(() => {
    if (!loaded) return true;
    const current = profileToForm(loaded);
    return JSON.stringify(current) !== JSON.stringify(form);
  }, [loaded, form]);

  return (
    <div className="page-grid">
      <PageHeader eyebrow="Profile" title="Company profile" />

      {summary ? (
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
            <CardDescription>Read-only summary generated by the profile pipeline.</CardDescription>
          </CardHeader>
          <CardContent>
            <p>{summary}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Structured fields</CardTitle>
          <CardDescription>
            Direct edits bypass the profile pipeline and save straight to Ghost.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="muted">Loading profile...</p>
          ) : (
            <form className="profile-form" onSubmit={handleSubmit} aria-label="Profile form">
              {errored ? (
                <p className="muted">
                  Profile not found on the server yet. You can still edit and save below.
                </p>
              ) : null}

              <label className="field">
                <span>Startup name</span>
                <Input
                  value={form.startup_name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, startup_name: event.target.value }))
                  }
                />
              </label>

              <label className="field">
                <span>Stage</span>
                <select
                  className="input"
                  value={form.stage}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      stage: event.target.value as ProfileStage | "",
                    }))
                  }
                >
                  <option value="">Select stage</option>
                  {STAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Location</span>
                <Input
                  value={form.location}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, location: event.target.value }))
                  }
                />
              </label>

              <label className="field">
                <span>Market</span>
                <Input
                  value={form.market}
                  onChange={(event) => setForm((prev) => ({ ...prev, market: event.target.value }))}
                />
              </label>

              <label className="field">
                <span>Goals (comma separated)</span>
                <Input
                  value={form.goals}
                  onChange={(event) => setForm((prev) => ({ ...prev, goals: event.target.value }))}
                />
              </label>

              <fieldset className="field looking-for-field">
                <legend>Looking for</legend>
                <div className="looking-for-grid">
                  {LOOKING_FOR_OPTIONS.map((option) => (
                    <label key={option.value} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={form.looking_for.includes(option.value)}
                        onChange={() => toggleLookingFor(option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="field">
                <span>Narrative</span>
                <textarea
                  className="input textarea"
                  rows={6}
                  value={form.narrative}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, narrative: event.target.value }))
                  }
                />
              </label>

              <div className="form-actions">
                <Button type="submit" disabled={!hasChanges || mutation.isPending}>
                  {mutation.isPending ? "Saving..." : "Save profile"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
