// Modern glass sign-in card (adapted from a shadcn/Tailwind .tsx to this
// project's plain-JSX + CSS stack). Presentational: state + auth are owned by
// the parent and passed in, so it drives the real CRM login (not the demo alert).
// Tailwind classes replaced with .msi-* CSS; HextaUI branding swapped for WEPRO.
export function SignIn1({
  email,
  setEmail,
  password,
  setPassword,
  error,
  loading,
  onSignIn,
  onKeyDown,
  onBack,
  footer,
}) {
  return (
    <div className="msi-card">
      <div className="msi-logo">W</div>
      <h2 className="msi-title">Sign in</h2>
      <p className="msi-sub">Welcome back to WEPRO CRM</p>

      <div className="msi-form">
        <div className="msi-fields">
          <input
            className="msi-input"
            placeholder="Email"
            type="email"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <input
            className="msi-input"
            placeholder="Password"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {error && <div className="msi-err">{error}</div>}
        </div>

        <hr className="msi-hr" />

        <div>
          <button className="msi-btn" onClick={onSignIn} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          {/* Demo-accounts slot (replaces the original's Google button) */}
          {footer}

          {onBack && (
            <div className="msi-altrow">
              <span>
                Just exploring?{' '}
                <a onClick={onBack} role="button" tabIndex={0}>Back to home</a>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SignIn1;
