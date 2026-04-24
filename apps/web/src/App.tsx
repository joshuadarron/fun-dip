import { useMemo, useState } from "react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Switch } from "./components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";

type PageId = "dashboard" | "database" | "design-system" | "settings";

type NavItem = {
  id: PageId;
  label: string;
  icon: string;
};

type ChatMessage = {
  role: "assistant" | "user";
  content: string;
};

const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "bx-grid-alt" },
  { id: "database", label: "Database", icon: "bx-data" },
  { id: "design-system", label: "Design System", icon: "bx-palette" },
  { id: "settings", label: "Settings", icon: "bx-cog" },
];

const seedMessages: ChatMessage[] = [
  {
    role: "assistant",
    content:
      "Hi, I can help build your company profile and find startup programs that fit. What is your company called?",
  },
  {
    role: "user",
    content: "We are exploring the first version of the product.",
  },
  {
    role: "assistant",
    content:
      "Great. I will keep this lightweight. Next I need your industry, stage, location, and what kind of programs you want to target.",
  },
];

const tokenGroups = [
  {
    title: "Surface",
    tokens: [
      ["Platform", "#ECE5CF"],
      ["Main window", "#FFFBF3"],
      ["Panel", "#F7F0E4"],
      ["Line", "#E4D9C8"],
    ],
  },
  {
    title: "Ink",
    tokens: [
      ["Primary text", "#1E1D1A"],
      ["Muted text", "#746F65"],
      ["Soft text", "#A29A8D"],
      ["Inverse", "#FFFBF3"],
    ],
  },
  {
    title: "Accent",
    tokens: [
      ["Primary", "#1F1E1B"],
      ["Warm accent", "#D8BFA4"],
      ["Focus", "#8C6F56"],
      ["Success", "#6F8F73"],
    ],
  },
];

const samplePrograms = [
  {
    name: "Founder Residency",
    focus: "Pre-seed",
    fit: "High",
    status: "Draft profile",
  },
  {
    name: "Climate Venture Lab",
    focus: "Climate",
    fit: "Medium",
    status: "Needs details",
  },
  {
    name: "AI Accelerator",
    focus: "B2B SaaS",
    fit: "Pending",
    status: "Not reviewed",
  },
];

function App() {
  const [activePage, setActivePage] = useState<PageId>("database");
  const [chatOpen, setChatOpen] = useState(true);
  const [messages, setMessages] = useState(seedMessages);
  const [draft, setDraft] = useState("");

  const activeLabel = useMemo(
    () => navItems.find((item) => item.id === activePage)?.label ?? "Database",
    [activePage],
  );

  function sendMessage() {
    const nextMessage = draft.trim();

    if (!nextMessage) {
      return;
    }

    setMessages((current) => [
      ...current,
      { role: "user", content: nextMessage },
      {
        role: "assistant",
        content:
          "Got it. I would save that to the profile and ask one more follow-up before searching programs.",
      },
    ]);
    setDraft("");
  }

  return (
    <TooltipProvider delayDuration={120}>
      <div className="app-shell">
        <NavRail activePage={activePage} onNavigate={setActivePage} />
        <main className={`workspace ${chatOpen ? "chat-open" : "chat-closed"}`}>
          <section className="main-window">
            <header className="page-header">
              <div>
                <p className="eyebrow">Smart startup program platform</p>
                <h1>{activeLabel}</h1>
              </div>
              <Button
                variant={chatOpen ? "secondary" : "primary"}
                onClick={() => setChatOpen((isOpen) => !isOpen)}
              >
                <i className="bx bx-message-square-detail" />
                {chatOpen ? "Hide chat" : "Open chat"}
              </Button>
            </header>
            {activePage === "dashboard" && <DashboardPage />}
            {activePage === "database" && <DatabasePage />}
            {activePage === "design-system" && <DesignSystemPage />}
            {activePage === "settings" && <SettingsPage />}
          </section>
          <ChatPanel
            isOpen={chatOpen}
            messages={messages}
            draft={draft}
            onDraftChange={setDraft}
            onSend={sendMessage}
            onClose={() => setChatOpen(false)}
          />
        </main>
      </div>
    </TooltipProvider>
  );
}

function NavRail({
  activePage,
  onNavigate,
}: {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
}) {
  const renderNavItem = (item: NavItem) => (
    <Tooltip key={item.id}>
      <TooltipTrigger asChild>
        <button
          className={`nav-button ${activePage === item.id ? "active" : ""}`}
          onClick={() => onNavigate(item.id)}
          aria-label={item.label}
        >
          <i className={`bx ${item.icon}`} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );

  return (
    <aside className="nav-rail" aria-label="Primary navigation">
      <div className="brand-mark">
        <img src="/images/fundip-icon.svg" alt="Fun Dip" />
      </div>
      <nav className="nav-list">
        {navItems.filter((item) => item.id !== "settings").map(renderNavItem)}
      </nav>
      <nav className="nav-list nav-list-bottom" aria-label="Workspace settings">
        {navItems.filter((item) => item.id === "settings").map(renderNavItem)}
      </nav>
    </aside>
  );
}

