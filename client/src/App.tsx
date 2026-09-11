import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import {
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  CheckboxGroup,
  Chip,
  Drawer,
  EmptyState,
  Kbd,
  Label,
  Link,
  ListBox,
  Popover,
  ProgressBar,
  ScrollShadow,
  SearchField,
  Select,
  Separator,
  Slider,
  Surface,
  Tabs,
  Tag,
  TagGroup,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  useOverlayState,
} from '@heroui/react'
import {
  ArrowUpDown,
  Atom,
  BatteryCharging,
  CalendarDays,
  ChevronDown,
  Droplets,
  Factory,
  Flame,
  Info,
  Layers3,
  LocateFixed,
  Minus,
  Moon,
  Plus,
  RotateCcw,
  Search,
  SearchX,
  Settings2,
  SlidersHorizontal,
  Sun,
  Wind,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import mapboxgl from 'mapbox-gl'
import type { ExpressionSpecification, GeoJSONSource } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { feature } from 'topojson-client'
import type { FeatureCollection, Geometry, Point } from 'geojson'
import statesAtlas from 'us-atlas/states-10m.json'

type HoverPoint = { x: number; y: number }
type Theme = 'light' | 'dark'
type FuelType = 'Solar' | 'Wind' | 'Hydro' | 'Natural gas' | 'Nuclear' | 'Battery'
type SortKey = 'name' | 'output' | 'capacity' | 'intensity' | 'newest'

type PlantDatum = {
  id: string
  name: string
  operator: string
  region: string
  fuel: FuelType
  coordinates: [number, number]
  capacityMW: number
  outputMW: number
  utilization: number
  emissions: number
  commissioned: number
  units: number
  status: 'Online' | 'Reduced output' | 'Standby'
  /** Percentage move in output against the same hour yesterday. */
  change24h: number
  /** 24 hourly output readings, oldest first. */
  series: number[]
}

const THEME_STORAGE_KEY = 'powermap-theme'

const PANEL_CLASS = 'rounded-xl border border-border bg-surface shadow-surface'
const CONTROL_BUTTON_CLASS =
  'h-8 min-h-8 w-8 min-w-8 rounded-lg border border-border bg-surface text-muted shadow-surface hover:bg-surface-secondary hover:text-foreground'
const CARD_TITLE_CLASS = 'text-[13px] leading-5 font-semibold tracking-[-0.01em] text-foreground'
const MICRO_LABEL_CLASS = 'text-[11px] leading-4 font-medium text-muted'
const TITLE_CLASS = 'overflow-hidden text-ellipsis whitespace-nowrap'

/* ---------------------------------------------------------------------------
   Fuel palette.

   Six categorical slots in a fixed order — the order is what keeps neighbouring
   fuels apart under colour-vision deficiency, so the legend, the mix bars and
   the map all read them in this sequence. DOM marks use the CSS variables so a
   theme switch restyles them; Mapbox paint properties need literal hex.
   --------------------------------------------------------------------------- */

const FUEL_ORDER: FuelType[] = ['Solar', 'Wind', 'Hydro', 'Natural gas', 'Nuclear', 'Battery']

const FUEL_VAR: Record<FuelType, string> = {
  Solar: 'var(--fuel-solar)',
  Wind: 'var(--fuel-wind)',
  Hydro: 'var(--fuel-hydro)',
  'Natural gas': 'var(--fuel-gas)',
  Nuclear: 'var(--fuel-nuclear)',
  Battery: 'var(--fuel-battery)',
}

const MAP_FUEL_COLORS: Record<Theme, Record<FuelType, string>> = {
  light: {
    Solar: '#eda100',
    Wind: '#1baf7a',
    Hydro: '#2a78d6',
    'Natural gas': '#eb6834',
    Nuclear: '#4a3aa7',
    Battery: '#e87ba4',
  },
  dark: {
    Solar: '#c98500',
    Wind: '#199e70',
    Hydro: '#3987e5',
    'Natural gas': '#d95926',
    Nuclear: '#9085e9',
    Battery: '#d55181',
  },
}

/** Renewables plus nuclear — everything that burns nothing. */
const CARBON_FREE: ReadonlySet<FuelType> = new Set<FuelType>(['Solar', 'Wind', 'Hydro', 'Nuclear', 'Battery'])

const STATUS_DOT_CLASS: Record<PlantDatum['status'], string> = {
  Online: 'bg-success',
  'Reduced output': 'bg-warning',
  Standby: 'bg-muted',
}

const METER_LEVELS = ['Low', 'Moderate', 'High'] as const

function getInitialTheme(): Theme {
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

const STATE_ABBREVIATIONS: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN',
  Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
  Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
  Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI',
  Wyoming: 'WY',
}

const PLANT_HUBS = [
  { place: 'Pacific Northwest', coordinates: [-120.7, 46.5] },
  { place: 'Northern California', coordinates: [-121.2, 38.4] },
  { place: 'Southern California', coordinates: [-117.8, 34.2] },
  { place: 'Desert Southwest', coordinates: [-112.0, 33.7] },
  { place: 'Front Range', coordinates: [-104.8, 39.4] },
  { place: 'North Texas', coordinates: [-97.1, 32.7] },
  { place: 'Gulf Coast', coordinates: [-95.1, 29.7] },
  { place: 'Upper Midwest', coordinates: [-93.2, 44.5] },
  { place: 'Great Lakes', coordinates: [-86.7, 42.2] },
  { place: 'Ohio Valley', coordinates: [-82.5, 39.6] },
  { place: 'Southeast', coordinates: [-83.6, 33.8] },
  { place: 'Mid-Atlantic', coordinates: [-77.6, 39.1] },
  { place: 'Northeast', coordinates: [-72.6, 42.2] },
] as const

const PLANT_PREFIXES = ['Cedar', 'Clearwater', 'Granite', 'Juniper', 'Mesa', 'Northstar', 'Pioneer', 'Redwood', 'Silver', 'Summit', 'Valley', 'Willow']
const PLANT_SUFFIXES: Record<FuelType, string> = {
  Solar: 'Solar Farm',
  Wind: 'Wind Project',
  Hydro: 'Hydroelectric Station',
  Nuclear: 'Nuclear Station',
  'Natural gas': 'Energy Center',
  Battery: 'Storage Facility',
}
const PLANT_FUELS: FuelType[] = ['Solar', 'Wind', 'Natural gas', 'Battery', 'Hydro', 'Nuclear']

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

/**
 * 24 hourly readings shaped by how the fuel actually behaves through a day:
 * solar peaks at noon, wind runs overnight, the rest ride the demand curve.
 */
function buildSeries(fuel: FuelType, outputMW: number, random: () => number) {
  return Array.from({ length: 24 }, (_, hour) => {
    let shape: number
    if (fuel === 'Solar') {
      shape = Math.max(0.04, Math.sin(((hour - 6) / 12) * Math.PI))
    } else if (fuel === 'Wind') {
      shape = 0.62 + 0.3 * Math.cos(((hour - 3) / 12) * Math.PI)
    } else if (fuel === 'Battery') {
      shape = 0.45 + 0.45 * Math.sin(((hour - 14) / 8) * Math.PI)
    } else {
      shape = 0.72 + 0.24 * Math.sin(((hour - 9) / 12) * Math.PI)
    }
    return Math.max(0, Math.round(outputMW * shape * (0.9 + random() * 0.2)))
  })
}

function buildDemoPlants(): PlantDatum[] {
  const random = seededRandom(8602026)
  return PLANT_HUBS.flatMap((hub, hubIndex) => {
    const count = 5 + (hubIndex % 4)
    return Array.from({ length: count }, (_, index) => {
      const fuel = PLANT_FUELS[(hubIndex * 2 + index) % PLANT_FUELS.length]
      const capacityMW = Math.round(180 + random() * (fuel === 'Nuclear' ? 2100 : 1250))
      const utilization = Math.round(32 + random() * 64)
      const statusRoll = random()
      const status: PlantDatum['status'] = statusRoll > .91 ? 'Standby' : statusRoll > .79 ? 'Reduced output' : 'Online'
      const outputMW = Math.round(capacityMW * utilization / 100)
      const series = buildSeries(fuel, outputMW, random)
      const opening = series[0] || 1
      return {
        id: `plant-${hubIndex}-${index}`,
        name: `${PLANT_PREFIXES[(hubIndex * 3 + index * 2) % PLANT_PREFIXES.length]} ${PLANT_SUFFIXES[fuel]}`,
        operator: `${hub.place} Power Co.`,
        region: hub.place,
        fuel,
        coordinates: [
          hub.coordinates[0] + (random() - .5) * 4.6,
          hub.coordinates[1] + (random() - .5) * 3.1,
        ] as [number, number],
        capacityMW,
        outputMW,
        utilization,
        emissions: fuel === 'Natural gas' ? Math.round(320 + random() * 170) : fuel === 'Battery' ? 8 : Math.round(random() * 18),
        commissioned: 1968 + Math.floor(random() * 56),
        units: 1 + Math.floor(random() * 5),
        status,
        change24h: Math.round(((series[series.length - 1] - opening) / opening) * 1000) / 10,
        series,
      }
    })
  })
}

const PLANTS = buildDemoPlants()
const PLANT_DATA = new Map<string, PlantDatum>(PLANTS.map((plant) => [plant.id, plant]))

/* ---------------------------------------------------------------------------
   National roll-ups — the numbers the header strip leads with.
   --------------------------------------------------------------------------- */

const NATIONAL = (() => {
  const outputMW = PLANTS.reduce((total, plant) => total + plant.outputMW, 0)
  const capacityMW = PLANTS.reduce((total, plant) => total + plant.capacityMW, 0)
  const carbonFreeMW = PLANTS.reduce((total, plant) => total + (CARBON_FREE.has(plant.fuel) ? plant.outputMW : 0), 0)
  const emissionsWeighted = PLANTS.reduce((total, plant) => total + plant.emissions * plant.outputMW, 0)
  const series = Array.from({ length: 24 }, (_, hour) =>
    PLANTS.reduce((total, plant) => total + plant.series[hour], 0),
  )
  const mix = FUEL_ORDER.map((fuel) => {
    const fuelMW = PLANTS.reduce((total, plant) => total + (plant.fuel === fuel ? plant.outputMW : 0), 0)
    return { fuel, outputMW: fuelMW, share: (fuelMW / outputMW) * 100 }
  }).sort((a, b) => b.outputMW - a.outputMW)

  return {
    outputMW,
    capacityMW,
    carbonFreeMW,
    carbonFreeShare: (carbonFreeMW / outputMW) * 100,
    intensity: Math.round(emissionsWeighted / outputMW),
    series,
    mix,
    change24h: Math.round(((series[23] - series[0]) / series[0]) * 1000) / 10,
    online: PLANTS.filter((plant) => plant.status === 'Online').length,
    reduced: PLANTS.filter((plant) => plant.status === 'Reduced output').length,
    standby: PLANTS.filter((plant) => plant.status === 'Standby').length,
  }
})()

/** Yesterday's intensity, so the strip has a period to compare against. */
const INTENSITY_CHANGE = -2.4

const NUMBER_FORMAT = new Intl.NumberFormat('en-US')

function fmtInt(value: number) {
  return NUMBER_FORMAT.format(Math.round(value))
}

function intensityLevel(value: number) {
  return value > 350 ? 2 : value > 100 ? 1 : 0
}

function utilizationLevel(value: number) {
  return value > 66 ? 2 : value > 33 ? 1 : 0
}

/** Meter fill runs accent → warning → danger as the reading gets worse. */
const SEVERITY_COLOR = ['var(--success)', 'var(--warning)', 'var(--danger)'] as const

// ---------------------------------------------------------------------------
// Mapbox setup
// ---------------------------------------------------------------------------

const MAPBOX_TOKEN: string | undefined = import.meta.env.VITE_MAPBOX_TOKEN

const CONUS_BOUNDS: [[number, number], [number, number]] = [[-125.5, 24.2], [-66.4, 49.8]]
const MAP_PADDING = { top: 48, right: 48, bottom: 56, left: 180 }
const MAP_STYLES: Record<Theme, string> = {
  light: 'mapbox://styles/mapbox/light-v11',
  dark: 'mapbox://styles/mapbox/dark-v11',
}

const statesCollection = feature(
  statesAtlas as never,
  statesAtlas.objects.states as never,
) as unknown as FeatureCollection<Geometry, { name: string }>

const STATE_FEATURES = statesCollection.features
  .filter((state) => Boolean(STATE_ABBREVIATIONS[state.properties.name]))
  .map((state) => ({ ...state, id: Number(state.id) }))

const STATES_GEOJSON: FeatureCollection<Geometry, { name: string }> = {
  type: 'FeatureCollection',
  features: STATE_FEATURES,
}

const PLANTS_GEOJSON: FeatureCollection<Point, { id: string; fuel: FuelType }> = {
  type: 'FeatureCollection',
  features: PLANTS.map((plant) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: plant.coordinates },
    properties: { id: plant.id, fuel: plant.fuel },
  })),
}

