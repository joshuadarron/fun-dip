import { describe, expect, it } from "vitest";
import { renderDigestEmail } from "./digest.js";

describe("renderDigestEmail", () => {
  it("renders subject, html, and text with each match section", () => {
    const out = renderDigestEmail({
      startup_name: "Acme",
      matches: [
        {
          program_name: "Y Combinator",
          program_provider: "Y Combinator",
          requirements_summary: "Pre-seed, technical founder",
          positioning_summary: "Acme matches because of strong technical founders.",
          score: 88,
          tier: "hot",
          confirm_url: "https://app.fundip.test/confirm?token=abc&submission=s1",
        },
        {
          program_name: "Techstars",
          program_provider: "Techstars",
          requirements_summary: "Seed, B2B SaaS",
          positioning_summary: "Acme is a B2B SaaS at seed stage.",
          score: 62,
          tier: "warm",
          confirm_url: "https://app.fundip.test/confirm?token=def&submission=s2",
        },
      ],
    });

    expect(out.subject).toContain("2 new matches");
    expect(out.subject).toContain("Acme");
    expect(out.html).toContain("Y Combinator");
    expect(out.html).toContain("Techstars");
    // Score meter for 88 should include the score text.
    expect(out.html).toContain("88/100");
    expect(out.html).toContain("62/100");
    // Tier badges rendered.
    expect(out.html).toContain(">Hot<");
    expect(out.html).toContain(">Warm<");
    // Deep-link URLs rendered.
    expect(out.html).toContain("https://app.fundip.test/confirm?token=abc&amp;submission=s1");
    // Plain text version mirrors the structure.
    expect(out.text).toContain("Y Combinator");
    expect(out.text).toContain("Score: 88/100, tier: hot");
    expect(out.text).toContain(
      "Review and apply: https://app.fundip.test/confirm?token=abc&submission=s1",
    );
    // No em-dashes (project rule).
    expect(out.html).not.toContain("—");
    expect(out.text).not.toContain("—");
  });

  it("uses singular wording when only one match is present", () => {
    const out = renderDigestEmail({
      startup_name: "Solo",
      matches: [
        {
          program_name: "Grant Inc",
          program_provider: "Grant Inc",
          requirements_summary: "anything",
          positioning_summary: "fits",
          score: 30,
          tier: "cold",
          confirm_url: "https://x/confirm?token=t&submission=s",
        },
      ],
    });
    expect(out.subject).toContain("1 new match for Solo");
    expect(out.text).toContain("1 new match this week.");
  });
});
