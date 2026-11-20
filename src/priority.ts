import type { Category } from './types'

export interface PriorityFactors {
  severity: number
  publicImpact: number
  locationRisk: number
  duration: number
  evidenceConfidence: number
}

export function calculatePriority(factors: PriorityFactors): number {
  const values = Object.values(factors)
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) {
    throw new RangeError('Priority factors must be numbers from 0 to 100.')
  }
  return Math.round(
    factors.severity * 0.35 + factors.publicImpact * 0.25 +
    factors.locationRisk * 0.2 + factors.duration * 0.1 +
    factors.evidenceConfidence * 0.1,
  )
}

// A deterministic local fallback, not AI output. Inputs are estimates and need human review.
export function estimatePriority(category: Category, description: string): number {
  const text = description.toLocaleLowerCase()
  const factors: PriorityFactors = {
    severity: category === 'Water leakage' || category === 'Drainage' ? 65 : 45,
    publicImpact: /school|hospital|market|main road|traffic|children/.test(text) ? 80 : 35,
    locationRisk: /school|hospital|traffic|main road/.test(text) ? 75 : 30,
    duration: /week|month|continuous|days/.test(text) ? 65 : 25,
    evidenceConfidence: 20,
  }
  if (/overflow|large|sewage|danger|accident/.test(text)) factors.severity = Math.min(100, factors.severity + 20)
  return calculatePriority(factors)
}
