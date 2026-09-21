export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** Always include zero without flattening an entirely negative series. */
export function chartDomain(values: (number | null)[]): [number, number] {
  const reported = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  )
  const min = Math.min(0, ...reported)
  const max = Math.max(0, ...reported)
  return [min, min === 0 && max === 0 ? 1 : max]
}

export function monthlySeries(values: (number | null)[]) {
  const largest = Math.max(0, ...values.map((value) => Math.abs(value ?? 0)))
  const divisor = largest >= 1000 ? 1000 : 1
  return {
    unit: divisor === 1000 ? 'GWh' : 'MWh',
    data: MONTHS.map((label, index) => ({
      label,
      value: values[index] == null ? null : values[index]! / divisor,
    })),
  }
}
