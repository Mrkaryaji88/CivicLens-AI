import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowUpRight, BarChart3, CheckCircle2, ChevronDown,
  ClipboardList, Clock3, Filter, MapPin, Plus, Search, ShieldCheck,
  Sparkles, Users, Waves, Trash2, Menu, X, Leaf, LayoutDashboard, Camera,
} from 'lucide-react'
import { starterComplaints } from './data'
import { categories, type Category, type Complaint, type Role, type Status } from './types'
import { estimatePriority } from './priority'
import { AuthGate } from './AuthGate'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import { assignComplaint as assignRemote, getCurrentProfile, listStaff, loadComplaints as loadRemote, submitComplaint as submitRemote, updateComplaintStatus } from './lib/civicApi'
import type { Session } from '@supabase/supabase-js'

const STORAGE_KEY = 'civiclens-phase1-complaints'
const statuses: Status[] = ['Submitted', 'Verified', 'Assigned', 'In Progress', 'Resolved']

function loadLocalComplaints(): Complaint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return starterComplaints
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return starterComplaints
    return parsed.filter((item): item is Complaint => Boolean(item &&
      typeof item.id === 'string' && typeof item.title === 'string' &&
      typeof item.category === 'string' && categories.includes(item.category as Category) &&
      typeof item.description === 'string' && typeof item.location === 'string' &&
      typeof item.ward === 'string' && statuses.includes(item.status) &&
      Number.isFinite(item.priority) && typeof item.createdAt === 'string' &&
      typeof item.reporter === 'string' &&
      (item.latitude === undefined || (Number.isFinite(item.latitude) && item.latitude >= -90 && item.latitude <= 90)) &&
      (item.longitude === undefined || (Number.isFinite(item.longitude) && item.longitude >= -180 && item.longitude <= 180))))
  } catch { return starterComplaints }
}

function makeComplaintId(existing: Complaint[]): string {
  const known = new Set(existing.map(item => item.id))
  let id = ''
  do {
    const suffix = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 8).toUpperCase()
      ?? Math.random().toString(36).slice(2, 10).toUpperCase()
    id = `CL-${suffix}`
  } while (known.has(id))
  return id
}

function priorityLabel(score: number) {
  if (score >= 75) return 'Critical'
  if (score >= 50) return 'High'
  if (score >= 30) return 'Medium'
  return 'Low'
}

