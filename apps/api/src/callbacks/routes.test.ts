import { CALLBACK_PATHS, CALLBACK_SIGNATURE_HEADER } from "@fundip/shared-types";
import { signBody } from "@fundip/rocketride-client";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createCallbackRouter, type CallbackHandlers } from "./routes.js";

const secret = "s".repeat(40);

function makeApp(handlers: Partial<CallbackHandlers> = {}) {
  const full: CallbackHandlers = {
    onMatchesReady: vi.fn(),
    onSubmissionNeedsInput: vi.fn(),
    onSubmissionSubmitted: vi.fn(),
    ...handlers,
  };
  const app = express();
  app.use(createCallbackRouter({ secret, handlers: full }));
  return { app, handlers: full };
}

describe("callback router", () => {
  it("accepts a correctly signed matches_ready payload", async () => {
    const { app, handlers } = makeApp();
    const body = JSON.stringify({ profile_id: "p1", match_count: 3, max_tier: "hot" });
    const res = await request(app)
      .post(CALLBACK_PATHS.matches_ready)
      .set("Content-Type", "application/json")
      .set(CALLBACK_SIGNATURE_HEADER, signBody(body, secret))
      .send(body);
    expect(res.status).toBe(202);
    expect(handlers.onMatchesReady).toHaveBeenCalledWith({
      profile_id: "p1",
      match_count: 3,
      max_tier: "hot",
    });
  });

  it("rejects an unsigned payload with 401", async () => {
    const { app, handlers } = makeApp();
    const body = JSON.stringify({ profile_id: "p1", match_count: 1, max_tier: "warm" });
    const res = await request(app)
      .post(CALLBACK_PATHS.matches_ready)
      .set("Content-Type", "application/json")
      .send(body);
    expect(res.status).toBe(401);
    expect(handlers.onMatchesReady).not.toHaveBeenCalled();
  });

  it("rejects a wrong-secret signature with 401", async () => {
    const { app, handlers } = makeApp();
    const body = JSON.stringify({ profile_id: "p1", match_count: 1, max_tier: "cold" });
    const res = await request(app)
      .post(CALLBACK_PATHS.matches_ready)
      .set("Content-Type", "application/json")
      .set(CALLBACK_SIGNATURE_HEADER, signBody(body, "w".repeat(40)))
      .send(body);
    expect(res.status).toBe(401);
    expect(handlers.onMatchesReady).not.toHaveBeenCalled();
  });

  it("rejects a signed but schema-invalid payload with 400", async () => {
    const { app, handlers } = makeApp();
    const body = JSON.stringify({ profile_id: "p1", match_count: "lots", max_tier: "warm" });
    const res = await request(app)
      .post(CALLBACK_PATHS.matches_ready)
      .set("Content-Type", "application/json")
      .set(CALLBACK_SIGNATURE_HEADER, signBody(body, secret))
      .send(body);
    expect(res.status).toBe(400);
    expect(handlers.onMatchesReady).not.toHaveBeenCalled();
  });

  it("routes submission_needs_input to its handler", async () => {
    const onSubmissionNeedsInput = vi.fn();
    const { app } = makeApp({ onSubmissionNeedsInput });
    const payload = {
      submission_id: "sub1",
      profile_id: "p1",
      program_id: "prog1",
      missing_fields: [{ field_name: "team_size", description: "", type: "number" }],
    };
    const body = JSON.stringify(payload);
    const res = await request(app)
      .post(CALLBACK_PATHS.submission_needs_input)
      .set("Content-Type", "application/json")
      .set(CALLBACK_SIGNATURE_HEADER, signBody(body, secret))
      .send(body);
    expect(res.status).toBe(202);
    expect(onSubmissionNeedsInput).toHaveBeenCalledWith(payload);
  });

  it("routes submission_submitted to its handler with null confirmation_ref", async () => {
    const onSubmissionSubmitted = vi.fn();
    const { app } = makeApp({ onSubmissionSubmitted });
    const body = JSON.stringify({
      submission_id: "sub1",
      profile_id: "p1",
      program_id: "prog1",
      confirmation_ref: null,
    });
    const res = await request(app)
      .post(CALLBACK_PATHS.submission_submitted)
      .set("Content-Type", "application/json")
      .set(CALLBACK_SIGNATURE_HEADER, signBody(body, secret))
      .send(body);
    expect(res.status).toBe(202);
    expect(onSubmissionSubmitted).toHaveBeenCalled();
  });
});
