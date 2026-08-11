'use client'

import { AppShell } from '@/components/app-shell'
import { AuthGate } from '@/components/auth-gate'

export default function HomePage() {
  return (
    <AuthGate>
      {(user) => <AppShell user={user} />}
    </AuthGate>
  )
}
