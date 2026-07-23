export default function NoAccessPage() {
  return (
    <main className="login">
      <div className="login-card">
        <h1>No access</h1>
        <p>
          Your account signed in successfully but is not a member of any workspace.
          Ask a workspace administrator to invite you, then sign in again.
        </p>
      </div>
    </main>
  )
}
