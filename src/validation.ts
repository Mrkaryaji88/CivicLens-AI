import { categories } from './types'

export interface ComplaintDraft {
  title?: unknown
  category?: unknown
  description?: unknown
  location?: unknown
  ward?: unknown
  latitude?: unknown
  longitude?: unknown
}

/** Returns a user-facing validation message, or null when a draft is valid. */
export function validateComplaintDraft(draft: ComplaintDraft): string | null {
  if (typeof draft.title !== 'string' || draft.title.trim().length < 5 || draft.title.trim().length > 90) {
    return 'Title must be between 5 and 90 characters.'
  }
  if (typeof draft.category !== 'string' || !categories.includes(draft.category as (typeof categories)[number])) {
    return 'Choose a valid issue category.'
  }
  if (typeof draft.description !== 'string' || draft.description.trim().length < 10 || draft.description.trim().length > 500) {
    return 'Description must be between 10 and 500 characters.'
  }
  if (typeof draft.location !== 'string' || draft.location.trim().length < 3 || draft.location.trim().length > 160) {
    return 'Location must be between 3 and 160 characters.'
  }
  if (draft.ward !== undefined && (typeof draft.ward !== 'string' || draft.ward.trim().length > 80)) {
    return 'Ward must be 80 characters or fewer.'
  }

  const hasLatitude = draft.latitude !== null && draft.latitude !== undefined
  const hasLongitude = draft.longitude !== null && draft.longitude !== undefined
  if (hasLatitude !== hasLongitude) return 'GPS latitude and longitude must be provided together.'
  if (hasLatitude && hasLongitude) {
    if (typeof draft.latitude !== 'number' || !Number.isFinite(draft.latitude) || draft.latitude < -90 || draft.latitude > 90) {
      return 'GPS latitude must be between -90 and 90.'
    }
    if (typeof draft.longitude !== 'number' || !Number.isFinite(draft.longitude) || draft.longitude < -180 || draft.longitude > 180) {
      return 'GPS longitude must be between -180 and 180.'
    }
  }
  return null
}
