import { useEffect, useMemo, useState } from 'react'
import {
  Plus,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Trash2,
  GripVertical,
} from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import { AppError } from '@/lib/admin'
import { useCollection } from '@/hooks/useCollection'
import { useScopedDeals } from '@/hooks/useScopedCollections'
import { useIndustries } from '@/hooks/useIndustries'
import { useSubcategories } from '@/hooks/useSubcategories'
import { usePlatforms } from '@/hooks/usePlatforms'
import {
  COL,
  type BundleItem,
  type Package,
  type Project,
  type ProjectKind,
  type Stage,
  type Subcategory,
  type User,
  type Role,
  ROLES,
} from '@/lib/types'
import { newId } from '@/lib/db'
import {
  useProfile,
  canSeeAdmin,
  canSeeAdminPage,
  isAdmin,
} from '@/context/auth'
import {
  createProject,
  createStage,
  createUserCallable,
  deleteProject,
  deleteStage,
  seedDefaultStages,
  setProjectCompleted,
  updateProject,
  updateStage,
  updateUser,
} from '@/lib/admin'
import {
  logActivity,
  createIndustry,
  deleteIndustry,
  reorderIndustries,
  seedDefaultIndustries,
  createSubcategory,
  deleteSubcategory,
  createPlatform,
  deletePlatform,
} from '@/lib/data'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { ProjectBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/toast-context'
import ImportSection from '@/components/admin/ImportSection'
import ProjectMembersModal from '@/components/admin/ProjectMembersModal'

// Admin sections, keyed for the tab nav. `fullAdmin` ones are hidden from
// non-full admins (who only manage Projects). Order = tab order.
type AdminTab =
  | 'users'
  | 'projects'
  | 'stages'
  | 'industries'
  | 'platforms'
  | 'import'

const ADMIN_TABS: { key: AdminTab; label: string; fullAdminOnly: boolean }[] = [
  { key: 'users', label: 'Team Members', fullAdminOnly: true },
  { key: 'projects', label: 'Projects', fullAdminOnly: false },
  { key: 'stages', label: 'Deal Stages', fullAdminOnly: true },
  { key: 'industries', label: 'Industries', fullAdminOnly: true },
  { key: 'platforms', label: 'Platforms', fullAdminOnly: true },
  { key: 'import', label: 'Import', fullAdminOnly: true },
]

export default function AdminPage() {
  const me = useProfile()
  const fullAdmin = canSeeAdmin(me.role)

  // Only the tabs this admin is allowed to see.
  const tabs = useMemo(
    () => ADMIN_TABS.filter((t) => fullAdmin || !t.fullAdminOnly),
    [fullAdmin],
  )
  const [tab, setTab] = useState<AdminTab>(() => tabs[0]?.key ?? 'projects')

  if (!canSeeAdminPage(me.role)) {
    return (
      <div className="rounded-xl border border-line bg-white p-10 text-center text-[13px] text-ink-3">
        You don’t have access to this page.
      </div>
    )
  }

  // Guard against a stale tab (e.g. role changed) pointing at a hidden section.
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key

  return (
    <>
      {/* Section nav — sticks to the top so it stays reachable while a long
          section (e.g. Team Members) scrolls underneath. The negative margins
          cancel <main>'s p-5 so the translucent strip spans the full width and
          covers content scrolling up to the very top edge. */}
      <nav className="sticky top-0 z-10 -mx-5 -mt-5 flex flex-wrap gap-2 border-b border-line bg-ghost/85 px-5 pb-2.5 pt-5 backdrop-blur">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={t.key === activeTab ? 'page' : undefined}
            className={
              'rounded-lg border-[1.5px] px-4 py-1.5 text-[13px] font-semibold transition-colors ' +
              (t.key === activeTab
                ? 'border-major bg-major text-white'
                : 'border-line bg-white text-ink-2 hover:border-major hover:text-major')
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      {activeTab === 'users' && fullAdmin && <UsersSection />}
      {activeTab === 'projects' && <ProjectsSection />}
      {activeTab === 'stages' && fullAdmin && <StagesSection />}
      {activeTab === 'industries' && fullAdmin && <IndustriesSection />}
      {activeTab === 'platforms' && fullAdmin && <PlatformsSection />}
      {activeTab === 'import' && fullAdmin && <ImportSection />}
    </>
  )
}

// ─── Users ──────────────────────────────────────────────────────────────────

function UsersSection() {
  const me = useProfile()
  const toast = useToast()
  const { data: users } = useCollection<User>(COL.users)
  const { data: projects } = useCollection<Project>(COL.projects)
  const [addOpen, setAddOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  async function disable(u: User) {
    if (!window.confirm(`Disable ${u.name}? They won't be able to sign in.`))
      return
    await updateUser(u.id, { disabled: true })
    await logActivity({
      who: me.id,
      whoName: me.name,
      kind: 'user.update',
      text: `disabled ${u.name}`,
      refId: u.id,
      refKind: 'user',
    })
    toast.show(`${u.name} disabled`)
  }

  async function reEnable(u: User) {
    await updateUser(u.id, { disabled: false })
    toast.show(`${u.name} re-enabled`)
  }

  return (
    <section className="rounded-xl border border-line bg-white px-5 py-5">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[14px] font-bold">Team Members</h2>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={12} /> Add Member
        </Button>
      </header>

      {users.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] italic text-ink-3">
          No team members yet.
        </p>
      ) : (
        <div>
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-3 border-b border-line py-2.5 last:border-0"
            >
              <div
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
                style={{ background: u.color }}
              >
                {u.name[0]?.toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 text-[13.5px] font-semibold">
                  {u.name}
                  <RoleBadge role={u.role} />
                  {u.disabled && (
                    <span className="rounded-md bg-bad-light px-2 py-px text-[10.5px] font-semibold text-bad">
                      DISABLED
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-ink-3">{u.email}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {u.projectIds.map((pid) => (
                    <ProjectBadge
                      key={pid}
                      projectId={pid}
                      projects={projects}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-1.5">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditingId(u.id)}
                >
                  Edit
                </Button>
                {u.role !== 'Admin' &&
                  (u.disabled ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => reEnable(u)}
                    >
                      Re-enable
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      size="xs"
                      onClick={() => disable(u)}
                    >
                      Disable
                    </Button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddMemberModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        projects={projects}
      />
      <EditMemberModal
        userId={editingId}
        users={users}
        projects={projects}
        onClose={() => setEditingId(null)}
      />
    </section>
  )
}

function RoleBadge({ role }: { role: Role }) {
  const bg: Record<Role, string> = {
    Admin: 'bg-major-light text-major',
    Head: 'bg-info-light text-info',
    'Sales Head': 'bg-info-light text-info',
    BD: 'bg-grape-light text-grape',
    Rep: 'bg-ok-light text-ok',
    Intern: 'bg-warn-light text-warn',
  }
  return (
    <span
      className={`rounded-md px-2 py-px text-[10.5px] font-semibold ${bg[role]}`}
    >
      {role}
    </span>
  )
}

function AddMemberModal({
  open,
  onClose,
  projects,
}: {
  open: boolean
  onClose: () => void
  projects: Project[]
}) {
  const me = useProfile()
  const toast = useToast()
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'Rep' as Role,
    color: '#5B4FCF',
    projectIds: [] as string[],
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setForm({
      name: '',
      email: '',
      password: '',
      role: 'Rep',
      color: '#5B4FCF',
      projectIds: [],
    })
    setError(null)
  }

  function toggleProject(pid: string) {
    setForm((f) =>
      f.projectIds.includes(pid)
        ? { ...f, projectIds: f.projectIds.filter((x) => x !== pid) }
        : { ...f, projectIds: [...f.projectIds, pid] },
    )
  }

  async function save() {
    if (!form.name.trim() || !form.email.trim()) {
      setError('Name and email are required.')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { uid } = await createUserCallable(form)
      await logActivity({
        who: me.id,
        whoName: me.name,
        kind: 'user.create',
        text: `added team member ${form.name} (${form.role})`,
        refId: uid,
        refKind: 'user',
      })
      toast.show(`Invite created for ${form.name}`)
      reset()
      onClose()
    } catch (err) {
      if (err instanceof AppError) {
        if (err.code === 'functions/not-found') {
          setError(
            'The create-user endpoint is not deployed yet. See SETUP.md.',
          )
        } else if (err.code === 'functions/already-exists') {
          setError('A user with that email already exists.')
        } else {
          setError(err.message)
        }
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Failed to create user.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Add Team Member"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              reset()
              onClose()
            }}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Creating…' : 'Create Member'}
          </Button>
        </>
      }
    >
      <FormRow>
        <Field
          label="Full Name *"
          value={form.name}
          onChange={(v) => setForm({ ...form, name: v })}
        />
        <Field
          label="Work Email *"
          value={form.email}
          onChange={(v) => setForm({ ...form, email: v })}
          placeholder="name@kreateandco.co"
        />
      </FormRow>
      <FormRow>
        <Field
          label="Initial Password *"
          value={form.password}
          onChange={(v) => setForm({ ...form, password: v })}
          placeholder="Min 8 characters"
          type="password"
        />
        <SelectField
          label="Role"
          value={form.role}
          onChange={(v) => setForm({ ...form, role: v as Role })}
          options={ROLES}
        />
      </FormRow>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Avatar Color
        </label>
        <input
          type="color"
          value={form.color}
          onChange={(e) => setForm({ ...form, color: e.target.value })}
          className="h-10 w-24 cursor-pointer rounded-lg border-[1.5px] border-line p-1"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Projects
        </label>
        {projects.length === 0 ? (
          <p className="text-[12.5px] italic text-ink-3">
            No projects yet — create one below first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {projects.map((p) => {
              const on = form.projectIds.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleProject(p.id)}
                  className={`rounded-md border-[1.5px] px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                    on
                      ? 'border-major bg-major text-white'
                      : 'border-line bg-white text-ink-2 hover:border-major'
                  }`}
                >
                  {p.name}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {error && (
        <div className="rounded-lg bg-bad-light px-3 py-2 text-[12.5px] font-medium text-bad">
          {error}
        </div>
      )}
    </Modal>
  )
}

function EditMemberModal({
  userId,
  users,
  projects,
  onClose,
}: {
  userId: string | null
  users: User[]
  projects: Project[]
  onClose: () => void
}) {
  const me = useProfile()
  const toast = useToast()
  const user = userId ? users.find((u) => u.id === userId) : null
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('Rep')
  const [color, setColor] = useState('#5B4FCF')
  const [projectIds, setProjectIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  // Seed the form fields when the modal opens for a different user — syncing
  // local state to the `user` prop.
  useEffect(() => {
    if (user) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setName(user.name)
      setRole(user.role)
      setColor(user.color)
      setProjectIds(user.projectIds)
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  if (!user) return null

  function toggleProject(pid: string) {
    setProjectIds((p) =>
      p.includes(pid) ? p.filter((x) => x !== pid) : [...p, pid],
    )
  }

  async function save() {
    if (!user) return
    setBusy(true)
    try {
      await updateUser(user.id, { name, role, color, projectIds })
      await logActivity({
        who: me.id,
        whoName: me.name,
        kind: 'user.update',
        text: `updated ${name}`,
        refId: user.id,
        refKind: 'user',
      })
      toast.show('Updated')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!userId}
      onClose={onClose}
      title={`Edit ${user.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <FormRow>
        <Field label="Name" value={name} onChange={setName} />
        <SelectField
          label="Role"
          value={role}
          onChange={(v) => setRole(v as Role)}
          options={ROLES}
        />
      </FormRow>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Color
        </label>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-10 w-24 cursor-pointer rounded-lg border-[1.5px] border-line p-1"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Projects
        </label>
        <div className="flex flex-wrap gap-1.5">
          {projects.map((p) => {
            const on = projectIds.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleProject(p.id)}
                className={`rounded-md border-[1.5px] px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                  on
                    ? 'border-major bg-major text-white'
                    : 'border-line bg-white text-ink-2 hover:border-major'
                }`}
              >
                {p.name}
              </button>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}

// ─── Projects ───────────────────────────────────────────────────────────────

function ProjectsSection() {
  const me = useProfile()
  const toast = useToast()
  const { data: projects } = useCollection<Project>(COL.projects)
  const { data: users } = useCollection<User>(COL.users)
  // AdminPage is only reachable by Admin/Sales Head — both `canSeeAll` —
  // so the scoped reader returns the full deals listener here, matching
  // what the prior unscoped useCollection<Deal> did.
  const { data: deals } = useScopedDeals()
  // Which kind of project the "add" modal is creating (null = closed).
  const [addKind, setAddKind] = useState<ProjectKind | null>(null)
  const [editing, setEditing] = useState<Project | null>(null)
  const [managingMembers, setManagingMembers] = useState<Project | null>(null)

  const fullAdmin = isAdmin(me.role)

  async function removeProject(p: Project) {
    if (
      !window.confirm(
        `Delete project "${p.name}"? Existing deals on this project will be orphaned.`,
      )
    )
      return
    await deleteProject(p.id)
    await logActivity({
      who: me.id,
      whoName: me.name,
      kind: 'project.update',
      text: `deleted project ${p.name}`,
      refId: p.id,
      refKind: 'project',
    })
    toast.show('Project deleted')
  }

  async function toggleComplete(p: Project) {
    const next = !p.completed
    try {
      await setProjectCompleted(p.id, next)
      await logActivity({
        who: me.id,
        whoName: me.name,
        kind: 'project.update',
        text: next
          ? `marked project ${p.name} complete`
          : `reopened project ${p.name}`,
        refId: p.id,
        refKind: 'project',
      })
      toast.show(next ? `${p.name} marked complete` : `${p.name} reopened`)
    } catch (err) {
      toast.show(
        err instanceof Error ? err.message : "Couldn't update project",
      )
    }
  }

  return (
    <section className="rounded-xl border border-line bg-white px-5 py-5">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[14px] font-bold">Projects</h2>
        {fullAdmin && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setAddKind('normal')}>
              <Plus size={12} /> New Project
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAddKind('bundle')}
            >
              <Plus size={12} /> New Bundle
            </Button>
          </div>
        )}
      </header>

      {projects.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] italic text-ink-3">
          No projects yet. Add one to start tracking deals.
        </p>
      ) : (
        <div>
          {projects.map((p) => {
            const members = users.filter((u) => u.projectIds.includes(p.id))
            const dealCount = deals.filter((d) => d.projectId === p.id).length
            return (
              <div
                key={p.id}
                className="flex items-center gap-3 border-b border-line py-2.5 last:border-0"
              >
                <span
                  className="h-3 w-3 flex-shrink-0 rounded-full"
                  style={{ background: p.color }}
                />
                <div className="flex flex-1 items-center gap-2">
                  <span className="text-[13.5px] font-semibold">{p.name}</span>
                  {p.kind === 'bundle' && (
                    <span className="rounded-full bg-major-light px-2 py-px text-[10px] font-bold uppercase tracking-wider text-major">
                      Bundle
                    </span>
                  )}
                  {p.completed && (
                    <span className="rounded-full bg-ok-light px-2 py-px text-[10px] font-bold uppercase tracking-wider text-ok">
                      Completed
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-ink-3">
                  {members.length} {members.length === 1 ? 'member' : 'members'}{' '}
                  · {dealCount} {dealCount === 1 ? 'deal' : 'deals'}
                </div>
                <div className="mx-3 flex flex-wrap gap-1">
                  {members.map((m) => (
                    <span
                      key={m.id}
                      title={m.name}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ background: m.color }}
                    >
                      {m.name[0]?.toUpperCase()}
                    </span>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setManagingMembers(p)}
                  >
                    Manage members
                  </Button>
                  {fullAdmin && (
                    <>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => toggleComplete(p)}
                      >
                        {p.completed ? 'Reopen' : 'Mark complete'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setEditing(p)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="xs"
                        onClick={() => removeProject(p)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ProjectModal
        mode={addKind ? 'add' : editing ? 'edit' : null}
        addKind={addKind ?? 'normal'}
        project={editing}
        onClose={() => {
          setAddKind(null)
          setEditing(null)
        }}
      />

      <ProjectMembersModal
        project={managingMembers}
        users={users}
        onClose={() => setManagingMembers(null)}
      />
    </section>
  )
}

function ProjectModal({
  mode,
  addKind,
  project,
  onClose,
}: {
  mode: 'add' | 'edit' | null
  // Which kind to create when mode === 'add'. Ignored in edit mode (the
  // project's own kind is used and not changed).
  addKind: ProjectKind
  project: Project | null
  onClose: () => void
}) {
  const me = useProfile()
  const toast = useToast()
  const { data: allProjects } = useCollection<Project>(COL.projects)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#5B4FCF')
  const [description, setDescription] = useState('')
  const [packages, setPackages] = useState<Package[]>([])
  // Bundle state: cross-project line items + one price (a bundle is stored as a
  // single package { id, items, price }).
  const [bundleItems, setBundleItems] = useState<BundleItem[]>([])
  const [bundlePrice, setBundlePrice] = useState(0)
  const [bundlePkgId, setBundlePkgId] = useState('')
  const [busy, setBusy] = useState(false)

  // The kind being edited/created.
  const kind: ProjectKind =
    mode === 'edit' ? (project?.kind ?? 'normal') : addKind
  const isBundle = kind === 'bundle'

  // Seed the form when opening in edit mode, or clear it in add mode —
  // syncing local state to the mode/project props.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (mode === 'edit' && project) {
      setName(project.name)
      setColor(project.color)
      setDescription(project.description ?? '')
      setPackages(project.packages ?? [])
      const bundlePkg = project.packages?.[0]
      setBundleItems(bundlePkg?.items ?? [])
      setBundlePrice(bundlePkg?.price ?? 0)
      setBundlePkgId(bundlePkg?.id ?? '')
    } else if (mode === 'add') {
      setName('')
      setColor('#5B4FCF')
      setDescription('')
      setPackages([])
      setBundleItems([])
      setBundlePrice(0)
      setBundlePkgId('')
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, project?.id])

  if (!mode) return null

  // Normal projects an admin can mix into a bundle (exclude bundles themselves
  // and the project being edited).
  const bundleableProjects = allProjects.filter(
    (p) => (p.kind ?? 'normal') === 'normal' && p.id !== project?.id,
  )

  // For a bundle, build its single package; for a normal project, clean the
  // package list.
  function packagesToSave(): Package[] {
    if (isBundle) {
      const items = bundleItems.filter(
        (it) => it.projectId && Number(it.videos) > 0,
      )
      if (items.length === 0) return []
      return [
        {
          id: bundlePkgId || newId(),
          items,
          price: Math.max(0, Number(bundlePrice) || 0),
        },
      ]
    }
    return cleanPackages(packages)
  }

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    try {
      if (mode === 'edit' && project) {
        await updateProject(project.id, {
          name,
          color,
          description,
          packages: packagesToSave(),
        })
        await logActivity({
          who: me.id,
          whoName: me.name,
          kind: 'project.update',
          text: `updated ${isBundle ? 'bundle' : 'project'} ${name}`,
          refId: project.id,
          refKind: 'project',
        })
        toast.show(isBundle ? 'Bundle updated' : 'Project updated')
      } else {
        const id = await createProject({
          name,
          color,
          description,
          memberIds: [],
          kind,
          packages: packagesToSave(),
        })
        await logActivity({
          who: me.id,
          whoName: me.name,
          kind: 'project.create',
          text: `created ${isBundle ? 'bundle' : 'project'} ${name}`,
          refId: id,
          refKind: 'project',
        })
        toast.show(isBundle ? 'Bundle created' : 'Project created')
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const title =
    mode === 'edit'
      ? isBundle
        ? 'Edit Bundle'
        : 'Edit Project'
      : isBundle
        ? 'New Bundle'
        : 'New Project'

  return (
    <Modal
      open={!!mode}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <Field
        label={isBundle ? 'Bundle Name *' : 'Project Name *'}
        value={name}
        onChange={setName}
        placeholder={isBundle ? 'e.g. Bundle X' : 'e.g. WE Telecom'}
      />
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Color
        </label>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-10 w-24 cursor-pointer rounded-lg border-[1.5px] border-line p-1"
        />
      </div>
      <Field
        label="Description"
        value={description}
        onChange={setDescription}
        placeholder={
          isBundle ? 'What does this bundle include?' : 'What is this project about?'
        }
      />
      {isBundle ? (
        <BundleEditor
          items={bundleItems}
          price={bundlePrice}
          projects={bundleableProjects}
          onItemsChange={setBundleItems}
          onPriceChange={setBundlePrice}
        />
      ) : (
        <PackageEditor packages={packages} onChange={setPackages} />
      )}
    </Modal>
  )
}

// Editor for a bundle: cross-project line items (N videos from project A) plus
// one bundle price. A bundle is stored as a single package { id, items, price }.
function BundleEditor({
  items,
  price,
  projects,
  onItemsChange,
  onPriceChange,
}: {
  items: BundleItem[]
  price: number
  projects: Project[]
  onItemsChange: (next: BundleItem[]) => void
  onPriceChange: (next: number) => void
}) {
  function addItem() {
    const first = projects[0]
    onItemsChange([
      ...items,
      {
        projectId: first?.id ?? '',
        projectName: first?.name ?? '',
        videos: 1,
      },
    ])
  }
  function patchItem(index: number, patch: Partial<BundleItem>) {
    onItemsChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }
  function removeItem(index: number) {
    onItemsChange(items.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Bundle contents
        </label>
        <button
          type="button"
          onClick={addItem}
          disabled={projects.length === 0}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-major transition-colors hover:bg-major-light disabled:opacity-40"
        >
          <Plus size={12} /> Add project
        </button>
      </div>

      {projects.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[12px] italic text-ink-3">
          No normal projects to bundle yet — create UGC / Influencers projects
          first, then mix them here.
        </p>
      ) : items.length === 0 ? (
        <p className="text-[12px] italic text-ink-3">
          A bundle mixes videos from several projects (e.g. 10 from UGC + 20 from
          Influencers) at one price.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-ghost/50 px-3 py-2"
            >
              <input
                type="number"
                min={1}
                value={it.videos}
                onChange={(e) =>
                  patchItem(i, {
                    videos: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                className="w-16 rounded-md border-[1.5px] border-line bg-white px-2 py-1 text-[13px] outline-none focus:border-major"
              />
              <span className="text-[12.5px] text-ink-2">videos from</span>
              <select
                value={it.projectId}
                onChange={(e) => {
                  const proj = projects.find((p) => p.id === e.target.value)
                  patchItem(i, {
                    projectId: proj?.id ?? '',
                    projectName: proj?.name ?? '',
                  })
                }}
                className="flex-1 rounded-md border-[1.5px] border-line bg-white px-2 py-1 text-[13px] outline-none focus:border-major"
              >
                {/* Keep a stale project selectable so editing a bundle whose
                    source project was deleted doesn't silently drop the line. */}
                {!projects.some((p) => p.id === it.projectId) && it.projectId && (
                  <option value={it.projectId}>{it.projectName} (removed)</option>
                )}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeItem(i)}
                aria-label="Remove line"
                title="Remove line"
                className="rounded-md p-1 text-ink-3 transition-colors hover:bg-bad-light hover:text-bad"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-1 flex items-center gap-2">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Bundle price
        </label>
        <input
          type="number"
          min={0}
          value={price}
          onChange={(e) => onPriceChange(Math.max(0, Number(e.target.value) || 0))}
          placeholder="0"
          className="w-32 rounded-md border-[1.5px] border-line bg-white px-2 py-1 text-[13px] outline-none focus:border-major"
        />
      </div>
    </div>
  )
}

// Drop packages with no videos before saving, and coerce numbers, so the
// stored array stays clean regardless of half-finished editing. `creators` is
// optional — only persisted when it's a positive number (otherwise omitted, so
// it reads back as undefined and isn't displayed).
function cleanPackages(packages: Package[]): Package[] {
  return packages
    .map((p) => {
      const creators = Math.max(0, Number(p.creators) || 0)
      return {
        id: p.id,
        videos: Math.max(0, Number(p.videos) || 0),
        price: Math.max(0, Number(p.price) || 0),
        ...(creators > 0 ? { creators } : {}),
      }
    })
    .filter((p) => p.videos > 0)
}

// Editor for a project's packages. Each package is simply a number of videos
// at a price (e.g. 10 videos / 20 videos / 30 videos). A project can have many.
function PackageEditor({
  packages,
  onChange,
}: {
  packages: Package[]
  onChange: (next: Package[]) => void
}) {
  function addPackage() {
    onChange([...packages, { id: newId(), videos: 1, price: 0 }])
  }
  function removePackage(pid: string) {
    onChange(packages.filter((p) => p.id !== pid))
  }
  function patchPackage(pid: string, patch: Partial<Package>) {
    onChange(packages.map((p) => (p.id === pid ? { ...p, ...patch } : p)))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Packages
        </label>
        <button
          type="button"
          onClick={addPackage}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-major transition-colors hover:bg-major-light"
        >
          <Plus size={12} /> Add package
        </button>
      </div>

      {packages.length === 0 ? (
        <p className="text-[12px] italic text-ink-3">
          No packages yet. A package is a number of videos at a price (e.g. 10,
          20, or 30 videos).
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className="flex items-center gap-2 rounded-xl border border-line bg-ghost/50 px-3 py-2"
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  value={pkg.videos}
                  onChange={(e) =>
                    patchPackage(pkg.id, {
                      videos: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-20 rounded-md border-[1.5px] border-line bg-white px-2 py-1 text-[13px] outline-none focus:border-major"
                />
                <span className="text-[12.5px] text-ink-2">videos</span>
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  value={pkg.creators ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    patchPackage(pkg.id, {
                      // Empty input → undefined (not specified, not displayed).
                      creators: v === '' ? undefined : Math.max(0, Number(v) || 0),
                    })
                  }}
                  placeholder="—"
                  title="Number of creators (optional)"
                  className="w-16 rounded-md border-[1.5px] border-line bg-white px-2 py-1 text-[13px] outline-none focus:border-major"
                />
                <span className="text-[12.5px] text-ink-2">creators</span>
              </div>

              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  Price
                </span>
                <input
                  type="number"
                  min={0}
                  value={pkg.price}
                  onChange={(e) =>
                    patchPackage(pkg.id, {
                      price: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  placeholder="0"
                  className="w-28 rounded-md border-[1.5px] border-line bg-white px-2 py-1 text-[13px] outline-none focus:border-major"
                />
              </div>

              <button
                type="button"
                onClick={() => removePackage(pkg.id)}
                aria-label="Remove package"
                title="Remove package"
                className="rounded-md p-1 text-ink-3 transition-colors hover:bg-bad-light hover:text-bad"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Stages ─────────────────────────────────────────────────────────────────

function StagesSection() {
  const me = useProfile()
  const toast = useToast()
  const { data: stages } = useCollection<Stage>(COL.stages)
  const [addOpen, setAddOpen] = useState(false)
  const [seeding, setSeeding] = useState(false)

  const sorted = useMemo(
    () => stages.slice().sort((a, b) => a.order - b.order),
    [stages],
  )

  async function moveStage(stage: Stage, direction: -1 | 1) {
    const idx = sorted.findIndex((s) => s.id === stage.id)
    const neighborIdx = idx + direction
    if (neighborIdx < 0 || neighborIdx >= sorted.length) return
    const neighbor = sorted[neighborIdx]
    if (neighbor.locked) return // can't swap with locked Signed
    await Promise.all([
      updateStage(stage.id, { order: neighbor.order }),
      updateStage(neighbor.id, { order: stage.order }),
    ])
  }

  async function removeStage(s: Stage) {
    if (s.locked) return
    if (
      !window.confirm(
        `Remove stage "${s.name}"? Existing deals in this stage will keep the value as a string but will not match any stage.`,
      )
    )
      return
    await deleteStage(s.id)
    toast.show('Stage removed')
  }

  async function handleSeed() {
    if (stages.length > 0) return
    setSeeding(true)
    try {
      await seedDefaultStages()
      await logActivity({
        who: me.id,
        whoName: me.name,
        kind: 'stage.create',
        text: 'seeded default stages',
      })
      toast.show('Default stages added')
    } finally {
      setSeeding(false)
    }
  }

  return (
    <section className="rounded-xl border border-line bg-white px-5 py-5">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[14px] font-bold">Deal Stages</h2>
        <div className="flex gap-2">
          {stages.length === 0 && (
            <Button variant="ghost" size="sm" onClick={handleSeed} disabled={seeding}>
              {seeding ? 'Seeding…' : 'Seed defaults'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={12} /> Add Stage
          </Button>
        </div>
      </header>

      {sorted.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] italic text-ink-3">
          No stages yet. Click <b>Seed defaults</b> to add the seven from the demo.
        </p>
      ) : (
        <div>
          {sorted.map((s, i) => {
            const isFirstMovable = i === 0
            const isLastMovable = i === sorted.length - 1 || s.locked
            return (
              <div
                key={s.id}
                className="mb-1.5 flex items-center gap-2.5 rounded-lg border border-line bg-white px-3 py-2"
              >
                <span
                  className="h-3 w-3 flex-shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
                <div className="flex-1 text-[13px] font-medium">{s.name}</div>
                {s.locked ? (
                  <span className="text-[11px] italic text-ink-4">
                    Locked · cannot remove
                  </span>
                ) : (
                  <div className="flex gap-1">
                    <IconBtn
                      label="Move up"
                      disabled={isFirstMovable}
                      onClick={() => moveStage(s, -1)}
                    >
                      <ChevronUp size={13} />
                    </IconBtn>
                    <IconBtn
                      label="Move down"
                      disabled={isLastMovable}
                      onClick={() => moveStage(s, 1)}
                    >
                      <ChevronDown size={13} />
                    </IconBtn>
                    <IconBtn
                      label="Delete"
                      danger
                      onClick={() => removeStage(s)}
                    >
                      <Trash2 size={13} />
                    </IconBtn>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <AddStageModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        nextOrder={
          sorted.filter((s) => !s.locked).length === 0
            ? 0
            : Math.max(...sorted.filter((s) => !s.locked).map((s) => s.order)) +
              1
        }
      />
    </section>
  )
}

// ─── Industries (admin only) ─────────────────────────────────────────────────
// Admin-managed industry list. Admins can drag rows to reorder them (the order
// drives every industry dropdown across the app), add/delete industries, and
// expand a row to manage its subcategories. Moved here from the Settings page.

function IndustriesSection() {
  const toast = useToast()
  const { industries } = useIndustries()
  const { byIndustry } = useSubcategories()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  // Rows reorder by dragging. PointerSensor with a small activation distance so
  // a plain click on the row (expand) isn't swallowed as a drag — same setting
  // the pipeline board uses.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  async function handleDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id)
    const overId = e.over ? String(e.over.id) : null
    if (!overId || activeId === overId) return
    const ids = industries.map((i) => i.id)
    const from = ids.indexOf(activeId)
    const to = ids.indexOf(overId)
    if (from === -1 || to === -1) return
    // Splice the dragged id out and reinsert it at the drop target's slot.
    ids.splice(to, 0, ids.splice(from, 1)[0])
    try {
      await reorderIndustries(ids)
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't save the order")
    }
  }

  async function add() {
    const n = name.trim()
    if (!n) return
    if (industries.some((i) => i.name.toLowerCase() === n.toLowerCase())) {
      toast.show(`"${n}" already exists`)
      return
    }
    setBusy(true)
    try {
      // Append to the end: one past the current highest order.
      const nextOrder =
        industries.length === 0
          ? 0
          : Math.max(...industries.map((i) => i.order)) + 1
      await createIndustry(n, nextOrder)
      setName('')
      toast.show(`Added "${n}"`)
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't add industry")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string, label: string) {
    if (
      !window.confirm(
        `Delete the "${label}" industry? Leads already set to it keep the value, but it won't be offered in the dropdowns anymore.`,
      )
    )
      return
    try {
      await deleteIndustry(id)
      toast.show(`Deleted "${label}"`)
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't delete")
    }
  }

  async function seed() {
    setBusy(true)
    try {
      await seedDefaultIndustries()
      toast.show('Default industries added')
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't add defaults")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-line bg-white px-5 py-5">
      <header className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-[14px] font-bold">Industries</h2>
          <span className="text-[12px] text-ink-3">({industries.length})</span>
        </div>
      </header>
      <p className="mb-3 text-[12.5px] text-ink-3">
        The industry options leads can be assigned to across the app. Drag
        to reorder — the order here is the order shown in every dropdown.
      </p>

      <div className="mb-3 flex max-w-[380px] gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
          placeholder="New industry name…"
          className="flex-1 rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13.5px] outline-none transition-colors focus:border-major"
        />
        <Button onClick={add} disabled={busy || !name.trim()}>
          <Plus size={13} /> Add
        </Button>
      </div>

      {industries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-4 py-5 text-center">
          <p className="text-[12.5px] text-ink-3">
            No industries created yet — the dropdowns are showing the built-in
            defaults.
          </p>
          <button
            type="button"
            onClick={seed}
            disabled={busy}
            className="mt-2 rounded-lg bg-major px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#4a3fb8] disabled:opacity-50"
          >
            Add the default industries
          </button>
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <ul className="flex max-w-[460px] flex-col gap-1.5">
            {industries.map((ind) => (
              <IndustryRow
                key={ind.id}
                industryId={ind.id}
                industryName={ind.name}
                subcategories={byIndustry(ind.name)}
                onDeleteIndustry={() => remove(ind.id, ind.name)}
              />
            ))}
          </ul>
        </DndContext>
      )}
    </section>
  )
}

// One industry row: a drag handle to reorder, the name (click to expand its
// subcategory manager), and a delete button. The whole row is also a drop
// target so dragging onto it reorders.
function IndustryRow({
  industryId,
  industryName,
  subcategories,
  onDeleteIndustry,
}: {
  industryId: string
  industryName: string
  subcategories: Subcategory[]
  onDeleteIndustry: () => void
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [subName, setSubName] = useState('')
  const [busy, setBusy] = useState(false)

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: industryId })
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: industryId })

  async function addSub() {
    const n = subName.trim()
    if (!n) return
    if (subcategories.some((s) => s.name.toLowerCase() === n.toLowerCase())) {
      toast.show(`"${n}" already exists under ${industryName}`)
      return
    }
    setBusy(true)
    try {
      await createSubcategory(n, industryName)
      setSubName('')
      toast.show(`Added "${n}" to ${industryName}`)
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't add subcategory")
    } finally {
      setBusy(false)
    }
  }

  async function removeSub(id: string, label: string) {
    if (
      !window.confirm(
        `Delete the "${label}" subcategory? Leads already set to it keep the value, but it won't be offered in the dropdowns anymore.`,
      )
    )
      return
    try {
      await deleteSubcategory(id)
      toast.show(`Deleted "${label}"`)
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't delete")
    }
  }

  return (
    <li
      ref={setDropRef}
      className={`rounded-lg border bg-white transition-colors ${
        isOver ? 'border-major bg-major-light/30' : 'border-line'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-1.5 px-2 py-2">
        <button
          type="button"
          ref={setDragRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder ${industryName}`}
          title="Drag to reorder"
          className="cursor-grab rounded-md p-1 text-ink-4 transition-colors hover:bg-ghost hover:text-ink-2 active:cursor-grabbing"
        >
          <GripVertical size={15} />
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Collapse' : 'Expand'}
          className="rounded-md p-1 text-ink-3 transition-colors hover:bg-ghost"
        >
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left text-[13px] font-medium text-ink-1"
        >
          {industryName}
          {subcategories.length > 0 && (
            <span className="ml-1.5 text-[11.5px] font-normal text-ink-3">
              ({subcategories.length})
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onDeleteIndustry}
          aria-label={`Delete ${industryName}`}
          title="Delete industry"
          className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-bad-light hover:text-bad"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {open && (
        <div className="border-t border-line bg-ghost/40 px-3 py-2.5">
          <div className="mb-2 flex gap-2">
            <input
              value={subName}
              onChange={(e) => setSubName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addSub()
              }}
              placeholder={`New subcategory in ${industryName}…`}
              className="flex-1 rounded-lg border-[1.5px] border-line bg-white px-3 py-1.5 text-[12.5px] outline-none transition-colors focus:border-major"
            />
            <Button size="sm" onClick={addSub} disabled={busy || !subName.trim()}>
              <Plus size={12} /> Add
            </Button>
          </div>
          {subcategories.length === 0 ? (
            <p className="px-1 py-1 text-[12px] italic text-ink-3">
              No subcategories yet. Leads in {industryName} will be
              categorized by industry only.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {subcategories.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded-md border border-line bg-white px-2.5 py-1.5"
                >
                  <span className="flex-1 text-[12.5px] text-ink-1">
                    {s.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSub(s.id, s.name)}
                    aria-label={`Delete ${s.name}`}
                    title="Delete subcategory"
                    className="rounded-md p-1 text-ink-3 transition-colors hover:bg-bad-light hover:text-bad"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

// ─── Platforms (admin only) ──────────────────────────────────────────────────
// Admin-managed flat list of e-commerce platforms (Shopify, WooCommerce, …)
// that a merchant can be tagged with. Mirrors the industries manager but with
// no ordering or subcategories.
function PlatformsSection() {
  const toast = useToast()
  const { platforms } = usePlatforms()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function add() {
    const n = name.trim()
    if (!n) return
    if (platforms.some((p) => p.name.toLowerCase() === n.toLowerCase())) {
      toast.show(`"${n}" already exists`)
      return
    }
    setBusy(true)
    try {
      await createPlatform(n)
      setName('')
      toast.show(`Added "${n}"`)
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't add platform")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string, label: string) {
    if (
      !window.confirm(
        `Delete the "${label}" platform? Leads already set to it keep the value, but it won't be offered in the dropdown anymore.`,
      )
    )
      return
    try {
      await deletePlatform(id)
      toast.show(`Deleted "${label}"`)
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't delete")
    }
  }

  return (
    <section className="rounded-xl border border-line bg-white px-5 py-5">
      <header className="mb-1 flex items-center gap-2">
        <h2 className="font-display text-[14px] font-bold">Platforms</h2>
        <span className="text-[12px] text-ink-3">({platforms.length})</span>
      </header>
      <p className="mb-3 text-[12.5px] text-ink-3">
        The e-commerce platforms (Shopify, WooCommerce, …) a lead can be
        tagged with in its card.
      </p>

      <div className="mb-3 flex max-w-[380px] gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
          placeholder="New platform name…"
          className="flex-1 rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13.5px] outline-none transition-colors focus:border-major"
        />
        <Button onClick={add} disabled={busy || !name.trim()}>
          <Plus size={13} /> Add
        </Button>
      </div>

      {platforms.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-4 py-5 text-center">
          <p className="text-[12.5px] text-ink-3">
            No platforms created yet. Add Shopify, WooCommerce, or whatever your
            leads run on.
          </p>
        </div>
      ) : (
        <ul className="flex max-w-[460px] flex-col gap-1.5">
          {platforms.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2"
            >
              <span className="flex-1 text-[13px] font-medium text-ink-1">
                {p.name}
              </span>
              <button
                type="button"
                onClick={() => remove(p.id, p.name)}
                aria-label={`Delete ${p.name}`}
                title="Delete platform"
                className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-bad-light hover:text-bad"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function IconBtn({
  children,
  onClick,
  disabled,
  danger,
  label,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded-md border-[1.5px] border-line bg-white text-ink-2 transition-colors disabled:opacity-40 ${
        danger
          ? 'hover:!border-bad hover:!bg-bad-light hover:!text-bad'
          : 'hover:border-major hover:text-major'
      }`}
    >
      {children}
    </button>
  )
}

function AddStageModal({
  open,
  onClose,
  nextOrder,
}: {
  open: boolean
  onClose: () => void
  nextOrder: number
}) {
  const me = useProfile()
  const toast = useToast()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#5B4FCF')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    try {
      const id = await createStage({ name, color, order: nextOrder })
      await logActivity({
        who: me.id,
        whoName: me.name,
        kind: 'stage.create',
        text: `added stage ${name}`,
        refId: id,
        refKind: 'stage',
      })
      toast.show('Stage added')
      setName('')
      setColor('#5B4FCF')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Deal Stage"
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Add Stage'}
          </Button>
        </>
      }
    >
      <Field
        label="Stage Name *"
        value={name}
        onChange={setName}
        placeholder="e.g. Demo Scheduled"
      />
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Color
        </label>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-10 w-24 cursor-pointer rounded-lg border-[1.5px] border-line p-1"
        />
      </div>
    </Modal>
  )
}

// ─── Shared form bits ───────────────────────────────────────────────────────

function FormRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border-[1.5px] border-line px-3 py-2 text-[13.5px] outline-none transition-colors focus:border-major"
      />
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: readonly string[]
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer rounded-lg border-[1.5px] border-line bg-white px-3 py-2 text-[13.5px] outline-none focus:border-major"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  )
}
