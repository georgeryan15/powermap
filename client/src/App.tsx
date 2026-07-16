import { useLayoutEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button,
  ButtonGroup,
  Card,
  Chip,
  Drawer,
  Kbd,
  Link,
  ProgressCircle,
  ScrollShadow,
  Separator,
  Slider,
  Surface,
  Tabs,
  Tooltip,
  useOverlayState,
} from '@heroui/react'
import {
  Activity,
  ArrowLeft,
  BatteryCharging,
  ChevronDown,
  Factory,
  Info,
  Layers3,
  Leaf,
  LocateFixed,
  Minus,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  Wind,
  Zap,
} from 'lucide-react'
import { geoAlbersUsa, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import statesAtlas from 'us-atlas/states-10m.json'

type StateDatum = {
  id: string
  name: string
  abbr: string
  intensity: number
  renewable: number
  clean: number
  output: number
  change: number
  mix: { name: GenerationSourceName; value: number; color: string }[]
}

type HoverPoint = { x: number; y: number }
type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'powermap-theme'
const CONTROL_BUTTON_CLASS = 'h-9 min-h-9 w-9 min-w-9 rounded-xl border border-border bg-surface/80 text-foreground shadow-sm backdrop-blur-lg hover:bg-surface-hover'
const PANEL_CARD_CLASS = 'gap-0 rounded-[17px] bg-surface-secondary/70 p-4 shadow-none'

const GENERATION_SOURCES = [
  { name: 'Solar', color: '#f7d650' },
  { name: 'Wind', color: '#50c7aa' },
  { name: 'Hydro', color: '#64a9ee' },
  { name: 'Nuclear', color: '#a890f8' },
  { name: 'Fossil', color: '#e28154' },
] as const

type GenerationSourceName = (typeof GENERATION_SOURCES)[number]['name']

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

const STATE_OVERRIDES: Record<string, Partial<StateDatum>> = {
  California: { intensity: 148, renewable: 56, clean: 76, output: 33.2, change: -8 },
  Texas: { intensity: 382, renewable: 35, clean: 48, output: 54.7, change: 3 },
  Washington: { intensity: 92, renewable: 81, clean: 89, output: 12.8, change: -11 },
  Wyoming: { intensity: 694, renewable: 18, clean: 21, output: 5.4, change: 7 },
  'West Virginia': { intensity: 738, renewable: 7, clean: 9, output: 8.1, change: 4 },
  Vermont: { intensity: 42, renewable: 99, clean: 100, output: 0.7, change: -2 },
  Idaho: { intensity: 176, renewable: 72, clean: 81, output: 3.8, change: -9 },
  Florida: { intensity: 497, renewable: 8, clean: 22, output: 28.5, change: 5 },
  'New York': { intensity: 203, renewable: 29, clean: 63, output: 17.4, change: -4 },
}

const PLANTS = [
  { name: 'Diablo Canyon', coordinates: [-120.86, 35.21], capacity: 2.2 },
  { name: 'Grand Coulee', coordinates: [-118.98, 47.96], capacity: 6.8 },
  { name: 'Palo Verde', coordinates: [-112.86, 33.39], capacity: 3.9 },
  { name: 'Comanche Peak', coordinates: [-97.79, 32.3], capacity: 2.4 },
  { name: 'South Texas Project', coordinates: [-96.05, 28.8], capacity: 2.7 },
  { name: 'Wolf Creek', coordinates: [-95.69, 38.24], capacity: 1.2 },
  { name: 'Byron', coordinates: [-89.06, 42.07], capacity: 2.3 },
  { name: 'Vogtle', coordinates: [-81.76, 33.14], capacity: 4.5 },
  { name: 'Oconee', coordinates: [-82.9, 34.79], capacity: 2.6 },
  { name: 'Susquehanna', coordinates: [-76.15, 41.09], capacity: 2.5 },
  { name: 'Seabrook', coordinates: [-70.85, 42.9], capacity: 1.25 },
  { name: 'Bankhead', coordinates: [-87.36, 33.46], capacity: 0.5 },
] as const

const MAP_WIDTH = 1100
const MAP_HEIGHT = 680

function hashName(name: string) {
  return [...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0)
}

function buildGenerationMix(seed: number): StateDatum['mix'] {
  const primaryIndex = seed % GENERATION_SOURCES.length
  const primaryShare = 42 + (seed % 9)
  const remaining = 100 - primaryShare
  const secondaryShares = [
    Math.floor(remaining * .34),
    Math.floor(remaining * .27),
    Math.floor(remaining * .22),
  ]
  secondaryShares.push(remaining - secondaryShares.reduce((sum, value) => sum + value, 0))

  let secondaryIndex = 0
  return GENERATION_SOURCES.map((source, index) => ({
    ...source,
    value: index === primaryIndex ? primaryShare : secondaryShares[secondaryIndex++],
  }))
}

function dominantGeneration(datum: StateDatum) {
  return datum.mix.reduce((dominant, source) => source.value > dominant.value ? source : dominant)
}

function buildStateDatum(id: string, name: string): StateDatum {
  const seed = hashName(name)
  const intensity = 90 + (seed * 17) % 610
  const mix = buildGenerationMix(seed)
  const renewable = mix.filter((source) => source.name === 'Solar' || source.name === 'Wind' || source.name === 'Hydro').reduce((sum, source) => sum + source.value, 0)
  const nuclear = mix.find((source) => source.name === 'Nuclear')?.value ?? 0
  const clean = renewable + nuclear

  const base: StateDatum = {
    id,
    name,
    abbr: STATE_ABBREVIATIONS[name] ?? name.slice(0, 2).toUpperCase(),
    intensity,
    renewable,
    clean,
    output: Number((2.4 + ((seed * 13) % 290) / 10).toFixed(1)),
    change: (seed % 19) - 9,
    mix,
  }

  return { ...base, ...STATE_OVERRIDES[name] }
}

function intensityColor(value: number) {
  if (value < 100) return '#50c98d'
  if (value < 180) return '#82d18e'
  if (value < 260) return '#bedc63'
  if (value < 360) return '#efd458'
  if (value < 480) return '#e7a84b'
  if (value < 600) return '#cf7445'
  return '#a84537'
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

function RingStat({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <Card variant="secondary" className="relative h-32 min-w-0 items-center justify-center gap-0 rounded-[15px] p-0 shadow-none">
      <ProgressCircle value={value} aria-label={`${label}: ${value}%`} className="relative size-[82px]">
        <ProgressCircle.Track className="size-[72px]!">
          <ProgressCircle.TrackCircle className="stroke-default" />
          <ProgressCircle.FillCircle style={{ stroke: color }} />
        </ProgressCircle.Track>
        <span className="absolute text-[19px] font-bold text-foreground">{value}%</span>
      </ProgressCircle>
      <p className="absolute top-[calc(100%+8px)] text-[11px] font-medium whitespace-nowrap text-muted">{label}</p>
    </Card>
  )
}

function HoverCard({ datum, point }: { datum: StateDatum; point: HoverPoint }) {
  const left = Math.max(16, Math.min(point.x + 22, window.innerWidth - 452))
  const top = Math.max(90, Math.min(point.y - 112, window.innerHeight - 306))

  return (
    <Card
      className="pointer-events-none fixed z-30 w-[430px] gap-0 overflow-hidden rounded-[19px] bg-overlay/95 p-0 text-foreground shadow-overlay max-[470px]:w-[calc(100vw-20px)]"
      style={{ left, top }}
      role="tooltip"
    >
      <Card.Header className="flex-row justify-between gap-2.5 px-[18px] pt-[17px]">
        <div>
          <Card.Title className="flex items-center gap-2 text-lg leading-tight font-semibold">
            <span className="text-[17px]">🇺🇸</span>{datum.name}
          </Card.Title>
          <Card.Description className="mt-1 text-xs">16 Jul 2026, 15:30 EDT</Card.Description>
        </div>
        <Chip color="success" size="sm" variant="soft" className="shrink-0">
          <Activity size={13} />
          <Chip.Label>Live estimate</Chip.Label>
        </Chip>
      </Card.Header>
      <Card.Content className="mt-[17px] grid grid-cols-[1fr_.82fr_1.28fr] gap-2.5 px-[18px]">
        <div className="relative flex h-32 min-w-0 flex-col items-center justify-center rounded-[15px] text-[#10191a] shadow-[inset_0_1px_0_rgba(255,255,255,.3)]" style={{ backgroundColor: intensityColor(datum.intensity) }}>
          <strong className="text-3xl leading-none">{datum.intensity}</strong>
          <span className="mt-1 text-[11px] font-bold">gCO₂e/kWh</span>
          <p className="absolute top-[calc(100%+8px)] text-[11px] font-medium whitespace-nowrap text-muted">Carbon intensity</p>
        </div>
        <RingStat value={datum.renewable} color="#55c5a5" label="Renewable" />
        <Card variant="secondary" className="relative h-32 min-w-0 gap-0 rounded-[15px] p-3.5 shadow-none">
          <div className="flex items-baseline gap-1"><strong className="text-2xl">{datum.output}</strong><span className="text-[11px] text-muted">GW</span></div>
          <div className="mt-2 flex h-[54px] items-end gap-[3px]" aria-hidden="true">
            {[35, 48, 56, 49, 70, 77, 64, 86, 78, 91, 83, 88].map((height, index) => (
              <i key={index} className="min-w-0.5 flex-1 rounded-t-sm bg-gradient-to-b from-[#65ceb0] to-[#459d87] opacity-90" style={{ height: `${height}%` }} />
            ))}
          </div>
          <p className="absolute top-[calc(100%+8px)] text-[11px] font-medium whitespace-nowrap text-muted">Power generated</p>
        </Card>
      </Card.Content>
      <Card.Footer className="mt-[30px] border-t border-separator bg-background-secondary px-[18px] py-2.5 text-[11px] text-muted">
        Click to explore {datum.abbr} generation
      </Card.Footer>
    </Card>
  )
}

function TrendChart({ color }: { color: string }) {
  return (
    <svg className="mt-2 h-[120px] w-full overflow-visible" viewBox="0 0 360 128" preserveAspectRatio="none" aria-label="24 hour carbon intensity trend">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".3" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[28, 62, 96].map((y) => <line key={y} x1="0" x2="360" y1={y} y2={y} className="stroke-separator [stroke-dasharray:3_4]" />)}
      <path d="M0 83 C24 78 30 63 54 68 S86 91 111 72 S146 42 170 54 S199 82 227 67 S263 37 286 45 S324 76 360 50 L360 128 L0 128 Z" fill="url(#trendFill)" />
      <path d="M0 83 C24 78 30 63 54 68 S86 91 111 72 S146 42 170 54 S199 82 227 67 S263 37 286 45 S324 76 360 50" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <circle cx="360" cy="50" r="5" fill={color} className="stroke-overlay" strokeWidth="3" />
    </svg>
  )
}

function SectionHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <Card.Header className="flex-row items-start justify-between gap-3">
      <div>
        <Card.Title className="text-[15px] leading-tight font-semibold">{title}</Card.Title>
        <Card.Description className="mt-1 text-[11px] leading-tight">{description}</Card.Description>
      </div>
      {action}
    </Card.Header>
  )
}

