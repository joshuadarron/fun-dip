import { createContext, useContext } from "react";

export interface ChatPanelContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const ChatPanelContext = createContext<ChatPanelContextValue | null>(null);

export function useChatPanel(): ChatPanelContextValue {
  const ctx = useContext(ChatPanelContext);
  if (!ctx) {
    throw new Error("useChatPanel must be used within a ChatPanelProvider");
  }
  return ctx;
}
