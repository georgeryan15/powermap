import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chartDomain, monthlySeries } from '../src/chartData.ts'

test('negative generation uses the full range below a zero baseline', () => {
  assert.deepEqual(chartDomain([-11, -8, -26]), [-26, 0])
})
test('mixed and positive series retain a zero baseline', () => {
  assert.deepEqual(chartDomain([-20, 0, 40, null]), [-20, 40])
  assert.deepEqual(chartDomain([10, 20]), [0, 20])
})
test('zero and missing series have a non-degenerate domain', () => {
  assert.deepEqual(chartDomain([0, 0]), [0, 1])
  assert.deepEqual(chartDomain([null, null]), [0, 1])
})
test('monthly data preserves nulls, reported zeroes and negative generation', () => {
  const series = monthlySeries([null, 0, -11, 20])
  assert.equal(series.unit, 'MWh')
  assert.deepEqual(
    series.data.slice(0, 4).map((p) => p.value),
    [null, 0, -11, 20],
  )
  assert.equal(series.data.length, 12)
  assert.equal(series.data[11].value, null)
})
test('large positive and negative values convert consistently to GWh', () => {
  const series = monthlySeries([1500, -2000, null, 0])
  assert.equal(series.unit, 'GWh')
  assert.deepEqual(
    series.data.slice(0, 4).map((p) => p.value),
    [1.5, -2, null, 0],
  )
})
test('an entirely missing year remains missing', () => {
  assert.ok(monthlySeries([]).data.every((point) => point.value === null))
})
