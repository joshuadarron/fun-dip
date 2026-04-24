import { NavLink } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const navItems: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "bx-grid-alt" },
  { to: "/profile", label: "Profile", icon: "bx-user" },
  { to: "/programs", label: "Programs", icon: "bx-collection" },
  { to: "/submissions", label: "Submissions", icon: "bx-file" },
];

export function NavRail() {
  return (
    <aside className="nav-rail" aria-label="Primary navigation">
      <div className="brand-mark">
        <span>F</span>
      </div>
      <nav className="nav-list">
        {navItems.map((item) => (
          <Tooltip key={item.to}>
            <TooltipTrigger asChild>
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) => `nav-button ${isActive ? "active" : ""}`}
                aria-label={item.label}
              >
                <i className={`bx ${item.icon}`} />
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ))}
      </nav>
    </aside>
  );
}