function App() {
  const [role, setRole] = useState<Role>('Citizen')
  const [complaints, setComplaints] = useState<Complaint[]>(isSupabaseConfigured ? [] : loadLocalComplaints)
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)
  const [profile, setProfile] = useState<{ role: Role; name: string } | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [staff, setStaff] = useState<Array<{ id: string; name: string }>>([])
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [showForm, setShowForm] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [notice, setNotice] = useState('')
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [form, setForm] = useState({
    title: '', category: 'Garbage' as Category, description: '', location: '', ward: 'Ward 1',
    latitude: null as number | null, longitude: null as number | null,
  })

  const activeRole: Role = isSupabaseConfigured ? profile?.role ?? 'Citizen' : role

  useEffect(() => {
    if (!supabase) return
    let alive = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return
      if (error) setNotice(`Could not restore sign-in: ${error.message}`)
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => { alive = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!supabase || !authReady) return
    if (!session) { setProfile(null); setProfileLoading(false); setComplaints([]); return }
    let alive = true
    setProfileLoading(true)
    getCurrentProfile(supabase, session).then(result => {
      if (alive) setProfile(result)
    }).catch(error => {
      if (alive) setNotice(`Could not load account profile: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }).finally(() => { if (alive) setProfileLoading(false) })
    return () => { alive = false }
  }, [session, authReady])

  useEffect(() => {
    if (!supabase || !session || !profile) return
    let alive = true
    loadRemote(supabase).then(rows => { if (alive) setComplaints(rows) })
      .catch(error => { if (alive) setNotice(`Could not load complaints: ${error instanceof Error ? error.message : 'Check Supabase RLS and schema setup.'}`) })
    if (profile.role === 'Admin') {
      listStaff(supabase).then(rows => { if (alive) setStaff(rows) })
        .catch(error => { if (alive) setNotice(`Could not load staff list: ${error instanceof Error ? error.message : 'Check profile access policy.'}`) })
    } else setStaff([])
    return () => { alive = false }
  }, [session, profile])

  useEffect(() => {
    if (isSupabaseConfigured) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(complaints)) }
    catch { setNotice('Browser storage is unavailable. Changes may not persist after closing this page.') }
  }, [complaints])

  const filtered = useMemo(() => complaints.filter(c => {
    const matchesQuery = `${c.id} ${c.title} ${c.category} ${c.location}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (statusFilter === 'All' || c.status === statusFilter)
  }), [complaints, query, statusFilter])

  const counts = useMemo(() => ({
    total: complaints.length,
    open: complaints.filter(c => c.status !== 'Resolved').length,
    critical: complaints.filter(c => c.priority >= 75 && c.status !== 'Resolved').length,
    resolved: complaints.filter(c => c.status === 'Resolved').length,
  }), [complaints])

  async function createComplaint(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !form.description.trim() || !form.location.trim()) {
      setNotice('Please complete title, description and location.')
      return
    }
    const { latitude, longitude, ...reportFields } = form
    if (isSupabaseConfigured) {
      if (!supabase || !session || !profile) {
        setNotice('Sign in before submitting a report.')
        return
      }
      try {
        const created = await submitRemote(supabase, session.user.id, form)
        setComplaints(prev => [created, ...prev])
        setForm({ title: '', category: 'Garbage', description: '', location: '', ward: 'Ward 1', latitude: null, longitude: null })
        setShowForm(false)
        setNotice(`Report ${created.id} submitted to the shared CivicLens workspace.`)
      } catch (error) {
        setNotice(`Report could not be submitted: ${error instanceof Error ? error.message : 'Check your connection and account permissions.'}`)
      }
      return
    }
    const item: Complaint = {
      ...reportFields, ...(latitude !== null && longitude !== null ? { latitude, longitude } : {}),
      id: makeComplaintId(complaints), status: 'Submitted', priority: estimatePriority(form.category, form.description),
      createdAt: new Date().toISOString(), reporter: 'Demo Citizen',
    }
    setComplaints(prev => [item, ...prev])
    setForm({ title: '', category: 'Garbage', description: '', location: '', ward: 'Ward 1', latitude: null, longitude: null })
    setShowForm(false)
    setNotice('Demo report saved in this browser only.')
  }

  function fetchCurrentLocation() {
    setLocationError('')
    if (!navigator.geolocation) {
      setLocationError('This browser does not support location access.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const latitude = Number(coords.latitude.toFixed(6))
        const longitude = Number(coords.longitude.toFixed(6))
        setForm(prev => ({
          ...prev,
          location: prev.location.trim() || `GPS ${latitude}, ${longitude}`,
          latitude,
          longitude,
        }))
        setLocating(false)
      },
      error => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Allow it in your browser settings and try again.'
          : error.code === error.POSITION_UNAVAILABLE
            ? 'Your device could not determine a location. Enter it manually instead.'
            : 'Location request timed out. Try again or enter the location manually.'
        setLocationError(message)
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    )
  }

  async function advanceStatus(id: string) {
    const item = complaints.find(complaint => complaint.id === id)
    if (!item) return
    const nextStatus = activeRole === 'Staff'
      ? item.status === 'Assigned' ? 'In Progress' : item.status === 'In Progress' ? 'Resolved' : null
      : statuses[Math.min(statuses.indexOf(item.status) + 1, statuses.length - 1)]
    if (!nextStatus) return
    try {
      if (supabase && profile) await updateComplaintStatus(supabase, id, nextStatus)
      setComplaints(prev => prev.map(c => c.id === id ? { ...c, status: nextStatus } : c))
      setNotice(isSupabaseConfigured ? 'Complaint status updated.' : 'Demo status updated in this browser.')
    } catch (error) {
      setNotice(`Status update failed: ${error instanceof Error ? error.message : 'Your account may not be authorized for this complaint.'}`)
    }
  }

  async function assignToStaff(publicId: string, staffId: string) {
    if (!supabase || !profile || profile.role !== 'Admin') return
    try {
      await assignRemote(supabase, publicId, staffId)
      const assignedStaff = staff.find(member => member.id === staffId)
      setComplaints(prev => prev.map(item => item.id === publicId ? { ...item, assignedTo: staffId, status: 'Assigned' } : item))
      setNotice(`Complaint assigned${assignedStaff ? ` to ${assignedStaff.name}` : ''}.`)
    } catch (error) {
      setNotice(`Assignment failed: ${error instanceof Error ? error.message : 'Check your admin permission and database migration.'}`)
    }
  }

  async function signOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) setNotice(`Sign out failed: ${error.message}`)
    else { setSession(null); setProfile(null); setNotice('Signed out.') }
  }

  async function refreshComplaints() {
    if (!supabase || !session) return
    setRefreshing(true)
    try {
      setComplaints(await loadRemote(supabase))
      setNotice('Complaint list refreshed.')
    } catch (error) {
      setNotice(`Refresh failed: ${error instanceof Error ? error.message : 'Check the network and Supabase permissions.'}`)
    } finally { setRefreshing(false) }
  }

  const nav = [
    { label: 'Overview', icon: LayoutDashboard },
    { label: 'Complaints', icon: ClipboardList },
    { label: 'AI Insights', icon: Sparkles },
    { label: 'Ward Analytics', icon: BarChart3 },
  ]

  if (isSupabaseConfigured && !authReady) return <main className="auth-screen"><section className="auth-card"><div className="eyebrow">CIVICLENS AI</div><h1>Checking your sign-in…</h1></section></main>
  if (isSupabaseConfigured && !session) return <AuthGate />
  if (isSupabaseConfigured && session && profileLoading) return <main className="auth-screen"><section className="auth-card"><div className="eyebrow">CIVICLENS AI</div><h1>Loading your workspace…</h1></section></main>
  if (isSupabaseConfigured && session && !profile) return <main className="auth-screen"><section className="auth-card"><div className="eyebrow">ACCOUNT SETUP</div><h1>Profile could not be loaded</h1><p className="auth-intro">Check that the Supabase schema migration was applied and your account profile exists.</p><button className="secondary-button" onClick={signOut}>Sign out</button></section></main>

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand"><div className="brand-mark"><Leaf size={21} /></div><div><b>CivicLens<span> AI</span></b><small>SMART CIVIC OPERATIONS</small></div><button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X /></button></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>{nav.map((item, i) => <button key={item.label} className={`nav-item ${i === 0 ? 'active' : ''}`} onClick={() => { setNotice(`${item.label} view is part of the Phase 1 dashboard.`); setMobileNav(false) }}><item.icon size={18} />{item.label}{i === 2 && <span className="new-tag">NEW</span>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="pilot-card"><div className="pilot-icon"><MapPin size={16} /></div><div><b>Kanpur Pilot</b><small>Uttar Pradesh, India</small></div><span className="live-dot" /></div><div className="user-mini"><div className="avatar">CK</div><div><b>Demo Workspace</b><small>Phase 1 preview</small></div><ChevronDown size={16} /></div></div>
      </aside>

      {mobileNav && <button className="scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <main className="main-area">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu /></button>
        <div className="breadcrumb">Workspace <span>/</span> Overview</div>
          <div className="top-actions">
            <span className="system-status"><i /> System operational</span>
            {isSupabaseConfigured ? <><span className="signed-in-name">{profile?.name}</span><button className="signout-button" onClick={signOut}>Sign out</button></> : <div className="role-switch"><Users size={15} /><select aria-label="Preview role" value={role} onChange={e => setRole(e.target.value as Role)}><option>Citizen</option><option>Admin</option><option>Staff</option></select></div>}
            <div className="avatar">{isSupabaseConfigured ? (profile?.name.slice(0, 2).toUpperCase() ?? 'CL') : 'CK'}</div>
          </div>
        </header>

        <div className="content">
          <section className="welcome-row">
            <div><div className="eyebrow">{isSupabaseConfigured ? 'SHARED CIVIC WORKSPACE' : 'LOCAL DEMO PREVIEW'}</div><h1>Good afternoon, <span>{activeRole}</span></h1><p>{activeRole === 'Citizen' ? 'Report a local issue and follow its progress.' : 'Review and move civic reports through the service workflow.'}</p></div>
            {activeRole === 'Citizen' && <button className="primary-button" onClick={() => setShowForm(true)}><Plus size={18} /> Report an issue</button>}
          </section>

          {notice && <div className="notice" role="status"><CheckCircle2 size={17} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={15} /></button></div>}

          <section className="stats-grid" aria-label="Complaint summary">
            <StatCard icon={<ClipboardList />} label="Total reports" value={counts.total} change="All submitted reports" tone="blue" />
            <StatCard icon={<Activity />} label="Open issues" value={counts.open} change="Awaiting resolution" tone="orange" />
            <StatCard icon={<AlertTriangle />} label="Critical priority" value={counts.critical} change="Needs urgent attention" tone="red" />
            <StatCard icon={<CheckCircle2 />} label="Resolved" value={counts.resolved} change="Marked as completed" tone="green" />
          </section>

          <section className="main-grid">
            <div className="panel complaints-panel">
              <div className="panel-heading"><div><div className="eyebrow">{isSupabaseConfigured ? 'SHARED WORK QUEUE' : 'DEMO WORK QUEUE'}</div><h2>Recent complaints</h2></div>{isSupabaseConfigured ? <button className="text-button" onClick={refreshComplaints} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'} <ArrowUpRight size={15} /></button> : <button className="text-button" onClick={() => { setStatusFilter('All'); setQuery('') }}>View all <ArrowUpRight size={15} /></button>}</div>
              <div className="toolbar"><div className="search-box"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search complaints..." aria-label="Search complaints" /></div><div className="filter-box"><Filter size={15} /><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Filter by status"><option>All</option>{statuses.map(s => <option key={s}>{s}</option>)}</select></div></div>
              <div className="complaint-list">
                {filtered.length ? filtered.map(c => <ComplaintRow key={c.id} item={c} role={activeRole} staff={staff} canAssign={isSupabaseConfigured && activeRole === 'Admin'} onAssign={staffId => assignToStaff(c.id, staffId)} onAdvance={() => advanceStatus(c.id)} />) : <div className="empty-state">No complaints match your search.</div>}
              </div>
            </div>

            <div className="right-column">
              <div className="panel assistant-panel"><div className="assistant-heading"><div className="sparkle-icon"><Sparkles size={18} /></div><div><h2>Civic AI assistant</h2><span><i /> Decision support preview</span></div></div><p>AI-assisted triage will help teams understand which civic issues need attention first.</p><div className="insight-box"><div className="insight-top"><ShieldCheck size={16} /> PRIORITY EXPLAINER</div><b>Transparent, explainable scoring</b><p>Severity 35% · Public impact 25% · Location risk 20% · Duration 10% · Evidence confidence 10%</p></div><div className="assistant-foot"><Sparkles size={15} /> Full AI analysis connects in Phase 2</div></div>
              <div className="panel progress-panel"><div className="panel-heading"><div><div className="eyebrow">SERVICE DELIVERY</div><h2>Resolution snapshot</h2></div><Waves size={19} className="muted-icon" /></div><div className="progress-number">{counts.total ? Math.round(counts.resolved / counts.total * 100) : 0}<small>%</small></div><p>of reported issues resolved</p><div className="progress-track"><div style={{ width: `${counts.total ? counts.resolved / counts.total * 100 : 0}%` }} /></div><div className="progress-legend"><span><i className="green-dot" /> Resolved ({counts.resolved})</span><span><i className="gray-dot" /> Remaining ({counts.open})</span></div></div>
            </div>
          </section>

          <section className="bottom-note"><div className="note-icon"><Camera size={18} /></div><div><b>Built for real-world accountability</b><p>Report with evidence, track every status change, and make civic service delivery more transparent.</p></div><span className="pilot-pill">KANPUR PILOT</span></section>
          <footer>© 2026 CivicLens AI <span>·</span> Build for Impact <span>·</span> Phase 1 foundation</footer>
        </div>
      </main>

      {showForm && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowForm(false) }}><form className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title" onSubmit={createComplaint}><div className="modal-heading"><div><div className="eyebrow">CITIZEN REPORT</div><h2 id="report-title">Report a civic issue</h2></div><button type="button" className="icon-button" onClick={() => setShowForm(false)} aria-label="Close"><X /></button></div><label>Issue title<input required minLength={5} maxLength={90} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Overflowing dustbin near school" /></label><label>Category<select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as Category })}>{categories.map(c => <option key={c}>{c}</option>)}</select></label><label>Description<textarea required minLength={10} rows={3} maxLength={500} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Describe the issue, its impact and how long it has existed..." /></label><label>Location<input required minLength={3} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Area, landmark, Kanpur" /></label><button type="button" className="secondary-button location-button" onClick={fetchCurrentLocation} disabled={locating}><MapPin size={15} />{locating ? 'Getting your location…' : 'Use my current location'}</button>{locationError && <p className="location-message error-message" role="alert">{locationError}</p>}{form.latitude !== null && form.longitude !== null && <p className="location-message" role="status">GPS captured: {form.latitude}, {form.longitude}. You can edit the location description above.</p>}<label>Ward<input value={form.ward} onChange={e => setForm({ ...form, ward: e.target.value })} placeholder="Ward number (if known)" /></label><div className="form-hint"><Sparkles size={15} /> Local rule based estimate only; it is not AI analysis or an official municipal score.</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button" type="submit"><Plus size={17} /> Submit report</button></div></form></div>}
    </div>
  )
}

