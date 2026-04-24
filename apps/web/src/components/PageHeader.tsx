import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { useChatPanel } from "../context/chat-panel-context-internal";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, actions }: PageHeaderProps) {
  const { open, toggle } = useChatPanel();
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
      </div>
      <div className="page-actions">
        {actions}
        <Button variant={open ? "secondary" : "primary"} onClick={toggle}>
          <i className="bx bx-message-square-detail" />
          {open ? "Hide chat" : "Open chat"}
        </Button>
      </div>
    </header>
  );
}
