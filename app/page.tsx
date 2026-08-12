import Link from "next/link";
import { isClerkConfigured } from "@/lib/server/auth";

export default function LandingPage() {
  const signInHref = isClerkConfigured() ? "/login" : "/app";

  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Primary navigation">
        <Link className="landing-brand" href="/">
          <span>OP</span>
          OpsPilot
        </Link>
        <div className="landing-nav-actions">
          <Link className="secondary-button link-button" href="/demo">
            Try demo
          </Link>
          <Link className="primary-button link-button" href={signInHref}>
            Sign in
          </Link>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow">AI operations manager for service businesses</p>
          <h1>Turn scattered business signals into approved action.</h1>
          <p className="landing-lede">
            OpsPilot finds missed revenue, customer risk, and operational work,
            then gives an owner one clear place to review what happens next.
          </p>
          <div className="landing-cta-row">
            <Link className="primary-button link-button" href="/demo">
              Explore the live demo
            </Link>
            <Link className="secondary-button link-button" href={signInHref}>
              Sign in to your workspace
            </Link>
          </div>
          <p className="landing-note">
            No account is required for the demo. Real workspaces remain protected
            by authentication and role-based access.
          </p>
        </div>

        <div className="landing-preview" aria-label="OpsPilot workflow preview">
          <p className="eyebrow">Today&apos;s operations brief</p>
          <h2>3 decisions need attention</h2>
          <div className="landing-preview-grid">
            <article>
              <span>Revenue at risk</span>
              <strong>$4,870</strong>
            </article>
            <article>
              <span>Urgent actions</span>
              <strong>3</strong>
            </article>
            <article>
              <span>Approval boundary</span>
              <strong>Human review</strong>
            </article>
          </div>
          <div className="landing-action-card">
            <span className="status high">Urgent</span>
            <div>
              <strong>Escalate repeat customer complaint</strong>
              <p>Evidence, value, draft response, and reason codes are ready.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-trust" aria-label="Product safeguards">
        <article>
          <strong>Review before execution</strong>
          <p>AI drafts work; a person approves it.</p>
        </article>
        <article>
          <strong>Tenant-aware access</strong>
          <p>Private workspaces retain Clerk authentication and roles.</p>
        </article>
        <article>
          <strong>Safe public demo</strong>
          <p>Visitors explore bundled data without touching production records.</p>
        </article>
      </section>
    </main>
  );
}
