import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { estimatePriority } from '../priority'
import type { Category, Complaint, Role, Status } from '../types'

type DbRow = {
  id: string
  public_id: string
  reporter_id: string
  title: string
  description: string
  category: string
  location_text: string
  ward?: string | null
  latitude?: number | null
  longitude?: number | null
  status: string
  priority_score?: number | null
  assigned_to?: string | null
  created_at: string
}

const categoriesToDb: Record<Category, string> = {
  Garbage: 'garbage',
  'Dustbin overflow': 'dustbin_overflow',
  'Water leakage': 'water_leakage',
  Drainage: 'drainage',
  'Road damage': 'road_damage',
  Other: 'other',
}
const categoriesFromDb = Object.fromEntries(Object.entries(categoriesToDb).map(([ui, db]) => [db, ui])) as Record<string, Category>
const statusesToDb: Record<Status, string> = {
  Submitted: 'submitted', Verified: 'verified', Assigned: 'assigned', 'In Progress': 'in_progress', Resolved: 'resolved',
}
const statusesFromDb = Object.fromEntries(Object.entries(statusesToDb).map(([ui, db]) => [db, ui])) as Record<string, Status>

function toComplaint(row: DbRow): Complaint {
  const category = categoriesFromDb[row.category] ?? 'Other'
  return {
    id: row.public_id,
    title: row.title,
    category,
    description: row.description,
    location: row.location_text,
    ward: row.ward ?? 'Ward not specified',
    status: statusesFromDb[row.status] ?? 'Submitted',
    priority: row.priority_score ?? estimatePriority(category, row.description),
    createdAt: row.created_at,
    reporter: row.reporter_id,
    assignedTo: row.assigned_to ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
  }
}

export async function loadComplaints(client: SupabaseClient): Promise<Complaint[]> {
  const { data, error } = await client.from('complaints').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data as DbRow[]).map(toComplaint)
}

export async function submitComplaint(client: SupabaseClient, userId: string, input: {
  title: string; category: Category; description: string; location: string; ward: string
  latitude: number | null; longitude: number | null
}): Promise<Complaint> {
  const { data, error } = await client.from('complaints').insert({
    reporter_id: userId,
    title: input.title.trim(),
    description: input.description.trim(),
    category: categoriesToDb[input.category],
    location_text: input.location.trim(),
    ward: input.ward.trim() || null,
    latitude: input.latitude,
    longitude: input.longitude,
  }).select('*').single()
  if (error) throw error
  return toComplaint(data as DbRow)
}

export async function updateComplaintStatus(client: SupabaseClient, publicId: string, status: Status): Promise<void> {
  const { error } = await client.from('complaints').update({ status: statusesToDb[status] }).eq('public_id', publicId)
  if (error) throw error
}

export async function listStaff(client: SupabaseClient): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await client.from('profiles').select('id,display_name').eq('role', 'staff').order('display_name')
  if (error) throw error
  return data.map(profile => ({ id: profile.id, name: profile.display_name }))
}

export async function assignComplaint(client: SupabaseClient, publicId: string, staffId: string): Promise<void> {
  const { error } = await client.rpc('assign_complaint', { p_public_id: publicId, p_staff_id: staffId })
  if (error) throw error
}

export function roleFromDb(role: string | null | undefined): Role | null {
  if (role === 'admin') return 'Admin'
  if (role === 'staff') return 'Staff'
  if (role === 'citizen') return 'Citizen'
  return null
}

export async function getCurrentProfile(client: SupabaseClient, session: Session): Promise<{ role: Role; name: string }> {
  const { data, error } = await client.from('profiles').select('role,display_name').eq('id', session.user.id).single()
  if (error) throw error
  const role = roleFromDb(data.role)
  if (!role) throw new Error('Your account has no valid CivicLens role. Ask the project administrator to check your profile.')
  return { role, name: data.display_name || session.user.email || 'CivicLens user' }
}