function DashboardPage() {
  return (
    <div className="page-grid">
      <Card className="hero-card">
        <CardHeader>
          <Badge>Overview</Badge>
          <CardTitle>Program operations, simplified.</CardTitle>
          <CardDescription>
            Track profile readiness, program discovery, and application progress from one calm
            workspace.
          </CardDescription>
        </CardHeader>
      </Card>
      <div className="stats-grid">
        {[
          ["0", "Programs reviewed"],
          ["0", "Applications drafted"],
          ["Draft", "Company profile"],
        ].map(([value, label]) => (
          <Card key={label}>
            <CardContent>
              <p className="stat-value">{value}</p>
              <p className="muted">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DatabasePage() {
  return (
    <div className="database-empty">
      <Card className="empty-state-card">
        <CardHeader>
          <Badge>Onboarding first</Badge>
          <CardTitle>Your database starts with a profile.</CardTitle>
          <CardDescription>
            The database is intentionally quiet right now. The chat assistant will collect company
            details first, then use them to structure startup program matches.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="profile-checklist">
            {[
              "Company basics",
              "Stage and traction",
              "Industry and geography",
              "Program preferences",
            ].map((item, index) => (
              <div className="checklist-row" key={item}>
                <span>{index + 1}</span>
                {item}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DesignSystemPage() {
  return (
    <div className="design-system">
      <section className="section-block">
        <div className="section-heading">
          <p className="eyebrow">Tokens</p>
          <h2>Color system</h2>
        </div>
        <div className="token-grid">
          {tokenGroups.map((group) => (
            <Card key={group.title}>
              <CardHeader>
                <CardTitle>{group.title}</CardTitle>
              </CardHeader>
              <CardContent className="token-list">
                {group.tokens.map(([name, value]) => (
                  <div className="token-row" key={name}>
                    <span className="token-swatch" style={{ backgroundColor: value }} />
                    <div>
                      <strong>{name}</strong>
                      <code>{value}</code>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <p className="eyebrow">Components</p>
          <h2>Live primitives</h2>
        </div>
        <div className="component-grid">
          <Card>
            <CardHeader>
              <CardTitle>Buttons and inputs</CardTitle>
              <CardDescription>Rounded-square controls with restrained contrast.</CardDescription>
            </CardHeader>
            <CardContent className="component-stack">
              <div className="button-row">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
              </div>
              <Input placeholder="Company name" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Switches and badges</CardTitle>
              <CardDescription>Radix-backed controls styled through app tokens.</CardDescription>
            </CardHeader>
            <CardContent className="component-stack">
              <div className="setting-row">
                <div>
                  <strong>Enable assistant panel</strong>
                  <p className="muted">Useful for onboarding and applications.</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="button-row">
                <Badge>Draft</Badge>
                <Badge>High fit</Badge>
                <Badge>Needs review</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <p className="eyebrow">Database</p>
          <h2>Table preview</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Program</TableHead>
              <TableHead>Focus</TableHead>
              <TableHead>Fit</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {samplePrograms.map((program) => (
              <TableRow key={program.name}>
                <TableCell>{program.name}</TableCell>
                <TableCell>{program.focus}</TableCell>
                <TableCell>
                  <Badge>{program.fit}</Badge>
                </TableCell>
                <TableCell>{program.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="page-grid">
      <Card>
        <CardHeader>
          <CardTitle>Workspace settings</CardTitle>
          <CardDescription>Static placeholders for the first frontend pass.</CardDescription>
        </CardHeader>
        <CardContent className="component-stack">
          <div className="setting-row">
            <div>
              <strong>Light mode</strong>
              <p className="muted">The current design system is light-only.</p>
            </div>
            <Switch checked disabled />
          </div>
          <div className="setting-row">
            <div>
              <strong>Mock chat responses</strong>
              <p className="muted">API wiring should happen through a server-side proxy later.</p>
            </div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ChatPanel({
  isOpen,
  messages,
  draft,
  onDraftChange,
  onSend,
  onClose,
}: {
  isOpen: boolean;
  messages: ChatMessage[];
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
}) {
  return (
    <aside className={`chat-panel ${isOpen ? "open" : ""}`} aria-hidden={!isOpen}>
      <header className="chat-header">
        <div className="assistant-avatar" />
        <div>
          <strong>Application Agent</strong>
          <p>Profile builder</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close chat">
          <i className="bx bx-x" />
        </Button>
      </header>
      <div className="chat-messages">
        {messages.map((message, index) => (
          <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
            {message.content}
          </div>
        ))}
      </div>
      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <Input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="Tell me about your company..."
        />
        <Button type="submit" size="icon" aria-label="Send message">
          <i className="bx bx-up-arrow-alt" />
        </Button>
      </form>
    </aside>
  );
}

export default App;
