import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TooltipProvider } from "../../components/ui/tooltip";
import { ChatPanelProvider } from "../../context/ChatPanelContext";
import { SelectionProvider } from "../../context/SelectionContext";
import { ToastProvider } from "../../context/ToastContext";
import { ProfilePage } from "./ProfilePage";
import * as graphql from "../../lib/graphql";

function Wrap({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter initialEntries={["/profile"]}>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <ToastProvider>
            <SelectionProvider>
              <ChatPanelProvider initialOpen={false}>{children}</ChatPanelProvider>
            </SelectionProvider>
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("ProfilePage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("submits updateProfile mutation with the correct patch", async () => {
    const graphqlMock = vi.spyOn(graphql, "graphqlRequest");

    const profileRow = {
      id: "profile-1",
      user_id: "user-1",
      startup_name: "Fundip",
      stage: "pre_seed" as const,
      location: "Remote",
      market: "SaaS",
      goals: ["hire", "launch"],
      looking_for: ["investors"] as const,
      narrative: "Build and sell.",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-02T00:00:00Z",
    };

    graphqlMock.mockImplementation(async (doc: string) => {
      if (doc.includes("updateProfile")) {
        return {
          updateProfile: { ...profileRow, startup_name: "Fundip Labs" },
        } as unknown as ReturnType<typeof graphql.graphqlRequest>;
      }
      return {
        profile: profileRow,
        profileSummary: null,
      } as unknown as ReturnType<typeof graphql.graphqlRequest>;
    });

    const user = userEvent.setup();

    render(
      <Wrap>
        <ProfilePage />
      </Wrap>,
    );

    const nameInput = await waitFor(() => screen.getByDisplayValue("Fundip") as HTMLInputElement);
    await user.clear(nameInput);
    await user.type(nameInput, "Fundip Labs");

    await user.click(screen.getByRole("button", { name: /Save profile/i }));

    await waitFor(() => {
      const mutationCall = graphqlMock.mock.calls.find(([doc]) =>
        String(doc).includes("updateProfile"),
      );
      expect(mutationCall).toBeDefined();
    });

    const mutationCall = graphqlMock.mock.calls.find(([doc]) =>
      String(doc).includes("updateProfile"),
    );
    expect(mutationCall).toBeDefined();
    const [doc, vars] = mutationCall!;
    expect(String(doc)).toContain("updateProfile");
    expect(vars).toMatchObject({
      id: expect.any(String),
      patch: expect.objectContaining({
        startup_name: "Fundip Labs",
        stage: "pre_seed",
        looking_for: ["investors"],
      }),
    });
  });
});
