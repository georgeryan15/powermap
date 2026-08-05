import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  Button,
  ButtonGroup,
  Card,
  Chip,
  Drawer,
  Kbd,
  Link,
  ScrollShadow,
  Separator,
  Surface,
  Tabs,
  Tooltip,
  useOverlayState,
} from '@heroui/react'
import {
  ChevronDown,
  Info,
  Layers3,
  LocateFixed,
  Minus,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  Zap,
} from 'lucide-react'
import mapboxgl from 'mapbox-gl'
import type { ExpressionSpecification, GeoJSONSource } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { feature } from 'topojson-client'
import type { FeatureCollection, Geometry, Point } from 'geojson'
import statesAtlas from 'us-atlas/states-10m.json'

type HoverPoint = { x: number; y: number }
type Theme = 'light' | 'dark'
type FuelType = 'Solar' | 'Wind' | 'Hydro' | 'Nuclear' | 'Natural gas' | 'Battery'

type PlantDatum = {
  id: string
  name: string
  operator: string
  fuel: FuelType
  coordinates: [number, number]
  capacityMW: number
  outputMW: number
  utilization: number
  emissions: number
  commissioned: number
  units: number
  status: 'Online' | 'Reduced output' | 'Standby'
}

const THEME_STORAGE_KEY = 'powermap-theme'
const CONTROL_BUTTON_CLASS = 'h-9 min-h-9 w-9 min-w-9 rounded-[10px] border border-border bg-surface/80 text-foreground shadow-surface material hover:bg-surface-hover'
const FLOATING_PANEL_CLASS = 'rounded-2xl border border-border bg-surface/80 shadow-surface material'
const SECTION_LABEL_CLASS = 'text-[10px] leading-4 font-semibold tracking-[0.05em] uppercase text-muted'
const TITLE_CLASS = 'overflow-hidden text-ellipsis whitespace-nowrap font-semibold'
const VALUE_CLASS = 'text-[16px] leading-tight font-semibold tabular-nums'

const GENERATION_SOURCES = [
  { name: 'Solar', color: '#d9be6c' },
  { name: 'Wind', color: '#84b8a5' },
  { name: 'Hydro', color: '#89aecd' },
  { name: 'Nuclear', color: '#ab9fd1' },
  { name: 'Fossil', color: '#c39a84' },
] as const

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
const PLANT_COLORS: Record<FuelType, string> = {
  Solar: '#d9be6c',
  Wind: '#84b8a5',
  Hydro: '#89aecd',
  Nuclear: '#ab9fd1',
  'Natural gas': '#c39a84',
  Battery: '#8bbcc6',
}

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

function buildDemoPlants(): PlantDatum[] {
  const random = seededRandom(8602026)
  return PLANT_HUBS.flatMap((hub, hubIndex) => {
    const count = 3 + (hubIndex % 3)
    return Array.from({ length: count }, (_, index) => {
      const fuel = PLANT_FUELS[(hubIndex * 2 + index) % PLANT_FUELS.length]
      const capacityMW = Math.round(180 + random() * (fuel === 'Nuclear' ? 2100 : 1250))
      const utilization = Math.round(32 + random() * 64)
      const statusRoll = random()
      const status: PlantDatum['status'] = statusRoll > .91 ? 'Standby' : statusRoll > .79 ? 'Reduced output' : 'Online'
      return {
        id: `plant-${hubIndex}-${index}`,
        name: `${PLANT_PREFIXES[(hubIndex * 3 + index * 2) % PLANT_PREFIXES.length]} ${PLANT_SUFFIXES[fuel]}`,
        operator: `${hub.place} Power Co.`,
        fuel,
        coordinates: [
          hub.coordinates[0] + (random() - .5) * 4.6,
          hub.coordinates[1] + (random() - .5) * 3.1,
        ],
        capacityMW,
        outputMW: Math.round(capacityMW * utilization / 100),
        utilization,
        emissions: fuel === 'Natural gas' ? Math.round(320 + random() * 170) : fuel === 'Battery' ? 8 : Math.round(random() * 18),
        commissioned: 1968 + Math.floor(random() * 56),
        units: 1 + Math.floor(random() * 5),
        status,
      }
    })
  })
}

const PLANTS = buildDemoPlants()

const HOVER_CARD_WIDTH = 360
const HOVER_CARD_EDGE_GAP = 16
const HOVER_CARD_BOTTOM_GAP = 360

