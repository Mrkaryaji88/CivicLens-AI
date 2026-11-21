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

  it.each([
    ['severity', 35],
    ['publicImpact', 25],
    ['locationRisk', 20],
    ['duration', 10],
    ['evidenceConfidence', 10],
  ] as const)('applies the documented %s weight', (factor, expected) => {
    const factors = { severity: 0, publicImpact: 0, locationRisk: 0, duration: 0, evidenceConfidence: 0 }
    expect(calculatePriority({ ...factors, [factor]: 100 })).toBe(expected)
  })

  it('rejects negative, infinite and non-numeric factor values', () => {
    expect(() => calculatePriority({ severity: -1, publicImpact: 0, locationRisk: 0, duration: 0, evidenceConfidence: 0 })).toThrow(RangeError)
    expect(() => calculatePriority({ severity: Number.POSITIVE_INFINITY, publicImpact: 0, locationRisk: 0, duration: 0, evidenceConfidence: 0 })).toThrow(RangeError)
    expect(() => calculatePriority({ severity: Number.NaN, publicImpact: 0, locationRisk: 0, duration: 0, evidenceConfidence: 0 })).toThrow(RangeError)
  })

  it('gives public safety signals more weight than an ordinary location', () => {
    expect(estimatePriority('Drainage', 'Sewage near school for several days')).toBeGreaterThan(estimatePriority('Drainage', 'Drain issue on quiet lane'))
  })

  it('assigns a lower estimate to a routine issue than a public-safety issue', () => {
    expect(estimatePriority('Road damage', 'Small crack on a quiet lane')).toBeLessThan(estimatePriority('Road damage', 'Dangerous pothole causing accidents on main road'))
  })
})
