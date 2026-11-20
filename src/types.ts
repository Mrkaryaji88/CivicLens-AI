export type Role = 'Citizen' | 'Admin' | 'Staff'
export type Status = 'Submitted' | 'Verified' | 'Assigned' | 'In Progress' | 'Resolved'
export type Category = 'Garbage' | 'Dustbin overflow' | 'Water leakage' | 'Drainage' | 'Road damage' | 'Other'

export interface Complaint {
  id: string
  title: string
  category: Category
  description: string
  location: string
  ward: string
  status: Status
  priority: number
  createdAt: string
  reporter: string
  assignedTo?: string
  latitude?: number
  longitude?: number
}

export const categories: Category[] = [
  'Garbage', 'Dustbin overflow', 'Water leakage', 'Drainage', 'Road damage', 'Other',
]
