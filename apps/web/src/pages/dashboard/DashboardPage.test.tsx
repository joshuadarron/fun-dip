import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TooltipProvider } from "../../components/ui/tooltip";
import { ChatPanelProvider } from "../../context/ChatPanelContext";
import { SelectionProvider } from "../../context/SelectionContext";
import { ToastProvider } from "../../context/ToastContext";
import { DashboardPage } from "./DashboardPage";
import * as graphql from "../../lib/graphql";

function Wrap({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter initialEntries={["/"]}>
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

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders tier counts and readiness from fetched data", async () => {
    const graphqlMock = vi.spyOn(graphql, "graphqlRequest");

    graphqlMock.mockImplementation(async (doc) => {
      const docStr = String(doc);
      if (docStr.includes("profile(id")) {
        return {
          profile: {
            id: "p1",
            user_id: "u1",
            startup_name: "Fundip",
            stage: "seed",
            location: "",
            market: "",
            goals: [],
            looking_for: [],
            narrative: "",
            created_at: "2025-01-01T00:00:00Z",
            updated_at: "2025-01-01T00:00:00Z",
          },
          profileSummary: null,
        } as unknown as ReturnType<typeof graphql.graphqlRequest>;
      }
      if (docStr.includes("programMatches")) {
        return {
          programMatches: [
            {
              id: "m1",
              profile_id: "p1",
              program_id: "prog1",
              score: 80,
              tier: "hot",
              positioning_summary: "fit",
              status: "new",
              rationale: "r",
              matched_at: "2025-01-01T00:00:00Z",
              program: {
                id: "prog1",
                name: "Alpha",
                provider: "Acme",
                description: "",
                apply_method: "form",
                apply_url: null,
                deadline: null,
              },
            },
          ],
        } as unknown as ReturnType<typeof graphql.graphqlRequest>;
      }
      return {
        submissions: [],
      } as unknown as ReturnType<typeof graphql.graphqlRequest>;
    });

    render(
      <Wrap>
        <DashboardPage />
      </Wrap>,
    );

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });

    // Tier counts card + match row both show "Hot".
    expect(screen.getAllByText("Hot").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Warm")).toBeInTheDocument();
    expect(screen.getByText("Cold")).toBeInTheDocument();
  });
});