function intensityColor(value: number) {
  if (value < 100) return '#6fae87'
  if (value < 180) return '#8db47e'
  if (value < 260) return '#b0b46f'
  if (value < 360) return '#c7a862'
  if (value < 480) return '#c58f58'
  if (value < 600) return '#b9714f'
  return '#a05547'
}

function utilizationLevel(value: number) {
  return value > 66 ? 2 : value > 33 ? 1 : 0
}

function emissionsLevel(value: number) {
  return value > 350 ? 2 : value > 100 ? 1 : 0
}

// ---------------------------------------------------------------------------
// Mapbox setup
// ---------------------------------------------------------------------------

const MAPBOX_TOKEN: string | undefined = import.meta.env.VITE_MAPBOX_TOKEN

const CONUS_BOUNDS: [[number, number], [number, number]] = [[-125.5, 24.2], [-66.4, 49.8]]
const MAP_PADDING = { top: 96, right: 60, bottom: 150, left: 60 }
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

const PLANT_DATA = new Map<string, PlantDatum>(PLANTS.map((plant) => [plant.id, plant]))

const PLANTS_GEOJSON: FeatureCollection<Point, { id: string; fuel: FuelType }> = {
  type: 'FeatureCollection',
  features: PLANTS.map((plant) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: plant.coordinates },
    properties: { id: plant.id, fuel: plant.fuel },
  })),
}

const FUEL_COLOR_EXPRESSION = [
  'match', ['get', 'fuel'],
  ...Object.entries(PLANT_COLORS).flat(),
  '#9ca3af',
] as unknown as ExpressionSpecification

function selectedPlantFilter(plantId: string | null): ExpressionSpecification {
  return ['all', ['!', ['has', 'point_count']], ['==', ['get', 'id'], plantId ?? '']] as unknown as ExpressionSpecification
}

function addMapOverlays(map: mapboxgl.Map, isDark: boolean, selectedPlantId: string | null) {
  if (map.getSource('states')) return
  const firstSymbolLayer = map.getStyle()?.layers.find((layer) => layer.type === 'symbol')?.id

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
      'fill-color': isDark ? '#1c1c1e' : '#ffffff',
      'fill-opacity': .55,
    },
  }, firstSymbolLayer)
  map.addLayer({
    id: 'states-border',
    type: 'line',
    source: 'states',
    paint: {
      'line-color': isDark ? 'rgba(255,255,255,.14)' : 'rgba(60,60,67,.16)',
      'line-width': 1,
    },
  }, firstSymbolLayer)

  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'plants',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': isDark ? '#f5f5f7' : '#1c1c1e',
      'circle-radius': 14,
      'circle-stroke-width': 1,
      'circle-stroke-color': isDark ? 'rgba(0,0,0,.25)' : 'rgba(255,255,255,.25)',
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
    paint: { 'text-color': isDark ? '#1c1c1e' : '#f5f5f7' },
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
      'circle-stroke-color': FUEL_COLOR_EXPRESSION,
      'circle-stroke-opacity': .8,
    },
  })
  map.addLayer({
    id: 'plants-points',
    type: 'circle',
    source: 'plants',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': FUEL_COLOR_EXPRESSION,
      'circle-radius': 7,
      'circle-stroke-width': 2,
      'circle-stroke-color': isDark ? '#000000' : '#ffffff',
    },
  })
}

function IconControl({ children, label, onPress }: { children: ReactNode; label: string; onPress?: () => void }) {
  return (
    <Tooltip delay={250}>
      <Button isIconOnly size="sm" variant="secondary" className={CONTROL_BUTTON_CLASS} aria-label={label} onPress={onPress}>
        {children}
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  )
}

/** Apple's three-bar rating meter, as used on Maps place cards. */
function LevelMeter({ level, label }: { level: number; label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-2" aria-label={`${label}: ${METER_LEVELS[level]}`}>
      <span className="flex items-center gap-[3px]" aria-hidden="true">
        {[0, 1, 2].map((segment) => (
          <i key={segment} className={`h-[7px] w-[11px] rounded-[2px] ${segment <= level ? 'bg-foreground' : 'bg-default'}`} />
        ))}
      </span>
      <span className="text-[10px] leading-4 font-semibold tracking-[0.04em] uppercase">{METER_LEVELS[level]}</span>
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

/** Grey label above a heavier value — the label/value pair used all over iOS. */
function Metric({ label, value, unit }: { label: string; value: ReactNode; unit?: string }) {
  return (
    <div className="min-w-0">
      <p className="overflow-hidden text-[12px] leading-4 text-ellipsis whitespace-nowrap text-muted">{label}</p>
      <p className={`mt-1 flex items-baseline gap-1 ${VALUE_CLASS}`}>
        {value}
        {unit && <span className="text-[11px] font-normal text-muted">{unit}</span>}
      </p>
    </div>
  )
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-[22px] items-center justify-between gap-3">
      <h3 className={SECTION_LABEL_CLASS}>{children}</h3>
      {action}
    </div>
  )
}

/** Inset grouped list: rows split by hairlines that stop short of the edges. */
function DetailRows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="rounded-xl bg-surface-secondary px-3.5">
      {rows.map(({ label, value }, index) => (
        <div className={`flex items-center justify-between gap-4 py-2.5 text-[14px] leading-5 ${index > 0 ? 'border-t border-separator' : ''}`} key={label}>
          <span className="shrink-0 text-muted">{label}</span>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium">{value}</span>
        </div>
      ))}
    </div>
  )
}

