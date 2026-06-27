import { SignIn } from "@clerk/nextjs";
import { isClerkConfigured } from "@/lib/server/auth";

export default function LoginPage() {
  if (isClerkConfigured()) {
    return (
      <main className="login-shell">
        <section className="login-panel clerk-login-panel">
          <div>
            <p className="eyebrow">OpsPilot access</p>
            <h1>Sign in to OpsPilot</h1>
            <p>
              Production authentication is handled by Clerk. After sign-in,
              OpsPilot maps your identity to the workspace role model.
            </p>
          </div>
          <SignIn fallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" />
        </section>
      </main>
    );
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div>
          <p className="eyebrow">OpsPilot access</p>
          <h1>Choose a demo user</h1>
          <p>
            This is a prototype login that creates a signed session cookie. It
            lets us test owner, manager, and staff permissions before adding a
            production auth provider.
          </p>
        </div>

        <form action="/api/auth/login" method="post" className="login-form">
          <label>
            <span>Name</span>
            <input name="fullName" defaultValue="Demo Owner" />
          </label>
          <label>
            <span>Role</span>
            <select name="role" defaultValue="owner">
              <option value="owner">Owner</option>
              <option value="manager">Manager</option>
              <option value="staff">Staff</option>
            </select>
          </label>
          <button className="primary-button" type="submit">
            Enter workspace
          </button>
        </form>
      </section>
    </main>
  );
}