function StatCard({ icon, label, value, change, tone }: { icon: React.ReactNode; label: string; value: number; change: string; tone: string }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-change">{change}</div></div>
}

function ComplaintRow({ item, role, staff, canAssign, onAssign, onAdvance }: {
  item: Complaint; role: Role; staff: Array<{ id: string; name: string }>; canAssign: boolean
  onAssign: (staffId: string) => void; onAdvance: () => void
}) {
  const tone = item.priority >= 75 ? 'critical' : item.priority >= 50 ? 'high' : item.priority >= 30 ? 'medium' : 'low'
  const canAdvance = role === 'Admin' ? item.status !== 'Resolved' : role === 'Staff' && ['Assigned', 'In Progress'].includes(item.status)
  return <article className="complaint-row"><div className="category-icon"><Trash2 size={18} /></div><div className="complaint-info"><div className="complaint-title-line"><b>{item.title}</b><span className={`priority ${tone}`}>{priorityLabel(item.priority)} · {item.priority}</span></div><div className="complaint-meta"><span>{item.id}</span><i /> <span>{item.category}</span><i /> <span><MapPin size={12} /> {item.location}</span></div><div className="row-bottom"><span className={`status status-${item.status.toLowerCase().replace(/ /g, '-')}`}>{item.status}</span><span className="date-label"><Clock3 size={12} /> {new Date(item.createdAt).toLocaleDateString()}</span></div></div>{canAssign && <select className="assign-select" aria-label={`Assign ${item.id} to staff`} value={item.assignedTo ?? ''} onChange={event => { if (event.target.value) onAssign(event.target.value) }}><option value="">Assign staff…</option>{staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>}{canAdvance && <button className="advance-button" onClick={onAdvance}>{item.status === 'Assigned' && role === 'Staff' ? 'Start work' : item.status === 'In Progress' && role === 'Staff' ? 'Mark resolved' : 'Advance status'} <ArrowUpRight size={14} /></button>}</article>
}

export default App
