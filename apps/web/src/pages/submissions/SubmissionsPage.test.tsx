import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TooltipProvider } from "../../components/ui/tooltip";
import { ChatPanelProvider } from "../../context/ChatPanelContext";
import { SelectionProvider } from "../../context/SelectionContext";
import { ToastProvider } from "../../context/ToastContext";
import { SubmissionsPage } from "./SubmissionsPage";
import * as graphql from "../../lib/graphql";

function Wrap({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter initialEntries={["/submissions"]}>
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

describe("SubmissionsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders missing-fields form for an awaiting_user_input submission", async () => {
    vi.spyOn(graphql, "graphqlRequest").mockResolvedValueOnce({
      submissions: [
        {
          id: "sub-1",
          profile_id: "p1",
          program_id: "prog-1",
          program_match_id: null,
          status: "awaiting_user_input",
          prefilled_fields: {},
          missing_fields: [
            {
              field_name: "team_size",
              description: "How many team members?",
              type: "number",
            },
            {
              field_name: "accepts_equity",
              description: "Does your program take equity?",
              type: "boolean",
            },
          ],
          provided_data: {},
          submitted_at: null,
          confirmation_ref: null,
          response_text: null,
          error: null,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-02T00:00:00Z",
          program: { id: "prog-1", name: "Climate Venture Lab", provider: "Acme" },
        },
      ],
    } as Awaited<ReturnType<typeof graphql.graphqlRequest>>);

    const user = userEvent.setup();

    render(
      <Wrap>
        <SubmissionsPage />
      </Wrap>,
    );

    await waitFor(() => expect(screen.getByText("Climate Venture Lab")).toBeInTheDocument());

    await user.click(screen.getByTestId("submission-row"));

    await waitFor(() => expect(screen.getByLabelText(/Missing fields form/i)).toBeInTheDocument());
    expect(screen.getByText(/team_size/)).toBeInTheDocument();
    expect(screen.getByText(/accepts_equity/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit answers/i })).toBeInTheDocument();
  });
});
