import { Outlet } from "react-router-dom";
import { TooltipProvider } from "./ui/tooltip";
import { NavRail } from "./NavRail";
import { ChatPanel } from "./ChatPanel";
import { ChatPanelProvider } from "../context/ChatPanelContext";
import { useChatPanel } from "../context/chat-panel-context-internal";
import { SelectionProvider } from "../context/SelectionContext";
import { ToastProvider } from "../context/ToastContext";
import { ToastHost } from "./ToastHost";

export function AppLayout() {
  return (
    <TooltipProvider delayDuration={120}>
      <ToastProvider>
        <SelectionProvider>
          <ChatPanelProvider initialOpen>
            <Shell />
            <ToastHost />
          </ChatPanelProvider>
        </SelectionProvider>
      </ToastProvider>
    </TooltipProvider>
  );
}

function Shell() {
  const { open } = useChatPanel();
  return (
    <div className="app-shell">
      <NavRail />
      <main className={`workspace ${open ? "chat-open" : "chat-closed"}`}>
        <section className="main-window">
          <Outlet />
        </section>
        <ChatPanel />
      </main>
    </div>
  );
}
