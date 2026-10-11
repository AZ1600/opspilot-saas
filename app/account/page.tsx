import Link from "next/link";
import { SignOutButton, UserProfile } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { isClerkConfigured } from "@/lib/server/auth";

export default async function AccountPage({ searchParams }: {
  searchParams: Promise<{ issue?: string }>;
}) {
  if (!isClerkConfigured()) redirect("/login");
  if (!await currentUser()) redirect("/login");
  const { issue } = await searchParams;
  return (
    <main className="login-shell">
      <section className="login-panel clerk-login-panel">
        <div>
          <p className="eyebrow">OpsPilot access</p>
          <h1>{issue === "workspace" ? "Workspace access needs review" : "Verify your email to continue"}</h1>
          <p>{issue === "workspace"
            ? "We could not safely link this account to a workspace. Sign in with the account originally used for your workspace, or contact your workspace owner for help."
            : "Add and verify an email address below, then set it as your primary email. Return to your workspace when you have finished."}</p>
        </div>
        <UserProfile routing="hash" />
        <Link className="primary-button" href="/app">Return to workspace</Link>
        <SignOutButton redirectUrl="/login"><button className="secondary-button" type="button">Sign in with another account</button></SignOutButton>
      </section>
    </main>
  );
}
