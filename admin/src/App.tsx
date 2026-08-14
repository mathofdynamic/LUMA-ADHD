import { useEffect, useMemo, useState } from "react";

type SectionId =
  | "strategy-room"
  | "agents"
  | "threads"
  | "files"
  | "human-tasks"
  | "reputation"
  | "god"
  | "system"
  | "settings";

type HealthState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready" }
  | { readonly kind: "error"; readonly message: string };

interface NavItem {
  readonly id: SectionId;
  readonly label: string;
  readonly code: string;
}

interface SectionCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: "strategy-room", label: "Strategy Room", code: "01" },
  { id: "agents", label: "Agents", code: "02" },
  { id: "threads", label: "Threads", code: "03" },
  { id: "files", label: "Files", code: "04" },
  { id: "human-tasks", label: "Human Tasks", code: "05" },
  { id: "reputation", label: "Reputation", code: "06" },
  { id: "god", label: "GOD", code: "07" },
  { id: "system", label: "System", code: "08" },
  { id: "settings", label: "Settings", code: "09" },
];

const SECTION_COPY: Record<SectionId, SectionCopy> = {
  "strategy-room": {
    eyebrow: "Organizational memory / 00",
    title: "Strategy Room",
    description:
      "A calm surface for seeing what the organization is thinking, where reasoning is stalled, and what deserves a human decision.",
    emptyTitle: "The room is waiting for its first thread",
    emptyBody:
      "Phase 00 establishes the observatory. Durable discussions, bounded turns, and D1-backed memory arrive in the next foundation phase.",
  },
  agents: {
    eyebrow: "Roster / 00",
    title: "Agents",
    description:
      "A view into distinct specialties, philosophies, and responsibilities without turning rank into authority.",
    emptyTitle: "Agent identities are not configured yet",
    emptyBody:
      "The foundation records the module boundary and roster contract. Runtime identities become active only when orchestration is implemented.",
  },
  threads: {
    eyebrow: "Deliberation / 00",
    title: "Threads",
    description:
      "Persistent ideas should show their state, participants, evidence, objections, and next move at a glance.",
    emptyTitle: "No durable threads yet",
    emptyBody:
      "There is no synthetic activity here. The panel will stay honest until D1-backed thread state exists.",
  },
  files: {
    eyebrow: "Institutional memory / 00",
    title: "Files",
    description:
      "A text-first memory surface for research, proposals, decisions, and the evolving knowledge of LUMA.",
    emptyTitle: "The file index is empty",
    emptyBody:
      "Markdown files will become searchable and versioned through the memory layer in a later phase.",
  },
  "human-tasks": {
    eyebrow: "Escalation / 00",
    title: "Human Tasks",
    description:
      "Specific requests for information, judgment, approval, or action when the organization reaches the edge of its tools.",
    emptyTitle: "No human requests are open",
    emptyBody:
      "This empty state is intentional. LUMA should ask for human help only when a concrete blocker exists.",
  },
  reputation: {
    eyebrow: "Governance / 00",
    title: "Reputation",
    description:
      "Influence should grow slowly from evidence, contribution, collaboration, and outcomes—not message volume.",
    emptyTitle: "Reputation has not started moving",
    emptyBody:
      "The multidimensional reputation contract is reserved for later scoring and evaluation phases.",
  },
  god: {
    eyebrow: "Supervision / 00",
    title: "GOD",
    description:
      "A bounded supervisory layer for challenging weak consensus, surfacing missing perspectives, and protecting long-term quality.",
    emptyTitle: "No supervisory review exists",
    emptyBody:
      "GOD remains unconfigured until the frontier-provider and evaluation phases. Nothing is simulated here.",
  },
  system: {
    eyebrow: "Runtime / 00",
    title: "System",
    description:
      "The operational view for readiness, configuration, quota pressure, failures, and the boundaries that keep the system free-plan compatible.",
    emptyTitle: "Foundation runtime only",
    emptyBody:
      "Worker health is available. D1, Queue, Cron, and Static Assets are scaffolded locally; production resources are intentionally unconfigured.",
  },
  settings: {
    eyebrow: "Configuration / 00",
    title: "Settings",
    description:
      "A deliberate home for safe identifiers and guarded runtime configuration. Secrets never belong in the interface or repository.",
    emptyTitle: "Settings are not editable yet",
    emptyBody:
      "Configuration is documented in docs/SETUP_AND_SECRETS.md. Editing and authentication arrive with the admin phases.",
  },
};

