import 'server-only'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/auth'

export class UnauthenticatedError extends Error {
  constructor() { super('Authentication is required') }
}

export async function requireAuthenticatedUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) throw new UnauthenticatedError()
  return session.user
}
