export type Plant = {
  id: number
  name: string
  operator_name: string | null
  state: string | null
  county: string | null
  latitude: number | null
  longitude: number | null
  nameplate_mw: number
  proposed_mw: number
  retired_mw: number
  storage_mw: number
  unit_count: number
  operable_unit_count: number
  status: string
  primary_fuel: string
  fuel_types: string[]
  first_operating_year: number | null
  latest_operating_year: number | null
  net_generation_mwh: number | null
  capacity_factor: number | null
  generation_status: string
  coordinate_status: string
}
export type Owner = {
  id: number
  name: string
  attributed_mw: number
  plant_capacity_percent: number | null
}
export type Metrics = {
  net_generation_mwh: number | null
  capacity_factor: number | null
  capacity_hours_mwh: number | null
  monthly_generation_mwh: (number | null)[]
  monthly_storage_net_mwh: (number | null)[]
  storage_net_generation_mwh: number | null
  storage_gross_generation_mwh: number | null
  generation_status: string
  reporting_frequencies: string[]
}
export type Generator = {
  generator_id: string
  status: string
  technology: string
  nameplate_mw: number
  primary_fuel: string
  operating_year: number | null
  planned_operating_year: number | null
  retirement_year: number | null
  planned_retirement_year: number | null
  fuels: { fuel_code: string; role: string; priority: number }[]
  owners: { name: string; fraction: number; basis: string }[]
}
export type Source = {
  id: string
  path: string
  sheet: string
  records: number
}
export type Detail = {
  plant: Omit<Plant, 'id'> & {
    plant_id: number
    year: number
    city: string | null
    address: string | null
    balancing_authority: string | null
    nerc_region: string | null
    operating_mw: number
    owners: Owner[]
    ownership_status: string
    ownership_coverage_percent: number | null
    fuel_capacity: { fuel: string; capacity_mw: number }[]
  }
  metrics: Metrics
  generators: Generator[]
  issues: {
    code: string
    generator_id: string | null
    context: Record<string, unknown>
  }[]
  sources: Source[]
}
export type Dataset = {
  id: string
  year: number
  warning: string
  report: {
    counts: Record<string, number>
    mapped_plants: number
    plants_with_generation: number
  }
}
export type Metadata = {
  total: number
  records: {
    row_number: number
    generator_id: string | null
    data: Record<string, unknown>
    path: string
    sheet: string
  }[]
}
export const API = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(
  /\/$/,
  '',
)
export async function getJson<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${API}${path}`, { signal })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(
      body?.message || `Could not load plant data (${response.status})`,
    )
  }
  return response.json() as Promise<T>
}
export const FUEL_COLORS: Record<string, string> = {
  Solar: '#eda100',
  Wind: '#1baf7a',
  Hydro: '#3987e5',
  'Natural gas': '#eb6834',
  Nuclear: '#9085e9',
  Battery: '#e87ba4',
  Coal: '#a29a88',
  Petroleum: '#cc995f',
  Biomass: '#86b947',
  Waste: '#c789ce',
  Geothermal: '#df535e',
  'Other gas': '#bd7549',
  'Pumped storage': '#68b9cc',
  'Other storage': '#a87ddb',
  Other: '#8b93a7',
}
export const format = (n: number | null | undefined, digits = 1) =>
  n == null
    ? 'Not reported'
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(
        n,
      )
export const percent = (n: number | null | undefined) =>
  n == null ? 'Not available' : `${format(n * 100)}%`