function App() {
  const [activeSection, setActiveSection] = useState<SectionId>("strategy-room");
  const [health, setHealth] = useState<HealthState>({ kind: "loading" });
  const activeCopy = useMemo(() => SECTION_COPY[activeSection], [activeSection]);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/health", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Worker returned ${response.status}`);
        }
        return response.json() as Promise<{ ready?: boolean }>;
      })
      .then((payload) => {
        setHealth(payload.ready ? { kind: "ready" } : { kind: "error", message: "Worker is not ready" });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setHealth({
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to reach the Worker",
        });
      });

    return () => controller.abort();
  }, []);

  const healthLabel = health.kind === "loading"
    ? "Checking runtime"
    : health.kind === "ready"
      ? "Worker ready"
      : "Local shell only";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-lockup">
          <div className="brand-symbol" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <p className="brand-name">LUMA <span>ADHD</span></p>
            <p className="brand-subtitle">organization observatory</p>
          </div>
        </div>

        <div className="sidebar-rule" />
        <p className="nav-label">Navigate</p>
        <nav className="nav-list">
          {NAV_ITEMS.map((item) => (
            <button
              className={`nav-item${activeSection === item.id ? " is-active" : ""}`}
              key={item.id}
              type="button"
              aria-current={activeSection === item.id ? "page" : undefined}
              onClick={() => setActiveSection(item.id)}
            >
              <span className="nav-code">{item.code}</span>
              <span>{item.label}</span>
              {activeSection === item.id && <span className="nav-pulse" aria-hidden="true" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="phase-marker">
            <span className="status-dot" aria-hidden="true" />
            <span>Phase 00 / Foundation</span>
          </div>
          <p>Persistent thinking, deliberately bounded.</p>
        </div>
      </aside>

      <main id="main-content" className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <span>LUMA ADHD</span>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-current">Observatory</span>
          </div>
          <div className={`runtime-status runtime-${health.kind}`}>
            <span className="status-dot" aria-hidden="true" />
            <span>{healthLabel}</span>
          </div>
        </header>

        <div className="page-frame">
          <section className="hero-section" aria-labelledby="page-title">
            <div className="hero-copy">
              <p className="eyebrow"><span className="eyebrow-line" />{activeCopy.eyebrow}</p>
              <h1 id="page-title">{activeCopy.title}</h1>
              <p className="hero-description">{activeCopy.description}</p>
            </div>
            <div className="orbit-stage" aria-hidden="true">
              <div className="orbit orbit-outer" />
              <div className="orbit orbit-inner" />
              <div className="orbit-core"><span>00</span></div>
              <span className="orbit-node orbit-node-a" />
              <span className="orbit-node orbit-node-b" />
              <span className="orbit-node orbit-node-c" />
            </div>
          </section>

          <section className="observatory-panel" aria-labelledby="empty-state-title">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">Current surface</p>
                <h2>Observatory signal</h2>
              </div>
              <span className="panel-code">LUMA / 00</span>
            </div>

            <div className="empty-state">
              <div className="empty-glyph" aria-hidden="true">
                <span className="glyph-ring" />
                <span className="glyph-center" />
              </div>
              <div className="empty-copy">
                <p className="empty-label">Unconfigured surface</p>
                <h2 id="empty-state-title">{activeCopy.emptyTitle}</h2>
                <p>{activeCopy.emptyBody}</p>
              </div>
              <button className="quiet-button" type="button" onClick={() => setActiveSection("system")}>
                <span>View foundation state</span>
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          </section>

          <section className="foundation-strip" aria-label="Foundation boundaries">
            <div className="strip-intro">
              <p className="panel-kicker">Boundaries in place</p>
              <p>Only the surfaces that exist are shown.</p>
            </div>
            <div className="boundary-list">
              <div className="boundary-item"><span>01</span><strong>Worker</strong><small>ready</small></div>
              <div className="boundary-item"><span>02</span><strong>D1</strong><small>local binding</small></div>
              <div className="boundary-item"><span>03</span><strong>Queue</strong><small>reserved</small></div>
              <div className="boundary-item"><span>04</span><strong>Assets</strong><small>static shell</small></div>
            </div>
          </section>

          {health.kind === "error" && (
            <p className="runtime-note" role="status">
              {health.message}. The shell remains usable; start the local Worker to see its readiness signal.
            </p>
          )}
        </div>

        <footer className="main-footer">
          <span>Cloudflare Free-compatible foundation</span>
          <span className="footer-mark">D1 · CRON · QUEUE · STATIC ASSETS</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
