import { describe, expect, it } from 'vitest'
import { calculatePriority, estimatePriority } from './priority'

describe('priority scoring', () => {
  it('applies the published weights and rounds to an integer', () => {
    expect(calculatePriority({ severity: 100, publicImpact: 100, locationRisk: 100, duration: 100, evidenceConfidence: 100 })).toBe(100)
    expect(calculatePriority({ severity: 0, publicImpact: 0, locationRisk: 0, duration: 0, evidenceConfidence: 0 })).toBe(0)
  })

  it('rejects values outside the normalized range', () => {
    expect(() => calculatePriority({ severity: 101, publicImpact: 0, locationRisk: 0, duration: 0, evidenceConfidence: 0 })).toThrow(RangeError)
  })

  it('gives public safety signals more weight than an ordinary location', () => {
    expect(estimatePriority('Drainage', 'Sewage near school for several days')).toBeGreaterThan(estimatePriority('Drainage', 'Drain issue on quiet lane'))
  })
})