function fuelColorExpression(theme: Theme) {
  return [
    'match', ['get', 'fuel'],
    ...Object.entries(MAP_FUEL_COLORS[theme]).flat(),
    '#9ca3af',
  ] as unknown as ExpressionSpecification
}

function selectedPlantFilter(plantId: string | null): ExpressionSpecification {
  return ['all', ['!', ['has', 'point_count']], ['==', ['get', 'id'], plantId ?? '']] as unknown as ExpressionSpecification
}

function addMapOverlays(map: mapboxgl.Map, theme: Theme, selectedPlantId: string | null) {
  if (map.getSource('states')) return
  const isDark = theme === 'dark'
  const firstSymbolLayer = map.getStyle()?.layers.find((layer) => layer.type === 'symbol')?.id
  const surfaceRing = isDark ? '#0b0e14' : '#ffffff'

  map.addSource('states', { type: 'geojson', data: STATES_GEOJSON })
  map.addSource('plants', {
    type: 'geojson',
    data: PLANTS_GEOJSON,
    cluster: true,
    clusterRadius: 56,
    clusterMaxZoom: 9,
  })

  map.addLayer({
    id: 'states-fill',
    type: 'fill',
    source: 'states',
    paint: {
      'fill-color': isDark ? '#151922' : '#ffffff',
      'fill-opacity': .55,
    },
  }, firstSymbolLayer)
  map.addLayer({
    id: 'states-border',
    type: 'line',
    source: 'states',
    paint: {
      'line-color': isDark ? 'rgba(255,255,255,.12)' : 'rgba(13,20,33,.14)',
      'line-width': 1,
    },
  }, firstSymbolLayer)

  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'plants',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': isDark ? '#2e3444' : '#0d1421',
      'circle-radius': 14,
      'circle-stroke-width': 2,
      'circle-stroke-color': surfaceRing,
    },
  })
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'plants',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'] as unknown as ExpressionSpecification,
      'text-size': 12,
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
    },
    paint: { 'text-color': isDark ? '#eaeef5' : '#ffffff' },
  })
  map.addLayer({
    id: 'plants-selected',
    type: 'circle',
    source: 'plants',
    filter: selectedPlantFilter(selectedPlantId),
    paint: {
      'circle-radius': 11,
      'circle-opacity': 0,
      'circle-stroke-width': 2,
      'circle-stroke-color': fuelColorExpression(theme),
      'circle-stroke-opacity': .85,
    },
  })
  map.addLayer({
    id: 'plants-points',
    type: 'circle',
    source: 'plants',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': fuelColorExpression(theme),
      'circle-radius': 6,
      // A 2px ring in the surface colour keeps overlapping markers legible
      'circle-stroke-width': 2,
      'circle-stroke-color': surfaceRing,
    },
  })
}

/* ---------------------------------------------------------------------------
   Chart primitives
   --------------------------------------------------------------------------- */