function positionHoverCard(element: HTMLDivElement | null, point: HoverPoint) {
  if (!element) return

  const left = Math.max(
    HOVER_CARD_EDGE_GAP,
    Math.min(point.x + 22, window.innerWidth - HOVER_CARD_WIDTH - 22),
  )
  const top = Math.max(90, Math.min(point.y - 112, window.innerHeight - HOVER_CARD_BOTTOM_GAP))

  element.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
}

function HoverCard({ datum, tooltipRef }: { datum: PlantDatum; tooltipRef: RefObject<HTMLDivElement | null> }) {
  const plantColor = PLANT_COLORS[datum.fuel]
  return (
    <div ref={tooltipRef} className="pointer-events-none fixed top-0 left-0 z-30 will-change-transform" role="tooltip">
      <Card className="w-[360px] gap-0 overflow-hidden rounded-2xl border border-border bg-overlay/80 p-0 text-foreground shadow-overlay material max-[400px]:w-[calc(100vw-20px)]">
        <Card.Header className="gap-0 px-4 pt-3.5">
          <Card.Title className={`${TITLE_CLASS} text-[16px] leading-6`}>{datum.name}</Card.Title>
          <Card.Description className="overflow-hidden text-[14px] leading-5 text-ellipsis whitespace-nowrap">{datum.fuel} · {datum.operator}</Card.Description>
        </Card.Header>

        <Card.Content className="gap-0 px-4 pt-4 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] leading-5 font-semibold">Current output</p>
              <p className="mt-0.5 text-[14px] leading-5 text-muted tabular-nums">
                {datum.outputMW.toLocaleString()} MW · {datum.utilization}% of capacity
              </p>
            </div>
            <LevelMeter level={utilizationLevel(datum.utilization)} label="Utilisation" />
          </div>

          <Separator className="my-3.5" />

          <div className="grid grid-cols-3 gap-3">
            <Metric label="Capacity" value={datum.capacityMW.toLocaleString()} unit="MW" />
            <Metric
              label="Carbon"
              value={
                <span className="flex min-w-0 items-center gap-1.5">
                  <i className="size-[7px] shrink-0 rounded-full" style={{ backgroundColor: intensityColor(datum.emissions) }} />
                  {datum.emissions}
                </span>
              }
              unit="g/kWh"
            />
            <Metric label="Status" value={<StatusValue status={datum.status} />} />
          </div>

          <p className={`mt-4 ${SECTION_LABEL_CLASS}`}>Output · last 12 hours</p>
          <div className="mt-2 flex h-[52px] items-end gap-[3px]" aria-hidden="true">
            {[35, 48, 56, 49, 70, 77, 64, 86, 78, 91, 83, 88].map((height, index) => (
              <i key={index} className="min-w-0.5 flex-1 rounded-[2px] opacity-85" style={{ height: `${height}%`, backgroundColor: plantColor }} />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] leading-4 text-muted"><span>12am</span><span>Now</span></div>
        </Card.Content>

        <Card.Footer className="border-t border-separator px-4 py-2.5 text-[11px] leading-4 text-muted">
          Commissioned {datum.commissioned} · Click for full details
        </Card.Footer>
      </Card>
    </div>
  )
}

function TrendChart({ color }: { color: string }) {
  return (
    <svg className="h-[120px] w-full overflow-visible" viewBox="0 0 360 128" preserveAspectRatio="none" aria-label="24 hour power output trend">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[28, 62, 96].map((y) => <line key={y} x1="0" x2="360" y1={y} y2={y} className="stroke-separator" />)}
      <path d="M0 83 C24 78 30 63 54 68 S86 91 111 72 S146 42 170 54 S199 82 227 67 S263 37 286 45 S324 76 360 50 L360 128 L0 128 Z" fill="url(#trendFill)" />
      <path d="M0 83 C24 78 30 63 54 68 S86 91 111 72 S146 42 170 54 S199 82 227 67 S263 37 286 45 S324 76 360 50" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="360" cy="50" r="4" fill={color} className="stroke-overlay" strokeWidth="2" />
    </svg>
  )
}

function PlantPanel({ datum, onClose }: { datum: PlantDatum; onClose: () => void }) {
  const drawerState = useOverlayState({ defaultOpen: true, onOpenChange: (isOpen) => { if (!isOpen) onClose() } })
  const plantColor = PLANT_COLORS[datum.fuel]

  return (
    <Drawer state={drawerState}>
      <Drawer.Backdrop variant="transparent" isDismissable>
        <Drawer.Content
          placement="left"
          className="top-[84px]! right-auto! bottom-4! left-[18px]! h-auto! w-auto! max-[800px]:top-[76px]! max-[800px]:right-2.5! max-[800px]:bottom-2.5! max-[800px]:left-2.5!"
        >
          <Drawer.Dialog
            aria-label={`${datum.name} power plant details`}
            className="h-full! w-[400px]! max-w-[calc(100vw-36px)]! overflow-hidden rounded-2xl! border border-border bg-overlay/85 p-0! shadow-overlay material max-[800px]:w-full! max-[800px]:max-w-none!"
          >
            <Drawer.Header className="mb-0 flex-row items-start justify-between gap-3 border-b border-separator px-4 py-3.5">
              <div className="min-w-0">
                <Drawer.Heading className={`${TITLE_CLASS} text-[18px] leading-6`}>{datum.name}</Drawer.Heading>
                <p className="overflow-hidden text-[14px] leading-5 text-ellipsis whitespace-nowrap text-muted">{datum.fuel} · {datum.operator}</p>
              </div>
              <Drawer.CloseTrigger
                className="static size-7 min-h-7 w-7 min-w-7 shrink-0 rounded-full border-0 bg-default text-muted hover:bg-default-hover"
                aria-label="Close plant details"
              />
            </Drawer.Header>

            <Drawer.Body className="m-0 overflow-hidden p-0">
              <ScrollShadow className="h-full overflow-y-auto px-4 pb-4" hideScrollBar size={32}>
                <Tabs defaultSelectedKey="overview" className="mt-4">
                  <Tabs.List aria-label="Power plant data view" className="grid grid-cols-2">
                    <Tabs.Tab id="overview" className="justify-center">Overview</Tabs.Tab>
                    <Tabs.Tab id="performance" className="justify-center">Performance</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel id="overview" className="mt-5 flex flex-col gap-5 p-0 outline-none">
                    <section className="flex flex-col gap-3">
                      <SectionLabel action={<span className="text-[12px] leading-4"><StatusValue status={datum.status} /></span>}>
                        Current generation
                      </SectionLabel>
                      <div className="grid grid-cols-2 gap-3">
                        <Metric label="Output" value={datum.outputMW.toLocaleString()} unit="MW" />
                        <Metric label="Capacity" value={datum.capacityMW.toLocaleString()} unit="MW" />
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-[12px] leading-4">
                          <span className="text-muted">Current load</span>
                          <span className="font-semibold tabular-nums">{datum.utilization}%</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-default" aria-label={`${datum.utilization}% of plant capacity in use`}>
                          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${datum.utilization}%`, backgroundColor: plantColor }} />
                        </div>
                      </div>
                    </section>

                    <Separator />

                    <section className="flex flex-col gap-2.5">
                      <SectionLabel>Plant details</SectionLabel>
                      <DetailRows
                        rows={[
                          { label: 'Primary fuel', value: datum.fuel },
                          { label: 'Operator', value: datum.operator },
                          { label: 'Generating units', value: String(datum.units) },
                          { label: 'Commissioned', value: String(datum.commissioned) },
                        ]}
                      />
                    </section>
                  </Tabs.Panel>

                  <Tabs.Panel id="performance" className="mt-5 flex flex-col gap-5 p-0 outline-none">
                    <section className="flex flex-col gap-2.5">
                      <SectionLabel
                        action={
                          <Button size="sm" variant="secondary" className="h-6 min-h-6 gap-1 rounded-full border border-border px-2.5 text-[10px] font-medium">
                            Hourly<ChevronDown size={12} />
                          </Button>
                        }
                      >
                        Power output · past 24 hours
                      </SectionLabel>
                      <div>
                        <TrendChart color={plantColor} />
                        <div className="mt-1 flex justify-between text-[10px] leading-4 text-muted"><span>12am</span><span>6am</span><span>12pm</span><span>Now</span></div>
                      </div>
                    </section>

                    <Separator />

                    <section className="flex flex-col gap-3">
                      <SectionLabel>Carbon intensity</SectionLabel>
                      <div className="flex items-end justify-between gap-4">
                        <p className="flex items-baseline gap-1.5">
                          <strong className="text-[32px] leading-none tabular-nums">{datum.emissions}</strong>
                          <span className="text-[12px] text-muted">gCO₂e / kWh</span>
                        </p>
                        <span className="pb-1"><LevelMeter level={emissionsLevel(datum.emissions)} label="Carbon intensity" /></span>
                      </div>
                      <DetailRows
                        rows={[
                          { label: 'Fuel source', value: datum.fuel },
                          { label: 'Daily output', value: `${(datum.outputMW * 24).toLocaleString()} MWh` },
                        ]}
                      />
                    </section>
                  </Tabs.Panel>
                </Tabs>
              </ScrollShadow>
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  )
}

function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [hoveredPlantId, setHoveredPlantId] = useState<string | null>(null)
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null)
  const hoverPointRef = useRef<HoverPoint>({ x: 540, y: 280 })
  const hoverCardRef = useRef<HTMLDivElement>(null)
  const hoverFrameRef = useRef<number | null>(null)
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
      addMapOverlays(map, themeRef.current === 'dark', selectedPlantIdRef.current)
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
    <main className="fixed inset-0 min-w-80 overflow-clip bg-background font-sans text-foreground antialiased selection:bg-accent/25">
      <div className="relative isolate size-full overflow-clip bg-background">
        {/* size-full is load-bearing: mapbox's own CSS overrides `absolute`, collapsing an inset-sized box */}
        <div
          ref={mapContainerRef}
          className="absolute inset-0 size-full"
          role="application"
          aria-label="United States electricity map with clustered power plant markers"
        />
        {!MAPBOX_TOKEN && (
          <div className="absolute inset-0 z-10 grid place-items-center p-4">
            <Card className={`w-[420px] max-w-full gap-0 p-6 ${FLOATING_PANEL_CLASS}`}>
              <Card.Header className="p-0">
                <Card.Title className="text-[16px] leading-6 font-semibold">Connect Mapbox</Card.Title>
                <Card.Description className="text-[14px] leading-5">A Mapbox access token is needed to render the map.</Card.Description>
              </Card.Header>
              <Card.Content className="mt-4 gap-3 p-0 text-[12px] text-muted">
                <p>1. Create a token at <Link href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noreferrer" className="text-accent">account.mapbox.com</Link></p>
                <p>2. Add it to <code className="rounded-md bg-default px-1.5 py-0.5 text-xs text-foreground">client/.env.local</code>:</p>
                <code className="block rounded-xl bg-default px-3 py-2.5 text-xs text-foreground">VITE_MAPBOX_TOKEN=pk.your-token-here</code>
                <p>3. Restart the dev server.</p>
              </Card.Content>
            </Card>
          </div>
        )}

        <Surface className={`absolute top-4 right-[18px] left-[18px] z-20 flex h-14 items-center gap-3 py-2 pr-2.5 pl-3.5 ${FLOATING_PANEL_CLASS} max-[800px]:top-2.5 max-[800px]:right-2.5 max-[800px]:left-2.5`}>
          <Link href="#" className="gap-2 text-[15px] font-semibold whitespace-nowrap hover:no-underline" aria-label="PowerMap home">
            <span className="grid size-[30px] place-items-center rounded-lg bg-foreground text-background"><Zap size={16} fill="currentColor" /></span>
            <span>PowerMap</span>
          </Link>
          <Separator orientation="vertical" className="h-6 max-[800px]:hidden" />
          <Chip color="success" size="sm" variant="soft" className="rounded-full max-[800px]:hidden">
            <span className="size-1.5 rounded-full bg-success" />
            <Chip.Label>Live</Chip.Label>
          </Chip>
          <Button variant="ghost" className="ml-2 h-9 w-[min(310px,28vw)] justify-start gap-2 rounded-[10px] bg-default px-2.5 text-[12px] text-muted max-[800px]:hidden" aria-label="Find a power plant">
            <Search size={15} />
            <span className="flex-1 text-left">Find a power plant</span>
            <Kbd variant="light" className="px-1.5 py-0.5 text-[10px]">⌘ K</Kbd>
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" className="h-9 min-h-9 gap-2 rounded-full border border-border px-3.5 text-[12px] font-medium max-[800px]:w-[38px] max-[800px]:min-w-[38px] max-[800px]:px-0" aria-label="Select map metric">
              <span className="flex items-center gap-0.5" aria-hidden="true">
                {GENERATION_SOURCES.slice(0, 3).map((source) => <i key={source.name} className="size-1.5 rounded-full" style={{ backgroundColor: source.color }} />)}
              </span>
              <span className="max-[800px]:hidden">Primary generation</span>
              <ChevronDown size={14} className="max-[800px]:hidden" />
            </Button>
            <Tooltip delay={250}>
              <Button
                isIconOnly
                size="sm"
                variant="secondary"
                className={CONTROL_BUTTON_CLASS}
                aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
                aria-pressed={!isDark}
                onPress={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
              >
                {isDark ? <Sun size={17} /> : <Moon size={17} />}
              </Button>
              <Tooltip.Content>Switch to {isDark ? 'light' : 'dark'} mode</Tooltip.Content>
            </Tooltip>
            <IconControl label="Map settings"><Settings2 size={17} /></IconControl>
          </div>
        </Surface>

        <div className="absolute top-[86px] right-[18px] z-10 flex flex-col gap-2 max-[800px]:right-2.5">
          <IconControl label="Map layers"><Layers3 size={18} /></IconControl>
          <ButtonGroup orientation="vertical" size="sm" variant="secondary" className="overflow-hidden rounded-[10px] border border-border bg-surface/80 shadow-surface material">
            <Button isIconOnly className="h-9 min-h-9 w-9 min-w-9 rounded-none" aria-label="Zoom in" onPress={() => mapRef.current?.zoomIn()}><Plus size={17} /></Button>
            <Button isIconOnly className="h-9 min-h-9 w-9 min-w-9 rounded-none" aria-label="Zoom out" onPress={() => mapRef.current?.zoomOut()}><ButtonGroup.Separator /><Minus size={17} /></Button>
          </ButtonGroup>
          <IconControl label="Center map" onPress={() => mapRef.current?.fitBounds(CONUS_BOUNDS, { padding: MAP_PADDING })}><LocateFixed size={17} /></IconControl>
        </div>

        <Chip variant="secondary" className="absolute bottom-[94px] left-1/2 z-[8] -translate-x-1/2 rounded-full border border-border bg-surface/80 px-3 py-1.5 text-[11px] text-muted material max-[800px]:hidden">
          <Info size={13} />
          <Chip.Label>Drag to explore · select a pin for plant details</Chip.Label>
        </Chip>

        <Card className={`absolute right-[18px] bottom-4 z-10 w-[330px] gap-0 px-4 py-3 ${FLOATING_PANEL_CLASS} max-[800px]:right-2.5 max-[800px]:bottom-2.5 max-[800px]:w-[156px]`}>
          <Card.Header className="flex-row items-center justify-between">
            <div className="flex flex-1 items-center justify-between">
              <Card.Title className="text-[12px] leading-5 font-semibold">Generation source</Card.Title>
              <span className="text-[10px] text-muted max-[800px]:hidden">Largest share</span>
            </div>
            <Tooltip delay={250}>
              <Button isIconOnly size="sm" variant="ghost" className="ml-1.5 h-6 min-h-6 w-6 min-w-6 text-muted" aria-label="About the generation source key"><Info size={14} /></Button>
              <Tooltip.Content>Plant markers are coloured by their generation source</Tooltip.Content>
            </Tooltip>
          </Card.Header>
          <Card.Content className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 max-[800px]:grid-cols-2">
            {GENERATION_SOURCES.map((source) => (
              <div className="flex min-w-0 items-center gap-1.5" key={source.name}>
                <i className="size-2 shrink-0 rounded-full" style={{ backgroundColor: source.color }} />
                <span className="text-[10px] whitespace-nowrap text-muted">{source.name}</span>
              </div>
            ))}
          </Card.Content>
        </Card>

        {hoveredPlant && !selectedPlant && <HoverCard datum={hoveredPlant} tooltipRef={hoverCardRef} />}
        {selectedPlant && <PlantPanel datum={selectedPlant} onClose={() => setSelectedPlantId(null)} />}
      </div>
    </main>
  )
}

export default App
