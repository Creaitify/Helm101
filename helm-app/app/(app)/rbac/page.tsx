import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PermissionMatrix } from '@/components/viz/PermissionMatrix'
import { DataTable } from '@/components/viz/DataTable'
import { StatusPill } from '@/components/ui/StatusPill'
import { getPermissions, getUsers } from '@/lib/data'
import type { Role, User } from '@/lib/types'

const ROLE_LABEL: Record<Role, string> = {
  master: 'Master Admin',
  agency: 'Agency Admin',
  strategist: 'Strategist',
  creative: 'Creative',
  analyst: 'Analyst',
  viewer: 'Client Viewer',
}

export default async function RbacPage() {
  const [permissions, users] = await Promise.all([getPermissions(), getUsers()])

  return (
    <div className="content page" data-page="rbac">
      <div className="phead">
        <div>
          <h1>
            Access & RBAC <span className="tag">MASTER CONSOLE</span>
          </h1>
          <p>Multi-level role-based access · you (Master Admin) sit at the top of every scope</p>
        </div>
        <Button variant="primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Invite user
        </Button>
      </div>

      <div className="bento">
        <Card className="col7">
          <div className="card-h">
            <div>
              <h3>Permission Matrix</h3>
              <div className="sub">roles × capabilities</div>
            </div>
            <span className="pill">6 roles</span>
          </div>
          <PermissionMatrix rows={permissions} />
        </Card>

        <Card className="col5">
          <div className="card-h">
            <div>
              <h3>Team Members</h3>
              <div className="sub">Finnovate tenant · {users.length} users</div>
            </div>
          </div>
          <DataTable
            columns={[
              { key: 'name', label: 'User', render: (r: User) => <span className="name">{r.name}</span> },
              { key: 'role', label: 'Role', render: (r: User) => ROLE_LABEL[r.role] },
              { key: 'status', label: 'Status', render: (r: User) => <StatusPill status={r.status} /> },
            ]}
            rows={users}
          />
        </Card>
      </div>
    </div>
  )
}
