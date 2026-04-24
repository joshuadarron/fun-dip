import { useMemo, useState, type ReactNode } from "react";
import { ChatPanelContext } from "./chat-panel-context-internal";

export function ChatPanelProvider({
  children,
  initialOpen = true,
}: {
  children: ReactNode;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const value = useMemo(
    () => ({
      open,
      setOpen,
      toggle: () => setOpen((prev) => !prev),
    }),
    [open],
  );
  return <ChatPanelContext.Provider value={value}>{children}</ChatPanelContext.Provider>;
}
