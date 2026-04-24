import { useCallback, useRef, useState } from "react";
import type {
  ChatPipelineInput,
  ChatPipelineOutput,
  ToolCallRecord,
  UUID,
} from "@fundip/shared-types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { fetcher, FetcherError } from "../lib/fetcher";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useCurrentPage } from "../hooks/useCurrentPage";
import { useSelection } from "../context/selection-context-internal";
import { useChatPanel } from "../context/chat-panel-context-internal";

type LocalMessage =
  | { kind: "user"; content: string }
  | {
      kind: "assistant";
      content: string;
      tool_calls: ToolCallRecord[];
      pending_submissions: UUID[];
      new_matches: UUID[];
    }
  | { kind: "system"; content: string };

interface ChatPanelProps {
  /**
   * Test seam. Supply a custom fetcher for unit tests so we do not have
   * to stub the global `fetch` everywhere. Defaults to the real one.
   */
  postChat?: (input: ChatPipelineInput) => Promise<ChatPipelineOutput>;
}

const INITIAL_MESSAGE: LocalMessage = {
  kind: "assistant",
  content:
    "Hi, I can help build your company profile and find funding programs that fit. What would you like to work on?",
  tool_calls: [],
  pending_submissions: [],
  new_matches: [],
};

export function ChatPanel({ postChat }: ChatPanelProps) {
  const currentUser = useCurrentUser();
  const currentPage = useCurrentPage();
  const { selection } = useSelection();
  const { open, setOpen } = useChatPanel();

  const [messages, setMessages] = useState<LocalMessage[]>([INITIAL_MESSAGE]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationIdRef = useRef<UUID>(currentUser.conversation_id);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      setMessages((prev) => [...prev, { kind: "user", content: trimmed }]);
      setDraft("");
      setSending(true);
      setError(null);

      const payload: ChatPipelineInput = {
        user_id: currentUser.user_id,
        profile_id: currentUser.profile_id,
        conversation_id: conversationIdRef.current,
        current_page: currentPage,
        current_selection: selection,
        message: trimmed,
      };

      try {
        const output = postChat
          ? await postChat(payload)
          : await fetcher<ChatPipelineOutput>("/api/chat", {
              method: "POST",
              body: payload,
            });

        conversationIdRef.current = output.conversation_id;

        setMessages((prev) => [
          ...prev,
          {
            kind: "assistant",
            content: output.reply,
            tool_calls: output.tool_calls ?? [],
            pending_submissions: output.surfaced?.pending_submissions ?? [],
            new_matches: output.surfaced?.new_matches ?? [],
          },
        ]);
      } catch (err) {
        const message =
          err instanceof FetcherError && err.status === 404
            ? "Chat pipeline not available yet."
            : err instanceof Error
              ? err.message
              : "Failed to send message.";
        setError(message);
        setMessages((prev) => [...prev, { kind: "system", content: message }]);
      } finally {
        setSending(false);
      }
    },
    [currentPage, currentUser.profile_id, currentUser.user_id, postChat, selection],
  );

  return (
    <aside
      className={`chat-panel ${open ? "open" : ""}`}
      aria-hidden={!open}
      aria-label="Assistant chat"
      data-testid="chat-panel"
    >
      <header className="chat-header">
        <div className="assistant-avatar" />
        <div>
          <strong>Fundip Agent</strong>
          <p>Profile, programs, submissions</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close chat">
          <i className="bx bx-x" />
        </Button>
      </header>
      <div className="chat-messages">
        {messages.map((message, index) => {
          if (message.kind === "user") {
            return (
              <div className="message user" key={index}>
                {message.content}
              </div>
            );
          }
          if (message.kind === "system") {
            return (
              <div className="message system" key={index} role="status">
                {message.content}
              </div>
            );
          }
          return <AssistantMessage key={index} message={message} />;
        })}
        {sending ? (
          <div className="message assistant is-loading" role="status">
            Thinking...
          </div>
        ) : null}
        {error && !sending ? (
          <div className="chat-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask the agent..."
          aria-label="Message"
          disabled={sending}
        />
        <Button type="submit" size="icon" aria-label="Send message" disabled={sending}>
          <i className="bx bx-up-arrow-alt" />
        </Button>
      </form>
    </aside>
  );
}

function AssistantMessage({ message }: { message: Extract<LocalMessage, { kind: "assistant" }> }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolCount = message.tool_calls.length;
  const hasSurfaced = message.pending_submissions.length > 0 || message.new_matches.length > 0;

  return (
    <div className="message assistant">
      <p className="message-body">{message.content}</p>
      {hasSurfaced ? (
        <div className="surfaced-chips">
          {message.new_matches.map((id) => (
            <Badge key={`match-${id}`} className="chip chip-match">
              Match {id.slice(0, 6)}
            </Badge>
          ))}
          {message.pending_submissions.map((id) => (
            <Badge key={`sub-${id}`} className="chip chip-submission">
              Submission {id.slice(0, 6)}
            </Badge>
          ))}
        </div>
      ) : null}
      {toolCount > 0 ? (
        <div className="tool-calls">
          <button
            type="button"
            className="tool-toggle"
            onClick={() => setToolsOpen((open) => !open)}
            aria-expanded={toolsOpen}
          >
            Agent performed {toolCount} action{toolCount === 1 ? "" : "s"}
          </button>
          {toolsOpen ? (
            <ul className="tool-list">
              {message.tool_calls.map((call, index) => (
                <li key={`${call.tool}-${index}`} className="tool-item">
                  <strong>{call.tool}</strong>
                  <code>{summarizeInput(call.input)}</code>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function summarizeInput(input: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(input);
    return json.length > 120 ? `${json.slice(0, 117)}...` : json;
  } catch {
    return "[unserializable]";
  }
}
