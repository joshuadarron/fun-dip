import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ChatPipelineInput, ChatPipelineOutput } from "@fundip/shared-types";
import { ChatPanel } from "./ChatPanel";
import { ChatPanelProvider } from "../context/ChatPanelContext";
import { SelectionProvider } from "../context/SelectionContext";
import { useSelection } from "../context/selection-context-internal";
import { useEffect } from "react";

function PrimeSelection() {
  const { setSelection } = useSelection();
  useEffect(() => {
    setSelection({ type: "program", id: "program-xyz" });
  }, [setSelection]);
  return null;
}

function renderChatPanel(
  postChat: (input: ChatPipelineInput) => Promise<ChatPipelineOutput>,
  { initialPath = "/programs" }: { initialPath?: string } = {},
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SelectionProvider>
        <ChatPanelProvider initialOpen>
          <PrimeSelection />
          <ChatPanel postChat={postChat} />
        </ChatPanelProvider>
      </SelectionProvider>
    </MemoryRouter>,
  );
}

describe("ChatPanel", () => {
  it("renders the initial assistant message", () => {
    renderChatPanel(() => Promise.resolve(emptyReply()));
    expect(screen.getByText(/Hi, I can help build your company profile/i)).toBeInTheDocument();
  });

  it("sends a message with current_page and current_selection", async () => {
    const user = userEvent.setup();
    const postChat = vi.fn(
      async (_input: ChatPipelineInput) =>
        ({
          status: "ok",
          reply: "Agent reply here.",
          conversation_id: _input.conversation_id,
          tool_calls: [{ tool: "profile", input: { mode: "read" }, output: { ok: true } }],
          surfaced: { new_matches: ["match-1"] },
        }) satisfies ChatPipelineOutput,
    );

    renderChatPanel(postChat, { initialPath: "/programs" });

    const input = screen.getByLabelText("Message");
    await user.type(input, "Find me something");
    await user.click(screen.getByLabelText("Send message"));

    expect(postChat).toHaveBeenCalledTimes(1);
    const arg = postChat.mock.calls[0][0];
    expect(arg.current_page).toBe("programs");
    expect(arg.current_selection).toEqual({ type: "program", id: "program-xyz" });
    expect(arg.message).toBe("Find me something");

    expect(await screen.findByText("Agent reply here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agent performed 1 action/i })).toBeInTheDocument();
    // Id is trimmed to its first 6 chars in the chip label.
    expect(screen.getByText(/^Match /i)).toBeInTheDocument();
  });
});

function emptyReply(): ChatPipelineOutput {
  return {
    status: "ok",
    reply: "",
    conversation_id: "conv",
    tool_calls: [],
    surfaced: {},
  };
}
