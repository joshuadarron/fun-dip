import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { PageHeader } from "../../components/PageHeader";

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
  { name: "Founder Residency", focus: "Pre-seed", fit: "High" },
  { name: "Climate Venture Lab", focus: "Climate", fit: "Medium" },
  { name: "AI Accelerator", focus: "B2B SaaS", fit: "Pending" },
];

export function DesignSystemPage() {
  return (
    <div className="page-grid design-system">
      <PageHeader eyebrow="Internal" title="Design system" />
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
