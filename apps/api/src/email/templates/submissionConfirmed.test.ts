import { describe, expect, it } from "vitest";
import { renderSubmissionConfirmedEmail } from "./submissionConfirmed.js";

describe("renderSubmissionConfirmedEmail", () => {
  it("renders subject, html, and text with the confirmation reference", () => {
    const out = renderSubmissionConfirmedEmail({
      startup_name: "Acme",
      program_name: "Big Grant",
      program_provider: "Big Foundation",
      confirmation_ref: "REF-12345",
      submissions_url: "https://app.fundip.test/submissions",
    });
    expect(out.subject).toBe("Application submitted: Big Grant");
    expect(out.html).toContain("Big Grant");
    expect(out.html).toContain("REF-12345");
    expect(out.html).toContain("https://app.fundip.test/submissions");
    expect(out.text).toContain("Reference: REF-12345");
    expect(out.text).toContain("View submission: https://app.fundip.test/submissions");
    expect(out.html).not.toContain("—");
  });

  it("falls back to a friendly message when confirmation_ref is null", () => {
    const out = renderSubmissionConfirmedEmail({
      startup_name: "Acme",
      program_name: "Big Grant",
      program_provider: "Big Foundation",
      confirmation_ref: null,
      submissions_url: "https://app.fundip.test/submissions",
    });
    expect(out.html).toContain("No reference id");
    expect(out.text).toContain("No reference id returned.");
  });
});
