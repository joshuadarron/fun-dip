import { describe, expect, it } from "vitest";
import { renderMissingInfoEmail } from "./missingInfo.js";

describe("renderMissingInfoEmail", () => {
  it("lists each gap and includes the profile button URL", () => {
    const out = renderMissingInfoEmail({
      startup_name: "Acme",
      program_name: "Big Grant",
      program_provider: "Big Foundation",
      missing_fields: [
        { field_name: "team_size", description: "Number of full-time employees", type: "number" },
        { field_name: "pitch_deck_url", description: "Link to your deck", type: "string" },
      ],
      profile_url: "https://app.fundip.test/profile",
    });

    expect(out.subject).toBe("Big Grant: a few more details needed");
    expect(out.html).toContain("team_size");
    expect(out.html).toContain("Number of full-time employees");
    expect(out.html).toContain("pitch_deck_url");
    expect(out.html).toContain("https://app.fundip.test/profile");
    expect(out.text).toContain("- team_size (number): Number of full-time employees");
    expect(out.text).toContain("Open your profile: https://app.fundip.test/profile");
    expect(out.html).not.toContain("—");
    expect(out.text).not.toContain("—");
  });
});
