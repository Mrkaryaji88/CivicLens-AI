import { describe, expect, it } from 'vitest'
import { validateComplaintDraft } from './validation'

const validDraft = {
  title: 'Overflowing bin',
  category: 'Garbage',
  description: 'Waste has spilled onto the footpath.',
  location: 'Naveen Market, Kanpur',
  ward: 'Ward 1',
  latitude: 26.46,
  longitude: 80.32,
}

describe('civic report validation', () => {
  it('accepts a complete report with valid GPS coordinates', () => {
    expect(validateComplaintDraft(validDraft)).toBeNull()
  })

  it('accepts a complete report without optional GPS coordinates', () => {
    const withoutGps = {
      title: validDraft.title,
      category: validDraft.category,
      description: validDraft.description,
      location: validDraft.location,
      ward: validDraft.ward,
    }
    expect(validateComplaintDraft(withoutGps)).toBeNull()
  })

  it.each([
    ['', 'Title must be between 5 and 90 characters.'],
    ['  abc  ', 'Title must be between 5 and 90 characters.'],
    ['x'.repeat(91), 'Title must be between 5 and 90 characters.'],
  ])('rejects an invalid title', (title, message) => {
    expect(validateComplaintDraft({ ...validDraft, title })).toBe(message)
  })

  it('rejects categories outside the supported list', () => {
    expect(validateComplaintDraft({ ...validDraft, category: 'Electricity' })).toBe('Choose a valid issue category.')
  })

  it('rejects descriptions that are too short or too long', () => {
    expect(validateComplaintDraft({ ...validDraft, description: 'short' })).toBe('Description must be between 10 and 500 characters.')
    expect(validateComplaintDraft({ ...validDraft, description: 'x'.repeat(501) })).toBe('Description must be between 10 and 500 characters.')
  })

  it('rejects missing and overlong locations', () => {
    expect(validateComplaintDraft({ ...validDraft, location: '  ' })).toBe('Location must be between 3 and 160 characters.')
    expect(validateComplaintDraft({ ...validDraft, location: 'x'.repeat(161) })).toBe('Location must be between 3 and 160 characters.')
  })

  it('rejects GPS when only one coordinate is supplied', () => {
    expect(validateComplaintDraft({ ...validDraft, longitude: null })).toBe('GPS latitude and longitude must be provided together.')
  })

  it('rejects GPS coordinates outside geographic ranges', () => {
    expect(validateComplaintDraft({ ...validDraft, latitude: 91 })).toBe('GPS latitude must be between -90 and 90.')
    expect(validateComplaintDraft({ ...validDraft, longitude: 181 })).toBe('GPS longitude must be between -180 and 180.')
  })

  it('rejects non-finite coordinates and overlong ward labels', () => {
    expect(validateComplaintDraft({ ...validDraft, latitude: Number.NaN })).toBe('GPS latitude must be between -90 and 90.')
    expect(validateComplaintDraft({ ...validDraft, ward: 'w'.repeat(81) })).toBe('Ward must be 80 characters or fewer.')
  })
})