function StatePanel({ datum, onClose }: { datum: StateDatum; onClose: () => void }) {
  const drawerState = useOverlayState({ defaultOpen: true, onOpenChange: (isOpen) => { if (!isOpen) onClose() } })
  const carbonColor = intensityColor(datum.intensity)
  const plants = [
    { name: `${datum.name} Energy Center`, type: 'Natural gas', cap: '1.8 GW', icon: Factory, color: '#e28154' },
    { name: `${datum.name} Wind Project`, type: 'Wind', cap: '940 MW', icon: Wind, color: '#50c7aa' },
    { name: 'Sunrise Solar Farm', type: 'Solar', cap: '610 MW', icon: Sun, color: '#f7d650' },
  ]

  return (
    <Drawer state={drawerState}>
      <Drawer.Backdrop variant="transparent" isDismissable>
        <Drawer.Content
          placement="left"
          className="top-[84px]! right-auto! bottom-4! left-[18px]! h-auto! w-auto! max-[800px]:top-[76px]! max-[800px]:right-2.5! max-[800px]:bottom-2.5! max-[800px]:left-2.5!"
        >
          <Drawer.Dialog
            aria-label={`${datum.name} electricity details`}
            className="h-full! w-[418px]! max-w-[calc(100vw-36px)]! overflow-hidden rounded-[23px]! bg-overlay/95 p-0! shadow-overlay max-[800px]:w-full! max-[800px]:max-w-none!"
          >
            <Drawer.Header className="mb-0 flex-row items-center gap-2.5 px-[17px] pt-[17px]">
              <Button isIconOnly size="sm" variant="ghost" className="h-[34px] min-h-[34px] w-[34px] min-w-[34px] rounded-[9px]" onPress={drawerState.close} aria-label="Close state details">
                <ArrowLeft size={20} />
              </Button>
              <div className="flex min-w-0 flex-1 items-center gap-[11px]">
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#74cfb4] text-xs font-extrabold text-[#101918]">{datum.abbr}</span>
                <div className="min-w-0">
                  <Drawer.Heading className="overflow-hidden text-ellipsis whitespace-nowrap text-[19px] leading-tight font-semibold">{datum.name}</Drawer.Heading>
                  <p className="mt-0.5 text-[11px] text-muted">United States · Live grid</p>
                </div>
              </div>
              <Drawer.CloseTrigger className="static h-[34px] min-h-[34px] w-[34px] min-w-[34px] rounded-[9px]" aria-label="Close" />
            </Drawer.Header>

            <Drawer.Body className="m-0 overflow-hidden p-0">
              <ScrollShadow className="h-full overflow-y-auto px-[17px] pb-[17px]" hideScrollBar size={32}>
                <Tabs defaultSelectedKey="electricity" className="mt-[15px]">
                  <Tabs.List aria-label="State data view" className="grid h-[42px] grid-cols-2 rounded-[12px] border border-border bg-background-secondary p-1">
                    <Tabs.Tab id="electricity" className="justify-center rounded-[8px] text-xs font-semibold">Electricity</Tabs.Tab>
                    <Tabs.Tab id="emissions" className="justify-center rounded-[8px] text-xs font-semibold">Emissions</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel id="electricity" className="mt-4 flex flex-col gap-3 outline-none">
                    <Card className={PANEL_CARD_CLASS}>
                      <SectionHeading
                        title="Current electricity mix"
                        description="Updated 4 minutes ago"
                        action={<Chip color="success" size="sm" variant="soft"><Chip.Label>Live</Chip.Label></Chip>}
                      />
                      <Card.Content className="gap-0">
                        <div className="mt-4 flex items-center gap-[15px]">
                          <div className="grid h-24 w-[108px] shrink-0 grid-cols-[auto_auto] content-center justify-center gap-x-1 rounded-[15px] text-[#101817] shadow-[inset_0_1px_0_rgba(255,255,255,.32)]" style={{ backgroundColor: carbonColor }}>
                            <Zap size={17} className="self-center" />
                            <strong className="text-3xl leading-none">{datum.intensity}</strong>
                            <span className="col-span-2 mt-1 text-center text-[11px] font-bold">gCO₂e/kWh</span>
                          </div>
                          <div className="flex flex-col">
                            <p className="mb-[7px] text-xs text-muted">Carbon intensity</p>
                            <strong className="text-xl text-[#249777] dark:text-[#55c5a5]">{datum.change <= 0 ? '↓' : '↑'} {Math.abs(datum.change)}%</strong>
                            <span className="mt-1 text-[10px] text-muted">from yesterday at this time</span>
                          </div>
                        </div>
                        <div className="my-[13px] mt-[18px] flex h-[9px] gap-0.5 overflow-hidden rounded-full" aria-label="Generation source mix">
                          {datum.mix.map((source) => <i key={source.name} className="block min-w-1" style={{ width: `${source.value}%`, backgroundColor: source.color }} />)}
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                          {datum.mix.map((source) => (
                            <div className="grid grid-cols-[7px_1fr_auto] items-center gap-[7px] text-[10px]" key={source.name}>
                              <i className="size-[7px] rounded-[3px]" style={{ backgroundColor: source.color }} />
                              <span className="text-muted">{source.name}</span>
                              <strong className="font-semibold text-foreground">{source.value}%</strong>
                            </div>
                          ))}
                        </div>
                      </Card.Content>
                    </Card>

                    <div className="grid grid-cols-3 gap-[7px]">
                      {[
                        { icon: Leaf, value: `${datum.renewable}%`, label: 'Renewable' },
                        { icon: BatteryCharging, value: `${datum.clean}%`, label: 'Carbon-free' },
                        { icon: Activity, value: `${datum.output} GW`, label: 'Generated' },
                      ].map(({ icon: Icon, value, label }) => (
                        <Card variant="secondary" className="min-w-0 flex-row items-center gap-[7px] rounded-[11px] p-2.5 shadow-none" key={label}>
                          <Icon size={18} className="shrink-0 text-[#249777] dark:text-[#55c5a5]" />
                          <div className="min-w-0">
                            <strong className="block text-xs whitespace-nowrap">{value}</strong>
                            <span className="mt-0.5 block overflow-hidden text-[9px] text-ellipsis text-muted">{label}</span>
                          </div>
                        </Card>
                      ))}
                    </div>

                    <Card className={PANEL_CARD_CLASS}>
                      <SectionHeading title="Largest power plants" description="By operating capacity" action={<span className="text-[10px] text-muted">12 total</span>} />
                      <Card.Content className="mt-[11px] gap-1">
                        {plants.map(({ name, type, cap, icon: Icon, color }) => (
                          <Button fullWidth variant="ghost" className="grid h-auto min-h-0 grid-cols-[34px_1fr_auto] items-center gap-2 rounded-xl p-2 text-left" key={name}>
                            <span className="grid size-[34px] place-items-center rounded-[9px] bg-default" style={{ color }}><Icon size={18} /></span>
                            <span className="min-w-0">
                              <strong className="block overflow-hidden text-[11px] font-semibold text-ellipsis whitespace-nowrap">{name}</strong>
                              <small className="mt-0.5 block text-[9px] text-muted">{type}</small>
                            </span>
                            <span className="text-[10px] text-muted">{cap}</span>
                          </Button>
                        ))}
                      </Card.Content>
                    </Card>
                  </Tabs.Panel>

                  <Tabs.Panel id="emissions" className="mt-4 flex flex-col gap-3 outline-none">
                    <Card className={PANEL_CARD_CLASS}>
                      <SectionHeading
                        title="Carbon intensity"
                        description="Past 24 hours"
                        action={<Button size="sm" variant="secondary" className="h-7 min-h-7 rounded-lg px-2 text-[10px]"><Settings2 size={14} />Hourly</Button>}
                      />
                      <Card.Content className="gap-0">
                        <TrendChart color={carbonColor} />
                        <div className="-mt-1 flex justify-between text-[10px] text-muted"><span>12am</span><span>6am</span><span>12pm</span><span>Now</span></div>
                      </Card.Content>
                    </Card>
                    <Card className={PANEL_CARD_CLASS}>
                      <SectionHeading title="Daily movement" description="Compared with this time yesterday" />
                      <Card.Content className="mt-4 flex-row items-end justify-between gap-4">
                        <div>
                          <strong className="text-3xl" style={{ color: carbonColor }}>{datum.intensity}</strong>
                          <p className="mt-1 text-[11px] text-muted">gCO₂e per kWh</p>
                        </div>
                        <Chip color={datum.change <= 0 ? 'success' : 'warning'} variant="soft">
                          <Chip.Label>{datum.change <= 0 ? '↓' : '↑'} {Math.abs(datum.change)}%</Chip.Label>
                        </Chip>
                      </Card.Content>
                    </Card>
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
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hoverPoint, setHoverPoint] = useState<HoverPoint>({ x: 540, y: 280 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  const { stateFeatures, projection, path, dataById } = useMemo(() => {
    const collection = feature(
      statesAtlas as never,
      statesAtlas.objects.states as never,
    ) as unknown as FeatureCollection<Geometry, { name: string }>
    const projection = geoAlbersUsa().scale(1420).translate([MAP_WIDTH / 2, MAP_HEIGHT / 2 + 4])
    const path = geoPath(projection)
    const stateFeatures = collection.features.filter((state) => Boolean(STATE_ABBREVIATIONS[state.properties.name]))
    const dataById = new Map<string, StateDatum>()
    stateFeatures.forEach((state) => {
      const id = String(state.id).padStart(2, '0')
      dataById.set(id, buildStateDatum(id, state.properties.name))
    })
    return { stateFeatures, projection, path, dataById }
  }, [])

  const hovered = hoveredId ? dataById.get(hoveredId) : undefined
  const selected = selectedId ? dataById.get(selectedId) : undefined
  const isDark = theme === 'dark'

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.classList.toggle('dark', isDark)
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [isDark, theme])

  const updatePointer = (event: React.MouseEvent<SVGPathElement>) => {
    setHoverPoint({ x: event.clientX, y: event.clientY })
  }

  return (
    <main className="fixed inset-0 min-w-80 overflow-hidden bg-background font-sans text-foreground antialiased selection:bg-success/30">
      <div className={`relative isolate size-full overflow-hidden ${isDark ? 'bg-[radial-gradient(circle_at_54%_42%,#1b2930_0,#10191e_42%,#090f13_100%)]' : 'bg-[radial-gradient(circle_at_54%_42%,#fff_0,#edf3f3_48%,#dfe9ea_100%)]'}`}>
        <div className={`pointer-events-none absolute inset-0 ${isDark ? 'bg-[radial-gradient(ellipse_at_center,rgba(49,75,82,.18),transparent_62%)]' : 'bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,.62),transparent_66%)]'}`} aria-hidden="true" />
        <svg className="absolute top-1/2 left-1/2 h-auto w-[min(112vw,1540px)] -translate-x-1/2 -translate-y-[49%] overflow-visible max-[800px]:top-[48%] max-[800px]:w-[170vw]" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} aria-label="Dominant electricity generation source by state in the United States">
          <defs>
            <filter id="stateGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={isDark ? '#ffffff' : '#132a2e'} floodOpacity=".38" />
            </filter>
            <pattern id="mapGrid" width="34" height="34" patternUnits="userSpaceOnUse">
              <path d="M 34 0 L 0 0 0 34" fill="none" stroke={isDark ? 'rgba(255,255,255,.03)' : 'rgba(27,51,55,.055)'} strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#mapGrid)" />
          <g className="transition-transform duration-300 ease-out motion-reduce:transition-none" style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}>
            {stateFeatures.map((state) => {
              const id = String(state.id).padStart(2, '0')
              const datum = dataById.get(id)
              const primaryGeneration = datum ? dominantGeneration(datum) : undefined
              const d = path(state as Feature<Geometry>) ?? ''
              const isHovered = hoveredId === id
              const isSelected = selectedId === id
              const highlightClass = isDark
                ? 'hover:stroke-white focus-visible:stroke-white'
                : 'hover:stroke-[#132a2e] focus-visible:stroke-[#132a2e]'
              const activeClass = isHovered || isSelected
                ? `${isDark ? 'stroke-white' : 'stroke-[#132a2e]'} ${isSelected ? 'stroke-[3px]' : 'stroke-[2.2px]'}`
                : isDark ? 'stroke-[rgba(13,24,27,.5)] stroke-[1.2px]' : 'stroke-[rgba(255,255,255,.72)] stroke-[1.2px]'
              return (
                <path
                  key={id}
                  d={d}
                  className={`cursor-pointer outline-none [vector-effect:non-scaling-stroke] transition-[opacity,stroke,stroke-width] duration-150 ${highlightClass} ${activeClass}`}
                  style={isSelected ? { filter: 'url(#stateGlow)' } : undefined}
                  fill={primaryGeneration?.color ?? (isDark ? '#3b444b' : '#aab8ba')}
                  onMouseEnter={() => setHoveredId(id)}
                  onMouseMove={updatePointer}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => setSelectedId(id)}
                  onFocus={() => setHoveredId(id)}
                  onBlur={() => setHoveredId(null)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${datum?.name}: ${primaryGeneration?.name} is the largest generation source at ${primaryGeneration?.value}%`}
                />
              )
            })}
            {stateFeatures.map((state) => {
              const id = String(state.id).padStart(2, '0')
              const datum = dataById.get(id)
              const bounds = path.bounds(state as Feature<Geometry>)
              const width = bounds[1][0] - bounds[0][0]
              if (!datum || width < 19 || datum.abbr === 'AK' || datum.abbr === 'HI') return null
              const [x, y] = path.centroid(state as Feature<Geometry>)
              return <text key={`label-${id}`} x={x} y={y} className="pointer-events-none text-[11px] font-bold tracking-tight" fill={isDark ? 'rgba(11,20,22,.58)' : 'rgba(11,30,31,.68)'} textAnchor="middle" dominantBaseline="central">{datum.abbr}</text>
            })}
            {PLANTS.map((plant) => {
              const point = projection(plant.coordinates as [number, number])
              if (!point) return null
              return (
                <g className="pointer-events-none" key={plant.name} transform={`translate(${point[0]}, ${point[1]})`}>
                  <circle r={5 + plant.capacity / 2} fill={isDark ? 'rgba(255,255,255,.1)' : 'rgba(17,42,45,.1)'} stroke={isDark ? 'rgba(255,255,255,.42)' : 'rgba(17,42,45,.42)'} strokeWidth=".6" />
                  <circle r="2.8" fill={isDark ? '#fff' : '#173538'} stroke={isDark ? 'rgba(16,25,28,.75)' : 'rgba(255,255,255,.9)'} strokeWidth="1.2" />
                  <title>{plant.name} · {plant.capacity} GW</title>
                </g>
              )
            })}
          </g>
        </svg>

        <Surface className="absolute top-4 right-[18px] left-[18px] z-20 flex h-14 items-center gap-3 rounded-[16px] bg-surface/85 py-2 pr-2.5 pl-3.5 shadow-surface backdrop-blur-2xl max-[800px]:top-2.5 max-[800px]:right-2.5 max-[800px]:left-2.5">
          <Link href="#" className="gap-2 text-[17px] font-bold tracking-tight whitespace-nowrap hover:no-underline" aria-label="PowerMap home">
            <span className="grid size-[30px] place-items-center rounded-[8px] bg-[#55c5a5] text-[#0e1917] shadow-[inset_0_0_0_1px_rgba(255,255,255,.24)]"><Zap size={17} fill="currentColor" /></span>
            <span>PowerMap</span>
          </Link>
          <Separator orientation="vertical" className="h-6 max-[800px]:hidden" />
          <Chip color="success" size="sm" variant="soft" className="max-[800px]:hidden">
            <span className="size-1.5 rounded-full bg-success shadow-[0_0_0_4px_color-mix(in_oklab,var(--success)_18%,transparent)]" />
            <Chip.Label>Live</Chip.Label>
          </Chip>
          <Button variant="ghost" className="ml-2 h-9 w-[min(310px,28vw)] justify-start gap-2 rounded-xl border border-border bg-background-secondary px-2.5 text-muted max-[800px]:hidden" aria-label="Find a state or plant">
            <Search size={16} />
            <span className="flex-1 text-left">Find a state or plant</span>
            <Kbd variant="light" className="px-1.5 py-0.5 text-[11px]">⌘ K</Kbd>
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" className="h-9 min-h-9 gap-2 rounded-xl border border-border px-3 text-[13px] font-semibold max-[800px]:w-[38px] max-[800px]:min-w-[38px] max-[800px]:px-0" aria-label="Select map metric">
              <span className="flex items-center gap-0.5" aria-hidden="true">
                {GENERATION_SOURCES.slice(0, 3).map((source) => <i key={source.name} className="size-1.5 rounded-[2px]" style={{ backgroundColor: source.color }} />)}
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
          <ButtonGroup orientation="vertical" size="sm" variant="secondary" className="overflow-hidden rounded-xl border border-border bg-surface/85 shadow-surface backdrop-blur-lg">
            <Button isIconOnly className="h-9 min-h-9 w-9 min-w-9 rounded-none" aria-label="Zoom in" onPress={() => setZoom((value) => Math.min(1.2, value + .05))}><Plus size={17} /></Button>
            <Button isIconOnly className="h-9 min-h-9 w-9 min-w-9 rounded-none" aria-label="Zoom out" onPress={() => setZoom((value) => Math.max(.92, value - .05))}><ButtonGroup.Separator /><Minus size={17} /></Button>
          </ButtonGroup>
          <IconControl label="Center map" onPress={() => setZoom(1)}><LocateFixed size={17} /></IconControl>
        </div>

        <Chip variant="secondary" className="absolute bottom-[94px] left-1/2 z-[8] -translate-x-1/2 border border-border bg-surface/80 px-2.5 py-1.5 text-xs text-muted backdrop-blur-lg max-[800px]:hidden">
          <Info size={13} />
          <Chip.Label>Select a state to explore its power mix</Chip.Label>
        </Chip>

        <Card className="absolute bottom-4 left-[18px] z-10 h-[102px] w-[330px] gap-0 rounded-[15px] bg-surface/85 px-3.5 py-[13px] shadow-surface backdrop-blur-xl max-[800px]:bottom-2.5 max-[800px]:left-2.5 max-[800px]:h-[90px] max-[800px]:w-[220px]">
          <Card.Header className="flex-row items-start justify-between">
            <div>
              <Card.Description className="text-[11px] leading-tight">16 July 2026</Card.Description>
              <Card.Title className="mt-0.5 text-[13px] leading-tight font-semibold">15:30 EDT</Card.Title>
            </div>
            <Button size="sm" variant="ghost" className="h-6 min-h-6 gap-1 px-1 text-[11px] text-success"><Activity size={14} />Live data</Button>
          </Card.Header>
          <Card.Content className="gap-0">
            <Slider defaultValue={97} minValue={0} maxValue={100} aria-label="Timeline position" className="mt-1.5 gap-0">
              <Slider.Track className="h-4! border-x-[6px]!">
                <Slider.Fill className="bg-gradient-to-r! from-[#4dc790]! via-[#edd65b]! to-[#db864a]! opacity-70" />
                <Slider.Thumb className="w-4! after:size-3! after:rounded-full! after:bg-foreground!" />
              </Slider.Track>
            </Slider>
            <div className="-mt-0.5 flex justify-between text-[10px] text-muted"><span>12am</span><span>6am</span><span>12pm</span><span>Now</span></div>
          </Card.Content>
        </Card>

        <Card className="absolute right-[18px] bottom-4 z-10 w-[330px] gap-0 rounded-[15px] bg-surface/85 px-3.5 py-3 shadow-surface backdrop-blur-xl max-[800px]:right-2.5 max-[800px]:bottom-2.5 max-[800px]:w-[156px]">
          <Card.Header className="flex-row items-center justify-between">
            <div className="flex flex-1 items-center justify-between">
              <Card.Title className="text-[13px] leading-tight font-semibold">Generation source</Card.Title>
              <span className="text-[10px] text-muted max-[800px]:hidden">Largest share</span>
            </div>
            <Tooltip delay={250}>
              <Button isIconOnly size="sm" variant="ghost" className="ml-1.5 h-6 min-h-6 w-6 min-w-6 text-muted" aria-label="About the generation source key"><Info size={14} /></Button>
              <Tooltip.Content>Each state is coloured by its largest generation source</Tooltip.Content>
            </Tooltip>
          </Card.Header>
          <Card.Content className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 max-[800px]:grid-cols-2">
            {GENERATION_SOURCES.map((source) => (
              <div className="flex min-w-0 items-center gap-1.5" key={source.name}>
                <i className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: source.color }} />
                <span className="text-[10px] whitespace-nowrap text-muted">{source.name}</span>
              </div>
            ))}
          </Card.Content>
        </Card>

        {hovered && !selected && <HoverCard datum={hovered} point={hoverPoint} />}
        {selected && <StatePanel datum={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </main>
  )
}

export default App
