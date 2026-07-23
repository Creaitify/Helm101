import { authOptions } from '@/auth'
import { LoginButtons } from './LoginButtons'

export default function LoginPage() {
  const providerIds = authOptions.providers.map((provider) => provider.id)

  return (
    <main className="login">
      <div className="login-card">
        <h1>HELM</h1>
        <p>Marketing operations control plane</p>
        <LoginButtons providerIds={providerIds} />
      </div>
    </main>
  )
}