function linePath(values: number[], width: number, height: number, pad = 2) {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = width / (values.length - 1)
  const usable = height - pad * 2
  return values
    .map((value, index) => {
      const x = index * stepX
      const y = pad + (1 - (value - min) / span) * usable
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

/**
 * A 24-point trend at row scale. No dots and no labels — the number beside it
 * carries the value; the sparkline only carries the shape.
 */
function Sparkline({ values, color, className }: { values: number[]; color: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path
        d={linePath(values, 100, 28)}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

const CHART_WIDTH = 320
const CHART_HEIGHT = 132

/** Hourly output with a crosshair readout — hover and keyboard land on the same value. */
function OutputChart({ values, color, unit = 'MW' }: { values: number[]; color: string; unit?: string }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const gradientId = useRef(`area-${Math.random().toString(36).slice(2)}`).current

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pointAt = (index: number) => ({
    x: (index / (values.length - 1)) * CHART_WIDTH,
    y: 4 + (1 - (values[index] - min) / span) * (CHART_HEIGHT - 8),
  })

  const trackPointer = (clientX: number) => {
    const frame = frameRef.current
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    setActiveIndex(Math.round(ratio * (values.length - 1)))
  }

  const line = linePath(values, CHART_WIDTH, CHART_HEIGHT, 4)
  const active = activeIndex === null ? null : pointAt(activeIndex)
  const last = pointAt(values.length - 1)

  return (
    <div className="relative">
      <div
        ref={frameRef}
        className="relative touch-none"
        onPointerMove={(event) => trackPointer(event.clientX)}
        onPointerLeave={() => setActiveIndex(null)}
      >
        <svg
          className="block h-[132px] w-full overflow-visible"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Hourly output over the past 24 hours, ${fmtInt(min)} to ${fmtInt(max)} ${unit}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity=".12" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[10, 44, 78, 112].map((y) => (
            <line key={y} x1="0" x2={CHART_WIDTH} y1={y} y2={y} stroke="var(--grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={`${line} L${CHART_WIDTH} ${CHART_HEIGHT} L0 ${CHART_HEIGHT} Z`} fill={`url(#${gradientId})`} />
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {active && (
            <line
              x1={active.x}
              x2={active.x}
              y1="0"
              y2={CHART_HEIGHT}
              stroke="var(--muted)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <circle
            cx={active ? active.x : last.x}
            cy={active ? active.y : last.y}
            r="4"
            fill={color}
            stroke="var(--overlay)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] leading-4 text-muted tabular-nums">
        <span>24h ago</span>
        <span>18h</span>
        <span>12h</span>
        <span>6h</span>
        <span>Now</span>
      </div>

      <p className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-2.5 py-1.5 text-[11px] leading-4">
        <span className="text-muted">
          {activeIndex === null
            ? 'Hover the chart for hourly detail'
            : activeIndex === values.length - 1
              ? 'Now'
              : `${values.length - 1 - activeIndex}h ago`}
        </span>
        <span className="font-semibold text-foreground tabular-nums">
          {fmtInt(values[activeIndex ?? values.length - 1])} {unit}
        </span>
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Small display pieces
   --------------------------------------------------------------------------- */

function Caret({ isUp }: { isUp: boolean }) {
  return (
    <svg width="8" height="6" viewBox="0 0 8 6" aria-hidden="true" className={isUp ? undefined : 'rotate-180'}>
      <path d="M4 0 8 6H0z" fill="currentColor" />
    </svg>
  )
}

/**
 * A signed move against a named period. `isUpGood` flips the colour for
 * measures where a fall is the good news, like carbon intensity.
 */
function Delta({ value, isUpGood = true, className = '' }: { value: number; isUpGood?: boolean; className?: string }) {
  const isUp = value >= 0
  const isGood = isUp === isUpGood
  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold tabular-nums ${isGood ? 'text-success' : 'text-danger'} ${className}`}
    >
      <Caret isUp={isUp} />
      {Math.abs(value).toFixed(2)}%
    </span>
  )
}

function StatTile({
  label,
  value,
  unit,
  delta,
  period,
  children,
}: {
  label: string
  value: string
  unit?: string
  delta?: ReactNode
  period?: string
  children?: ReactNode
}) {
  return (
    // No border or lift: the tile fill alone separates it from the page
    <Card className="gap-0 rounded-xl bg-tile px-3 py-2.5 shadow-none">
      <Card.Header className="flex-row items-center justify-between gap-2 p-0">
        <p className={MICRO_LABEL_CLASS}>{label}</p>
        {period && <span className="text-[10px] leading-4 text-muted">{period}</span>}
      </Card.Header>
      <Card.Content className="mt-1 gap-0 p-0">
        <p className="flex items-baseline gap-1.5">
          {/* Proportional figures: tabular digits read loose at display sizes */}
          <span className="text-[22px] leading-7 font-semibold tracking-[-0.02em] text-foreground">{value}</span>
          {unit && <span className="text-[12px] leading-4 font-medium text-muted">{unit}</span>}
          {delta && <span className="ml-0.5 text-[12px] leading-4">{delta}</span>}
        </p>
        {children && <div className="mt-2">{children}</div>}
      </Card.Content>
    </Card>
  )
}

/** Three-bar rating, used where an exact number matters less than the band. */
function LevelMeter({ level, label }: { level: number; label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-2" aria-label={`${label}: ${METER_LEVELS[level]}`}>
      <span className="flex items-center gap-[3px]" aria-hidden="true">
        {[0, 1, 2].map((segment) => (
          <i key={segment} className={`h-[7px] w-[11px] rounded-[2px] ${segment <= level ? 'bg-foreground' : 'bg-default'}`} />
        ))}
      </span>
      <span className="text-[10px] leading-4 font-semibold tracking-[0.04em] uppercase text-muted">{METER_LEVELS[level]}</span>
    </span>
  )
}

function StatusValue({ status }: { status: PlantDatum['status'] }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <i className={`size-[7px] shrink-0 rounded-full ${STATUS_DOT_CLASS[status]}`} />
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{status}</span>
    </span>
  )
}

/** Label above value — the pair the detail panel is built from. */
function Metric({ label, value, unit }: { label: string; value: ReactNode; unit?: string }) {
  return (
    <div className="min-w-0">
      <p className="overflow-hidden text-[11px] leading-4 text-ellipsis whitespace-nowrap text-muted">{label}</p>
      <p className="mt-1 flex items-baseline gap-1 text-[14px] leading-5 font-semibold text-foreground tabular-nums">
        {value}
        {unit && <span className="text-[11px] font-normal text-muted">{unit}</span>}
      </p>
    </div>
  )
}

/** A row of `label ......... value`, the way the reference cards list figures. */
function DataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-separator py-2 text-[12px] leading-5 last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-foreground tabular-nums">{value}</span>
    </div>
  )
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <h3 className={CARD_TITLE_CLASS}>{children}</h3>
      {action}
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Header strip
   --------------------------------------------------------------------------- */

function CleanShareBar() {
  const clean = NATIONAL.carbonFreeShare
  return (
    <div>
      {/* 2px gap in the surface colour is what separates the segments — no strokes */}
      <div className="flex h-2 w-full gap-[2px]" aria-hidden="true">
        <i className="rounded-l-[4px]" style={{ flexGrow: clean, backgroundColor: 'var(--fuel-wind)' }} />
        <i className="rounded-r-[4px]" style={{ flexGrow: 100 - clean, backgroundColor: 'var(--fuel-gas)' }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] leading-4 text-muted">
        <span className="flex items-center gap-1.5">
          <i className="size-1.5 rounded-full" style={{ backgroundColor: 'var(--fuel-wind)' }} />
          Carbon-free {clean.toFixed(1)}%
        </span>
        <span className="flex items-center gap-1.5">
          <i className="size-1.5 rounded-full" style={{ backgroundColor: 'var(--fuel-gas)' }} />
          Fossil {(100 - clean).toFixed(1)}%
        </span>
      </div>
    </div>
  )
}

function StatStrip() {
  const level = intensityLevel(NATIONAL.intensity)
  return (
    <div className="grid shrink-0 grid-cols-4 gap-2.5 border-b border-border bg-background px-4 py-3 max-[1240px]:grid-cols-2 max-[640px]:hidden">
      <StatTile
        label="Grid load"
        value={(NATIONAL.outputMW / 1000).toFixed(1)}
        unit="GW"
        delta={<Delta value={NATIONAL.change24h} />}
        period="24h"
      >
        <Sparkline values={NATIONAL.series} color="var(--fuel-wind)" className="h-7 w-full" />
      </StatTile>

      <StatTile
        label="Carbon intensity"
        value={fmtInt(NATIONAL.intensity)}
        unit="g/kWh"
        delta={<Delta value={INTENSITY_CHANGE} isUpGood={false} />}
        period="vs yesterday"
      >
        <div className="flex items-center gap-2.5">
          <ProgressBar
            aria-label={`Carbon intensity ${NATIONAL.intensity} grams per kilowatt hour`}
            className="w-full gap-0"
            value={Math.min(100, (NATIONAL.intensity / 600) * 100)}
          >
            {/* Track is a wash of the same hue as the fill, so state reads across the bar */}
            <ProgressBar.Track
              className="h-2 rounded-full"
              style={{ backgroundColor: `color-mix(in oklab, ${SEVERITY_COLOR[level]} 18%, transparent)` }}
            >
              <ProgressBar.Fill className="rounded-full" style={{ backgroundColor: SEVERITY_COLOR[level] }} />
            </ProgressBar.Track>
          </ProgressBar>
          <span className="shrink-0 text-[10px] leading-4 font-semibold tracking-[0.04em] uppercase text-muted">
            {METER_LEVELS[level]}
          </span>
        </div>
      </StatTile>

      <StatTile
        label="Generation mix"
        value={NATIONAL.carbonFreeShare.toFixed(1)}
        unit="% carbon-free"
        period="live"
      >
        <CleanShareBar />
      </StatTile>

      <StatTile
        label="Plants reporting"
        value={fmtInt(NATIONAL.online)}
        unit={`of ${fmtInt(PLANTS.length)}`}
        period="live"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] leading-4 text-muted">
          <span className="flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-success" />Online {NATIONAL.online}</span>
          <span className="flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-warning" />Reduced {NATIONAL.reduced}</span>
          <span className="flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-muted" />Standby {NATIONAL.standby}</span>
        </div>
      </StatTile>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Plant list sidebar

   Search and the fuel chips cover the everyday cuts; anything finer-grained
   lives behind the Filters popover so the list keeps its height.
   --------------------------------------------------------------------------- */

type PlantStatus = PlantDatum['status']
type Range = [number, number]
type RangeKey = 'capacity' | 'output' | 'utilization' | 'emissions' | 'commissioned'
type Trend = 'any' | 'rising' | 'falling'
type DetailFilters = Record<RangeKey, Range> & {
  statuses: PlantStatus[]
  regions: string[]
  trend: Trend
}

const FUEL_ICON: Record<FuelType, LucideIcon> = {
  Solar: Sun,
  Wind: Wind,
  Hydro: Droplets,
  'Natural gas': Flame,
  Nuclear: Atom,
  Battery: BatteryCharging,
}

const STATUS_ORDER: PlantStatus[] = ['Online', 'Reduced output', 'Standby']
const STATUS_SHORT: Record<PlantStatus, string> = { Online: 'Online', 'Reduced output': 'Reduced', Standby: 'Standby' }
const STATUS_COUNT: Record<PlantStatus, number> = {
  Online: NATIONAL.online,
  'Reduced output': NATIONAL.reduced,
  Standby: NATIONAL.standby,
}

const REGIONS: string[] = PLANT_HUBS.map((hub) => hub.place)

const SORT_OPTIONS: Record<SortKey, { label: string; compare: (a: PlantDatum, b: PlantDatum) => number }> = {
  name: { label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) || a.region.localeCompare(b.region) },
  output: { label: 'Highest output', compare: (a, b) => b.outputMW - a.outputMW },
  capacity: { label: 'Largest capacity', compare: (a, b) => b.capacityMW - a.capacityMW },
  intensity: { label: 'Lowest carbon', compare: (a, b) => a.emissions - b.emissions },
  newest: { label: 'Newest', compare: (a, b) => b.commissioned - a.commissioned },
}

/** Data extent rounded out to the slider step, so both thumbs start on a clean value. */
function extentOf(values: number[], step: number): Range {
  return [Math.floor(Math.min(...values) / step) * step, Math.ceil(Math.max(...values) / step) * step]
}

function rangeFilter(
  key: RangeKey,
  label: string,
  step: number,
  read: (plant: PlantDatum) => number,
  format: (range: Range) => string,
) {
  return { key, label, step, read, format, bounds: extentOf(PLANTS.map(read), step) }
}

const formatMW = ([min, max]: Range) => `${fmtInt(min)} – ${fmtInt(max)} MW`

const RANGE_FILTERS = [
  rangeFilter('capacity', 'Nameplate capacity', 50, (plant) => plant.capacityMW, formatMW),
  rangeFilter('output', 'Generating now', 50, (plant) => plant.outputMW, formatMW),
  rangeFilter('utilization', 'Capacity in use', 5, (plant) => plant.utilization, ([min, max]) => `${min} – ${max}%`),
  rangeFilter('emissions', 'Carbon intensity', 10, (plant) => plant.emissions, ([min, max]) => `${min} – ${max} g/kWh`),
  // Years, so no thousands separator
  rangeFilter('commissioned', 'Commissioned', 1, (plant) => plant.commissioned, ([min, max]) => `${min} – ${max}`),
]

const DEFAULT_FILTERS: DetailFilters = {
  statuses: [],
  regions: [],
  trend: 'any',
  ...(Object.fromEntries(RANGE_FILTERS.map(({ key, bounds }) => [key, bounds])) as Record<RangeKey, Range>),
}

/** How many popover filters are narrowing the list — the number on the Filters button. */
function countActiveFilters(filters: DetailFilters) {
  const narrowedRanges = RANGE_FILTERS.filter(
    ({ key, bounds }) => filters[key][0] > bounds[0] || filters[key][1] < bounds[1],
  ).length
  return narrowedRanges
    + Number(filters.statuses.length > 0)
    + Number(filters.regions.length > 0)
    + Number(filters.trend !== 'any')
}

function matchesDetailFilters(plant: PlantDatum, filters: DetailFilters) {
  if (filters.statuses.length > 0 && !filters.statuses.includes(plant.status)) return false
  if (filters.regions.length > 0 && !filters.regions.includes(plant.region)) return false
  if (filters.trend === 'rising' && plant.change24h < 0) return false
  if (filters.trend === 'falling' && plant.change24h >= 0) return false
  return RANGE_FILTERS.every(({ key, read }) => {
    const value = read(plant)
    return value >= filters[key][0] && value <= filters[key][1]
  })
}

const FILTER_LABEL_CLASS = 'text-[12px] leading-4 font-medium text-foreground'

/** Lets a marker picked on the map find its row in the list. */
const plantRowId = (plantId: string) => `plant-row-${plantId}`

function RangeFilter({
  label,
  bounds,
  step,
  value,
  format,
  onChange,
}: {
  label: string
  bounds: Range
  step: number
  value: Range
  format: (range: Range) => string
  onChange: (value: Range) => void
}) {
  return (
    <Slider
      className="range-slider gap-x-3 gap-y-1.5"
      minValue={bounds[0]}
      maxValue={bounds[1]}
      step={step}
      value={value}
      onChange={(next) => {
        if (Array.isArray(next)) onChange([next[0], next[1]])
      }}
    >
      <Label className={FILTER_LABEL_CLASS}>{label}</Label>
      <Slider.Output className="text-[11px] leading-4 font-medium text-muted">
        {({ state }) => format([state.values[0], state.values[1]])}
      </Slider.Output>
      <Slider.Track>
        {({ state }) => (
          <>
            <Slider.Fill />
            {state.values.map((_, index) => (
              <Slider.Thumb key={index} index={index} aria-label={index === 0 ? 'Minimum' : 'Maximum'} />
            ))}
          </>
        )}
      </Slider.Track>
    </Slider>
  )
}

function FilterPopover({
  filters,
  setFilters,
  matchCount,
}: {
  filters: DetailFilters
  setFilters: Dispatch<SetStateAction<DetailFilters>>
  matchCount: number
}) {
  const [isOpen, setIsOpen] = useState(false)
  const trendLabelId = useId()
  const activeCount = countActiveFilters(filters)
  // Functional update: slider drags fire faster than renders land
  const update = (patch: Partial<DetailFilters>) => setFilters((current) => ({ ...current, ...patch }))

  const renderRange = ({ key, label, step, bounds, format }: (typeof RANGE_FILTERS)[number]) => (
    <RangeFilter
      key={key}
      label={label}
      bounds={bounds}
      step={step}
      value={filters[key]}
      format={format}
      onChange={(value) => update({ [key]: value })}
    />
  )

  return (
    <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
      <Button
        variant="ghost"
        className="h-8 min-h-8 shrink-0 gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-medium text-foreground hover:bg-surface-secondary"
        aria-label={activeCount > 0 ? `Detailed filters, ${activeCount} active` : 'Detailed filters'}
      >
        <SlidersHorizontal size={14} className="text-muted" />
        Filters
        {activeCount > 0 && (
          <Chip
            size="sm"
            color="accent"
            variant="primary"
            className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums"
          >
            {activeCount}
          </Chip>
        )}
      </Button>

      <Popover.Content
        placement="bottom end"
        offset={6}
        className="flex w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-border shadow-overlay"
      >
        <Popover.Dialog className="flex min-h-0 flex-1 flex-col p-0">
          <div className="shrink-0 border-b border-separator px-4 py-3">
            <Popover.Heading className="text-[13px] leading-5 font-semibold text-foreground">Detailed filters</Popover.Heading>
            <p className="text-[11px] leading-4 text-muted">Narrow the list by how each plant is built and running</p>
          </div>

          <ScrollShadow className="min-h-0 flex-1 overflow-y-auto px-4 py-4" hideScrollBar size={20}>
            <div className="flex flex-col gap-4">
              <CheckboxGroup
                value={filters.statuses}
                onChange={(statuses) => update({ statuses: statuses as PlantStatus[] })}
                className="gap-2 **:data-[slot=checkbox]:mt-0"
              >
                <Label className={FILTER_LABEL_CLASS}>Status</Label>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {STATUS_ORDER.map((status) => (
                    <Checkbox key={status} value={status}>
                      <Checkbox.Content className="gap-2 text-[12px] font-normal">
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                        <span className="flex items-center gap-1.5">
                          <i className={`size-1.5 rounded-full ${STATUS_DOT_CLASS[status]}`} aria-hidden="true" />
                          {STATUS_SHORT[status]}
                          <span className="text-muted tabular-nums">{STATUS_COUNT[status]}</span>
                        </span>
                      </Checkbox.Content>
                    </Checkbox>
                  ))}
                </div>
              </CheckboxGroup>

              <Select
                className="gap-1.5"
                selectionMode="multiple"
                placeholder="All regions"
                value={filters.regions}
                onChange={(regions) => update({ regions: Array.isArray(regions) ? regions.map(String) : [] })}
              >
                <Label className={FILTER_LABEL_CLASS}>Region</Label>
                <Select.Trigger className="min-h-8 rounded-lg py-1.5 text-[12px]">
                  <Select.Value className="min-w-0 truncate text-[12px]" />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox selectionMode="multiple">
                    {REGIONS.map((region) => (
                      <ListBox.Item id={region} key={region} textValue={region}>
                        {region}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>

            <Separator className="my-4" />

            <div className="flex flex-col gap-4">{RANGE_FILTERS.slice(0, 3).map(renderRange)}</div>

            <Separator className="my-4" />

            <div className="flex flex-col gap-4">
              {RANGE_FILTERS.slice(3).map(renderRange)}

              <div className="flex flex-col gap-1.5">
                <span id={trendLabelId} className={FILTER_LABEL_CLASS}>Output over 24 hours</span>
                <ToggleButtonGroup
                  aria-labelledby={trendLabelId}
                  className="segmented"
                  selectionMode="single"
                  disallowEmptySelection
                  fullWidth
                  selectedKeys={[filters.trend]}
                  onSelectionChange={(keys) => update({ trend: ([...keys][0] as Trend | undefined) ?? 'any' })}
                >
                  <ToggleButton id="any">Any</ToggleButton>
                  <ToggleButton id="rising">Rising</ToggleButton>
                  <ToggleButton id="falling">Falling</ToggleButton>
                </ToggleButtonGroup>
              </div>
            </div>
          </ScrollShadow>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-separator px-4 py-3">
            <Button
              size="sm"
              variant="ghost"
              isDisabled={activeCount === 0}
              onPress={() => setFilters(DEFAULT_FILTERS)}
              className="h-8 min-h-8 gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-muted hover:text-foreground"
            >
              <RotateCcw size={12} />
              Reset
            </Button>
            <Button size="sm" onPress={() => setIsOpen(false)} className="h-8 min-h-8 rounded-lg px-3 text-[12px] font-semibold">
              Show {fmtInt(matchCount)} {matchCount === 1 ? 'plant' : 'plants'}
            </Button>
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}

function PlantList({
  plants,
  selectedPlantId,
  onSelect,
}: {
  plants: PlantDatum[]
  selectedPlantId: string | null
  onSelect: (plantId: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [fuels, setFuels] = useState<ReadonlySet<FuelType>>(() => new Set())
  const [filters, setFilters] = useState<DetailFilters>(DEFAULT_FILTERS)
  const [sortKey, setSortKey] = useState<SortKey>('name')

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return plants
      .filter((plant) =>
        (fuels.size === 0 || fuels.has(plant.fuel))
        && (needle === '' || `${plant.name} ${plant.operator} ${plant.fuel}`.toLowerCase().includes(needle))
        && matchesDetailFilters(plant, filters),
      )
      .sort(SORT_OPTIONS[sortKey].compare)
  }, [plants, query, fuels, filters, sortKey])

  const isFiltered = query.trim() !== '' || fuels.size > 0 || countActiveFilters(filters) > 0

  const clearAll = () => {
    setQuery('')
    setFuels(new Set())
    setFilters(DEFAULT_FILTERS)
  }

  // A marker picked on the map brings its row into view
  useEffect(() => {
    if (!selectedPlantId) return
    document.getElementById(plantRowId(selectedPlantId))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedPlantId])

  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-border bg-background max-[1100px]:hidden">
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-border px-4 py-3">
        <h2 className="text-[14px] leading-5 font-semibold tracking-[-0.01em] text-foreground">Power plants</h2>

        <div className="flex items-center gap-2">
          <SearchField aria-label="Search power plants" value={query} onChange={setQuery} className="min-w-0 flex-1">
            <SearchField.Group className="h-8 rounded-lg">
              <SearchField.SearchIcon className="ml-2.5 size-3.5 text-muted" />
              <SearchField.Input className="px-2 text-[12px]" placeholder="Search plants or operators" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <FilterPopover filters={filters} setFilters={setFilters} matchCount={visible.length} />
        </div>

        <TagGroup
          aria-label="Filter by generation source"
          selectionMode="multiple"
          size="sm"
          selectedKeys={fuels}
          onSelectionChange={(keys) => setFuels(new Set(keys === 'all' ? FUEL_ORDER : ([...keys] as FuelType[])))}
        >
          {/* Sized so all six fit one row at the sidebar's width */}
          <TagGroup.List className="flex flex-wrap gap-1">
            {FUEL_ORDER.map((fuel) => (
              <Tag id={fuel} key={fuel} textValue={fuel} className="gap-1 rounded-md px-1.5 py-1 text-[11px]">
                <i className="size-1.5 rounded-full" style={{ backgroundColor: FUEL_VAR[fuel] }} aria-hidden="true" />
                {fuel}
              </Tag>
            ))}
          </TagGroup.List>
        </TagGroup>
      </div>

      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border pr-2.5 pl-4">
        <p className="flex items-center gap-1 text-[11px] leading-4 text-muted tabular-nums">
          {isFiltered ? `${fmtInt(visible.length)} of ${fmtInt(plants.length)} plants` : `${fmtInt(plants.length)} plants`}
          {isFiltered && (
            <Button
              size="sm"
              variant="ghost"
              onPress={clearAll}
              className="h-6 min-h-6 rounded-md px-1.5 text-[11px] font-medium text-accent"
            >
              Clear all
            </Button>
          )}
        </p>

        <Select
          aria-label="Sort plants"
          className="shrink-0"
          value={sortKey}
          onChange={(key) => {
            if (typeof key === 'string') setSortKey(key as SortKey)
          }}
        >
          <Select.Trigger className="h-7 min-h-7 items-center gap-1.5 rounded-md border-0 bg-transparent py-0 ps-2 text-[11px] font-medium text-foreground hover:bg-surface-secondary">
            <ArrowUpDown size={12} className="shrink-0 text-muted" />
            <Select.Value className="text-[11px]" />
            <Select.Indicator className="text-muted" />
          </Select.Trigger>
          <Select.Popover placement="bottom end" className="min-w-[168px]">
            <ListBox>
              {(Object.keys(SORT_OPTIONS) as SortKey[]).map((key) => (
                <ListBox.Item id={key} key={key} textValue={SORT_OPTIONS[key].label}>
                  {SORT_OPTIONS[key].label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      {visible.length > 0 ? (
        <ScrollShadow className="min-h-0 flex-1 overflow-y-auto" hideScrollBar size={24}>
          <ListBox
            aria-label="Power plants"
            className="plant-list"
            items={visible}
            selectionMode="single"
            selectedKeys={selectedPlantId ? [selectedPlantId] : []}
            onSelectionChange={(keys) => {
              const next = keys === 'all' ? undefined : ([...keys][0] as string | undefined)
              onSelect(next ?? null)
            }}
          >
            {(plant) => {
              const FuelIcon = FUEL_ICON[plant.fuel]
              return (
                <ListBox.Item id={plant.id} textValue={plant.name}>
                  <span
                    className="grid size-8 shrink-0 place-items-center rounded-lg"
                    style={{
                      color: FUEL_VAR[plant.fuel],
                      backgroundColor: `color-mix(in oklab, ${FUEL_VAR[plant.fuel]} 15%, transparent)`,
                    }}
                    aria-hidden="true"
                  >
                    <FuelIcon size={15} strokeWidth={2} />
                  </span>
                  <span id={plantRowId(plant.id)} className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[12px] leading-5 font-medium text-foreground">{plant.name}</span>
                      <span className="shrink-0 text-[12px] leading-5 font-semibold text-foreground tabular-nums">
                        {fmtInt(plant.outputMW)}
                        <span className="ml-1 text-[10px] font-medium text-muted">MW</span>
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-3 text-[11px] leading-4 text-muted">
                      <span className="truncate">{plant.fuel} · {plant.region}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <i className={`size-1.5 rounded-full ${STATUS_DOT_CLASS[plant.status]}`} />
                        {STATUS_SHORT[plant.status]}
                      </span>
                    </span>
                  </span>
                </ListBox.Item>
              )
            }}
          </ListBox>
        </ScrollShadow>
      ) : (
        <EmptyState className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <span className="grid size-9 place-items-center rounded-lg bg-surface-secondary text-muted">
            <SearchX size={16} />
          </span>
          <p className="mt-3 text-[13px] leading-5 font-semibold text-foreground">No plants match</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted">Try a broader search or widen one of the ranges.</p>
          <Button size="sm" variant="secondary" onPress={clearAll} className="mt-3.5 h-8 min-h-8 rounded-lg px-3 text-[12px]">
            Clear all filters
          </Button>
        </EmptyState>
      )}

      <p className="shrink-0 border-t border-border px-4 py-2.5 text-[11px] leading-4 text-muted">
        Select a plant to open it and centre the map.
      </p>
    </aside>
  )
}

/* ---------------------------------------------------------------------------
   Generation mix panel — the legend for the map's marker colours, and the
   table view of the same shares.
   --------------------------------------------------------------------------- */

function MixPanel({ plants }: { plants: PlantDatum[] }) {
  const mix = useMemo(() => {
    const total = plants.reduce((sum, plant) => sum + plant.outputMW, 0) || 1
    return FUEL_ORDER.map((fuel) => {
      const outputMW = plants.reduce((sum, plant) => sum + (plant.fuel === fuel ? plant.outputMW : 0), 0)
      return { fuel, outputMW, share: (outputMW / total) * 100 }
    })
      .filter((row) => row.outputMW > 0)
      .sort((a, b) => b.outputMW - a.outputMW)
  }, [plants])

  const leader = mix[0]?.share || 1

  return (
    <Card className={`absolute bottom-3 left-3 z-10 w-[276px] gap-0 px-3.5 py-3 ${PANEL_CLASS} max-[900px]:hidden`}>
      <Card.Header className="flex-row items-center justify-between gap-2 p-0">
        <Card.Title className={CARD_TITLE_CLASS}>Generation mix</Card.Title>
        <Tooltip delay={250}>
          <Button isIconOnly size="sm" variant="ghost" className="h-6 min-h-6 w-6 min-w-6 text-muted" aria-label="About the generation mix">
            <Info size={13} />
          </Button>
          <Tooltip.Content>Marker colour on the map is the plant's generation source</Tooltip.Content>
        </Tooltip>
      </Card.Header>
      <Card.Content className="mt-2.5 gap-1.5 p-0">
        {mix.map((row) => (
          <div className="flex items-center gap-2" key={row.fuel}>
            <i className="size-2 shrink-0 rounded-full" style={{ backgroundColor: FUEL_VAR[row.fuel] }} />
            <span className="w-[74px] shrink-0 overflow-hidden text-[11px] leading-4 text-ellipsis whitespace-nowrap text-muted">
              {row.fuel}
            </span>
            <span className="flex h-2 min-w-0 flex-1 items-center">
              {/* Bar grows from a single baseline, 4px rounded data-end */}
              <i
                className="h-2 rounded-r-[4px]"
                style={{ width: `${Math.max(2, (row.share / leader) * 100)}%`, backgroundColor: FUEL_VAR[row.fuel] }}
              />
            </span>
            <span className="w-[42px] shrink-0 text-right text-[11px] leading-4 font-semibold text-foreground tabular-nums">
              {row.share.toFixed(1)}%
            </span>
          </div>
        ))}
      </Card.Content>
      <Card.Footer className="mt-2.5 border-t border-separator p-0 pt-2 text-[10px] leading-4 text-muted">
        Share of {fmtInt(plants.reduce((sum, plant) => sum + plant.outputMW, 0))} MW now generating
      </Card.Footer>
    </Card>
  )
}

/* ---------------------------------------------------------------------------
   Map hover card
   --------------------------------------------------------------------------- */

const HOVER_CARD_WIDTH = 320
const HOVER_CARD_EDGE_GAP = 16
const HOVER_CARD_BOTTOM_GAP = 300

function positionHoverCard(element: HTMLDivElement | null, point: HoverPoint) {
  if (!element) return

  const left = Math.max(
    HOVER_CARD_EDGE_GAP,
    Math.min(point.x + 20, window.innerWidth - HOVER_CARD_WIDTH - 20),
  )
  const top = Math.max(90, Math.min(point.y - 100, window.innerHeight - HOVER_CARD_BOTTOM_GAP))

  element.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
}

function HoverCard({ datum, tooltipRef }: { datum: PlantDatum; tooltipRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={tooltipRef} className="pointer-events-none fixed top-0 left-0 z-30 will-change-transform" role="tooltip">
      <Card className="w-[320px] gap-0 overflow-hidden rounded-xl border border-border bg-overlay p-0 text-foreground shadow-overlay max-[400px]:w-[calc(100vw-20px)]">
        <Card.Header className="gap-0 border-b border-separator px-3.5 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Card.Title className={`${TITLE_CLASS} text-[14px] leading-5 font-semibold`}>{datum.name}</Card.Title>
              <Card.Description className="mt-0.5 overflow-hidden text-[11px] leading-4 text-ellipsis whitespace-nowrap">
                {datum.operator}
              </Card.Description>
            </div>
            <Chip size="sm" variant="secondary" className="h-6 shrink-0 rounded-md border border-border bg-surface-secondary px-2 text-[10px] font-medium">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: FUEL_VAR[datum.fuel] }} />
              <Chip.Label className="font-medium text-foreground">{datum.fuel}</Chip.Label>
            </Chip>
          </div>
        </Card.Header>

        <Card.Content className="gap-0 px-3.5 py-3">
          <div className="flex items-end justify-between gap-3">
            <p className="flex items-baseline gap-1.5">
              <span className="text-[24px] leading-7 font-semibold tracking-[-0.02em]">{fmtInt(datum.outputMW)}</span>
              <span className="text-[12px] leading-4 font-medium text-muted">MW</span>
              <Delta value={datum.change24h} className="ml-0.5 text-[12px]" />
            </p>
            <Sparkline
              values={datum.series}
              color={datum.change24h >= 0 ? 'var(--success)' : 'var(--danger)'}
              className="h-8 w-[92px] shrink-0"
            />
          </div>

          <div className="mt-3.5 grid grid-cols-3 gap-3 border-t border-separator pt-3">
            <Metric label="Capacity" value={fmtInt(datum.capacityMW)} unit="MW" />
            <Metric label="Carbon" value={fmtInt(datum.emissions)} unit="g/kWh" />
            <Metric label="Load" value={`${datum.utilization}`} unit="%" />
          </div>
        </Card.Content>

        <Card.Footer className="border-t border-separator bg-surface-secondary px-3.5 py-2 text-[10px] leading-4 text-muted">
          <StatusValue status={datum.status} />
          <span className="ml-auto">Click for full details</span>
        </Card.Footer>
      </Card>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Plant detail panel
   --------------------------------------------------------------------------- */

function PlantPanel({ datum, onClose }: { datum: PlantDatum; onClose: () => void }) {
  const drawerState = useOverlayState({ defaultOpen: true, onOpenChange: (isOpen) => { if (!isOpen) onClose() } })
  const plantColor = FUEL_VAR[datum.fuel]
  const availableMW = Math.max(0, datum.capacityMW - datum.outputMW)

  return (
    <Drawer state={drawerState}>
      <Drawer.Backdrop variant="transparent" isDismissable>
        <Drawer.Content
          placement="left"
          className="top-[calc(var(--map-top,200px)+12px)]! right-auto! bottom-3! left-3! h-auto! w-auto! max-[800px]:right-3!"
        >
          <Drawer.Dialog
            aria-label={`${datum.name} power plant details`}
            className="h-full! w-[380px]! max-w-[calc(100vw-24px)]! overflow-hidden rounded-xl! border border-border bg-overlay p-0! shadow-overlay max-[800px]:w-full! max-[800px]:max-w-none!"
          >
            <Drawer.Header className="mb-0 block border-b border-separator px-4 pt-3.5 pb-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Drawer.Heading className={`${TITLE_CLASS} text-[16px] leading-6 font-semibold tracking-[-0.01em] text-foreground`}>
                    {datum.name}
                  </Drawer.Heading>
                  <p className="mt-0.5 overflow-hidden text-[11px] leading-4 text-ellipsis whitespace-nowrap text-muted">
                    {datum.operator}
                  </p>
                </div>
                <Drawer.CloseTrigger
                  className="static size-7 min-h-7 w-7 min-w-7 shrink-0 rounded-lg border-0 bg-default text-muted hover:bg-surface-tertiary"
                  aria-label="Close plant details"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Chip size="sm" variant="secondary" className="h-6 rounded-md border border-border bg-surface-secondary px-2 text-[10px] font-medium">
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: plantColor }} />
                  <Chip.Label className="font-medium text-foreground">{datum.fuel}</Chip.Label>
                </Chip>
                <Chip
                  size="sm"
                  variant="soft"
                  color={datum.status === 'Online' ? 'success' : datum.status === 'Reduced output' ? 'warning' : 'default'}
                  className="h-6 rounded-md px-2 text-[10px] font-medium"
                >
                  <span className="size-1.5 rounded-full bg-current" />
                  <Chip.Label className="font-medium">{datum.status}</Chip.Label>
                </Chip>
                <Chip size="sm" variant="secondary" className="h-6 rounded-md border border-border bg-surface-secondary px-2 text-[10px] font-medium">
                  <Zap size={11} strokeWidth={2} />
                  <Chip.Label className="font-medium text-foreground">{datum.units} {datum.units === 1 ? 'unit' : 'units'}</Chip.Label>
                </Chip>
              </div>
            </Drawer.Header>

            <Drawer.Body className="m-0 overflow-hidden p-0">
              <ScrollShadow className="h-full overflow-y-auto px-4 pb-4" hideScrollBar size={28}>
                <div className="border-b border-separator py-4">
                  <p className="flex items-baseline gap-2">
                    <span className="text-[32px] leading-9 font-semibold tracking-[-0.02em] text-foreground">
                      {fmtInt(datum.outputMW)}
                    </span>
                    <span className="text-[14px] leading-5 font-medium text-muted">MW</span>
                    <Delta value={datum.change24h} className="text-[13px]" />
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-muted">
                    Generating now · {fmtInt(availableMW)} MW held in reserve
                  </p>

                  <div className="mt-3.5 flex items-center justify-between text-[12px] leading-4">
                    <span className="text-muted">Capacity in use</span>
                    <span className="font-semibold text-foreground tabular-nums">{datum.utilization}%</span>
                  </div>
                  <ProgressBar
                    aria-label={`${datum.utilization}% of plant capacity in use`}
                    className="mt-1.5 w-full gap-0"
                    value={datum.utilization}
                  >
                    <ProgressBar.Track className="h-2 rounded-full bg-default">
                      <ProgressBar.Fill className="rounded-full" style={{ backgroundColor: plantColor }} />
                    </ProgressBar.Track>
                  </ProgressBar>
                </div>

                <Tabs defaultSelectedKey="overview" className="mt-4">
                  <Tabs.ListContainer>
                    <Tabs.List aria-label="Power plant data view" className="grid grid-cols-2">
                      <Tabs.Tab id="overview">Overview<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="performance">Performance<Tabs.Indicator /></Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>

                  <Tabs.Panel id="overview" className="mt-4 flex flex-col gap-4 p-0 outline-none">
                    <section>
                      <SectionTitle>Plant details</SectionTitle>
                      <div className="mt-1.5">
                        <DataRow label="Operator" value={datum.operator} />
                        <DataRow
                          label="Generation source"
                          value={
                            <span className="flex items-center gap-1.5">
                              <i className="size-2 rounded-full" style={{ backgroundColor: plantColor }} />
                              {datum.fuel}
                            </span>
                          }
                        />
                        <DataRow label="Nameplate capacity" value={`${fmtInt(datum.capacityMW)} MW`} />
                        <DataRow label="Generating units" value={fmtInt(datum.units)} />
                        {/* A year, so no thousands separator */}
                        <DataRow label="Commissioned" value={datum.commissioned} />
                        <DataRow label="Daily output" value={`${fmtInt(datum.outputMW * 24)} MWh`} />
                      </div>
                    </section>

                    <section>
                      <SectionTitle>Carbon intensity</SectionTitle>
                      <div className="mt-2 flex items-end justify-between gap-4 rounded-lg border border-border bg-surface px-3 py-2.5">
                        <p className="flex items-baseline gap-1.5">
                          <span className="text-[24px] leading-7 font-semibold tracking-[-0.02em] text-foreground">
                            {fmtInt(datum.emissions)}
                          </span>
                          <span className="text-[11px] font-medium text-muted">gCO₂e / kWh</span>
                        </p>
                        <LevelMeter level={intensityLevel(datum.emissions)} label="Carbon intensity" />
                      </div>
                    </section>
                  </Tabs.Panel>

                  <Tabs.Panel id="performance" className="mt-4 flex flex-col gap-4 p-0 outline-none">
                    <section>
                      <SectionTitle
                        action={
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 min-h-6 gap-1 rounded-md border border-border px-2 text-[10px] font-medium text-muted"
                          >
                            Hourly<ChevronDown size={11} />
                          </Button>
                        }
                      >
                        Output · past 24 hours
                      </SectionTitle>
                      <div className="mt-2">
                        <OutputChart values={datum.series} color={plantColor} />
                      </div>
                    </section>

                    <section>
                      <SectionTitle>Period summary</SectionTitle>
                      <div className="mt-1.5">
                        <DataRow label="24h high" value={`${fmtInt(Math.max(...datum.series))} MW`} />
                        <DataRow label="24h low" value={`${fmtInt(Math.min(...datum.series))} MW`} />
                        <DataRow
                          label="24h average"
                          value={`${fmtInt(datum.series.reduce((sum, value) => sum + value, 0) / datum.series.length)} MW`}
                        />
                        <DataRow label="24h move" value={<Delta value={datum.change24h} />} />
                      </div>
                    </section>

                    <section>
                      <SectionTitle>Utilisation</SectionTitle>
                      <div className="mt-2 grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
                        <Metric label="In use" value={`${datum.utilization}`} unit="%" />
                        <Metric label="Reserve" value={fmtInt(availableMW)} unit="MW" />
                        <Metric label="Band" value={<LevelMeter level={utilizationLevel(datum.utilization)} label="Utilisation" />} />
                      </div>
                    </section>
                  </Tabs.Panel>
                </Tabs>

                <div className="flex items-center gap-2.5 border-t border-separator pt-3.5">
                  <Surface className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface shadow-none">
                    <Factory size={16} strokeWidth={1.8} style={{ color: plantColor }} />
                  </Surface>
                  <div className="min-w-0">
                    <p className="text-[10px] leading-4 text-muted">Reporting since</p>
                    <p className="flex items-center gap-1.5 text-[12px] leading-4 font-medium text-foreground">
                      <CalendarDays size={12} strokeWidth={2} className="text-muted" />
                      {datum.commissioned}
                    </p>
                  </div>
                </div>
              </ScrollShadow>
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  )
}

/* ---------------------------------------------------------------------------
   Chrome
   --------------------------------------------------------------------------- */

function IconControl({ children, label, onPress }: { children: ReactNode; label: string; onPress?: () => void }) {
  return (
    <Tooltip delay={250}>
      <Button isIconOnly size="sm" variant="ghost" className={CONTROL_BUTTON_CLASS} aria-label={label} onPress={onPress}>
        {children}
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  )
}

function TopNav({ theme, onThemeToggle }: { theme: Theme; onThemeToggle: () => void }) {
  const isDark = theme === 'dark'
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
      <Link href="#" className="gap-2 text-[15px] font-semibold whitespace-nowrap hover:no-underline" aria-label="PowerMap home">
        <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Zap size={15} fill="currentColor" />
        </span>
        <span className="tracking-[-0.02em]">PowerMap</span>
      </Link>

      <Separator orientation="vertical" className="h-5 max-[900px]:hidden" />

      <Chip color="success" size="sm" variant="soft" className="h-6 rounded-md px-2 text-[10px] font-medium max-[900px]:hidden">
        <span className="size-1.5 rounded-full bg-success" />
        <Chip.Label className="font-medium">Live</Chip.Label>
      </Chip>

      <Button
        variant="ghost"
        className="ml-1 h-8 w-[min(280px,24vw)] justify-start gap-2 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-normal text-muted hover:bg-surface-secondary max-[900px]:hidden"
        aria-label="Find a power plant"
      >
        <Search size={14} />
        <span className="flex-1 text-left">Find a power plant</span>
        <Kbd variant="light" className="border border-border bg-surface-secondary px-1.5 py-0 text-[10px]">⌘ K</Kbd>
      </Button>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          className="h-8 min-h-8 gap-2 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-medium text-foreground hover:bg-surface-secondary max-[640px]:hidden"
          aria-label="Choose what marker colour represents"
        >
          <span className="flex items-center gap-0.5" aria-hidden="true">
            {FUEL_ORDER.slice(0, 3).map((fuel) => (
              <i key={fuel} className="size-1.5 rounded-full" style={{ backgroundColor: FUEL_VAR[fuel] }} />
            ))}
          </span>
          <span>Generation source</span>
          <ChevronDown size={13} className="text-muted" />
        </Button>
        <Tooltip delay={250}>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            className={CONTROL_BUTTON_CLASS}
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            aria-pressed={!isDark}
            onPress={onThemeToggle}
          >
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
          </Button>
          <Tooltip.Content>Switch to {isDark ? 'light' : 'dark'} mode</Tooltip.Content>
        </Tooltip>
        <IconControl label="Settings"><Settings2 size={15} /></IconControl>
      </div>
    </header>
  )
}

/* ---------------------------------------------------------------------------
   App
   --------------------------------------------------------------------------- */

function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [hoveredPlantId, setHoveredPlantId] = useState<string | null>(null)
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null)
  const hoverPointRef = useRef<HoverPoint>({ x: 540, y: 280 })
  const hoverCardRef = useRef<HTMLDivElement>(null)
  const hoverFrameRef = useRef<number | null>(null)
  const mapRegionRef = useRef<HTMLDivElement>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const selectedPlantIdRef = useRef<string | null>(null)
  const themeRef = useRef(theme)
  const appliedThemeRef = useRef(theme)

  const hoveredPlant = hoveredPlantId ? PLANT_DATA.get(hoveredPlantId) : undefined
  const selectedPlant = selectedPlantId ? PLANT_DATA.get(selectedPlantId) : undefined
  const isDark = theme === 'dark'

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.classList.toggle('dark', isDark)
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [isDark, theme])

  useLayoutEffect(() => {
    positionHoverCard(hoverCardRef.current, hoverPointRef.current)
  }, [hoveredPlantId])

  /* The detail panel is portalled to the body, so it needs the map region's
     offset published as a variable to line its top edge up with the map. */
  useLayoutEffect(() => {
    const region = mapRegionRef.current
    if (!region) return
    const publish = () => {
      document.documentElement.style.setProperty('--map-top', `${Math.round(region.getBoundingClientRect().top)}px`)
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(document.documentElement)
    return () => observer.disconnect()
  }, [])

  const selectPlant = useCallback((plantId: string | null) => {
    setSelectedPlantId(plantId)
    if (!plantId) return
    const plant = PLANT_DATA.get(plantId)
    const map = mapRef.current
    if (!plant || !map) return
    map.easeTo({ center: plant.coordinates, zoom: Math.max(map.getZoom(), 6), duration: 700 })
  }, [])

  useEffect(() => {
    const container = mapContainerRef.current
    if (!MAPBOX_TOKEN || !container) return

    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container,
      style: MAP_STYLES[themeRef.current],
      bounds: CONUS_BOUNDS,
      fitBoundsOptions: { padding: MAP_PADDING },
      minZoom: 3,
      maxZoom: 11,
      attributionControl: false,
    })
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')
    mapRef.current = map

    map.on('style.load', () => {
      addMapOverlays(map, themeRef.current, selectedPlantIdRef.current)
    })

    const clearHover = () => setHoveredPlantId(null)

    map.on('mousemove', 'plants-points', (event) => {
      const plantId = event.features?.[0]?.properties?.id as string | undefined
      if (!plantId) return
      setHoveredPlantId(plantId)
      hoverPointRef.current = { x: event.originalEvent.clientX, y: event.originalEvent.clientY }
      if (hoverFrameRef.current !== null) return
      hoverFrameRef.current = requestAnimationFrame(() => {
        hoverFrameRef.current = null
        positionHoverCard(hoverCardRef.current, hoverPointRef.current)
      })
    })
    map.on('mouseleave', 'plants-points', clearHover)
    map.on('dragstart', clearHover)

    map.on('click', 'clusters', (event) => {
      const clusterFeature = event.features?.[0]
      const clusterId = clusterFeature?.properties?.cluster_id as number | undefined
      if (!clusterFeature || clusterId === undefined) return
      const source = map.getSource('plants') as GeoJSONSource
      source.getClusterExpansionZoom(clusterId, (error, zoom) => {
        if (error || zoom == null) return
        map.easeTo({ center: (clusterFeature.geometry as Point).coordinates as [number, number], zoom: zoom + .1 })
      })
    })
    map.on('click', 'plants-points', (event) => {
      const plantId = event.features?.[0]?.properties?.id as string | undefined
      if (!plantId) return
      clearHover()
      setSelectedPlantId(plantId)
    })
    for (const layerId of ['clusters', 'plants-points']) {
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = '' })
    }

    return () => {
      if (hoverFrameRef.current !== null) {
        cancelAnimationFrame(hoverFrameRef.current)
        hoverFrameRef.current = null
      }
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    themeRef.current = theme
    const map = mapRef.current
    if (!map || appliedThemeRef.current === theme) return
    appliedThemeRef.current = theme
    setHoveredPlantId(null)
    map.setStyle(MAP_STYLES[theme])
  }, [theme])

  useEffect(() => {
    selectedPlantIdRef.current = selectedPlantId
    const map = mapRef.current
    if (!map?.getLayer('plants-selected')) return
    map.setFilter('plants-selected', selectedPlantFilter(selectedPlantId))
  }, [selectedPlantId])

  return (
    <main className="fixed inset-0 flex min-w-80 flex-col overflow-clip bg-background font-sans text-foreground antialiased selection:bg-accent/25">
      <TopNav theme={theme} onThemeToggle={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))} />
      <StatStrip />

      <div className="flex min-h-0 flex-1">
        <div ref={mapRegionRef} className="relative isolate min-w-0 flex-1 overflow-clip bg-background">
          {/* size-full is load-bearing: mapbox's own CSS overrides `absolute`, collapsing an inset-sized box */}
          <div
            ref={mapContainerRef}
            className="absolute inset-0 size-full"
            role="application"
            aria-label="United States electricity map with clustered power plant markers"
          />

          {!MAPBOX_TOKEN && (
            <div className="absolute inset-0 z-10 grid place-items-center p-4">
              <Card className={`w-[420px] max-w-full gap-0 p-5 ${PANEL_CLASS}`}>
                <Card.Header className="p-0">
                  <Card.Title className="text-[15px] leading-6 font-semibold">Connect Mapbox</Card.Title>
                  <Card.Description className="text-[13px] leading-5">A Mapbox access token is needed to render the map.</Card.Description>
                </Card.Header>
                <Card.Content className="mt-4 gap-2.5 p-0 text-[12px] text-muted">
                  <p>1. Create a token at <Link href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noreferrer" className="text-accent">account.mapbox.com</Link></p>
                  <p>2. Add it to <code className="rounded-md bg-default px-1.5 py-0.5 text-[11px] text-foreground">client/.env.local</code>:</p>
                  <code className="block rounded-lg border border-border bg-default px-3 py-2 text-[11px] text-foreground">VITE_MAPBOX_TOKEN=pk.your-token-here</code>
                  <p>3. Restart the dev server.</p>
                </Card.Content>
              </Card>
            </div>
          )}

          <div className="absolute top-3 right-3 z-10 flex flex-col gap-2">
            <IconControl label="Map layers"><Layers3 size={15} /></IconControl>
            <ButtonGroup
              orientation="vertical"
              size="sm"
              variant="ghost"
              className="overflow-hidden rounded-lg border border-border bg-surface shadow-surface"
            >
              <Button isIconOnly className="h-8 min-h-8 w-8 min-w-8 rounded-none text-muted hover:text-foreground" aria-label="Zoom in" onPress={() => mapRef.current?.zoomIn()}>
                <Plus size={15} />
              </Button>
              <Button isIconOnly className="h-8 min-h-8 w-8 min-w-8 rounded-none text-muted hover:text-foreground" aria-label="Zoom out" onPress={() => mapRef.current?.zoomOut()}>
                <ButtonGroup.Separator />
                <Minus size={15} />
              </Button>
            </ButtonGroup>
            <IconControl
              label="Fit the map to the country"
              onPress={() => mapRef.current?.fitBounds(CONUS_BOUNDS, { padding: MAP_PADDING })}
            >
              <LocateFixed size={15} />
            </IconControl>
          </div>

          <MixPanel plants={PLANTS} />

          {hoveredPlant && !selectedPlant && <HoverCard datum={hoveredPlant} tooltipRef={hoverCardRef} />}
          {selectedPlant && <PlantPanel datum={selectedPlant} onClose={() => setSelectedPlantId(null)} />}
        </div>

        <PlantList plants={PLANTS} selectedPlantId={selectedPlantId} onSelect={selectPlant} />
      </div>
    </main>
  )
}

export default App
