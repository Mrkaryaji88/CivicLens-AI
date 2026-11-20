import type { Complaint } from './types'

export const starterComplaints: Complaint[] = [
  {
    id: 'CL-1042', title: 'Overflowing garbage near market',
    category: 'Garbage', description: 'Waste has been accumulating beside the market entrance for two days.',
    location: 'Naveen Market, Kanpur', ward: 'Ward 72', status: 'In Progress',
    priority: 82, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    reporter: 'Aarav Sharma', assignedTo: 'Sanitation Team A',
  },
  {
    id: 'CL-1041', title: 'Water leaking from roadside pipe',
    category: 'Water leakage', description: 'Continuous water flow is making the road slippery.',
    location: 'Swaroop Nagar, Kanpur', ward: 'Ward 12', status: 'Verified',
    priority: 76, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 9).toISOString(),
    reporter: 'Priya Singh',
  },
  {
    id: 'CL-1040', title: 'Blocked drainage after rainfall',
    category: 'Drainage', description: 'Drain is blocked and water is collecting near homes.',
    location: 'Kakadeo, Kanpur', ward: 'Ward 18', status: 'Submitted',
    priority: 58, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
    reporter: 'Rahul Verma',
  },
  {
    id: 'CL-1039', title: 'Damaged road surface',
    category: 'Road damage', description: 'A large pothole is affecting two-wheelers.',
    location: 'Kalyanpur, Kanpur', ward: 'Ward 31', status: 'Resolved',
    priority: 43, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    reporter: 'Neha Gupta', assignedTo: 'Road Repair Team',
  },
]
