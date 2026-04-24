import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TooltipProvider } from "../../components/ui/tooltip";
import { ChatPanelProvider } from "../../context/ChatPanelContext";
import { SelectionProvider } from "../../context/SelectionContext";
import { ToastProvider } from "../../context/ToastContext";
import { ProgramsPage } from "./ProgramsPage";
import * as graphql from "../../lib/graphql";

function Wrap({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter initialEntries={["/programs"]}>
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

describe("ProgramsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a match row with score meter and tier", async () => {
    vi.spyOn(graphql, "graphqlRequest").mockResolvedValueOnce({
      programMatches: [
        {
          id: "match-1",
          profile_id: "p1",
          program_id: "prog-1",
          score: 82,
          tier: "hot",
          positioning_summary: "Great fit because of X",
          status: "new",
          rationale: "rationale",
          matched_at: "2025-01-01T00:00:00Z",
          program: {
            id: "prog-1",
            name: "Founder Residency",
            provider: "Acme",
            description: "",
            apply_method: "form",
            apply_url: null,
            deadline: null,
          },
        },
      ],
    } as Awaited<ReturnType<typeof graphql.graphqlRequest>>);

    render(
      <Wrap>
        <ProgramsPage />
      </Wrap>,
    );

    await waitFor(() => expect(screen.getByText("Founder Residency")).toBeInTheDocument());
    expect(screen.getByText("Great fit because of X")).toBeInTheDocument();
    const meter = screen.getByRole("progressbar");
    expect(meter).toHaveAttribute("aria-valuenow", "82");
    expect(screen.getByText("Hot")).toBeInTheDocument();
    // There are two elements with role="button" matching /Apply/: the li row
    // (role=button for click selection) and the inner Apply action button.
    expect(screen.getAllByRole("button", { name: /Apply/i }).length).toBeGreaterThan(0);
  });
});
