import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Chip } from '@heroui/react'
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
  X,
  Zap,
} from 'lucide-react'
import { geoAlbersUsa, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import statesAtlas from 'us-atlas/states-10m.json'
import './App.css'

type StateDatum = {
  id: string
  name: string
  abbr: string
  intensity: number
  renewable: number
  clean: number
  output: number
  change: number
  mix: { name: string; value: number; color: string }[]
}

type HoverPoint = { x: number; y: number }
type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'powermap-theme'

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

function buildStateDatum(id: string, name: string): StateDatum {
  const seed = hashName(name)
  const intensity = 90 + (seed * 17) % 610
  const renewable = 12 + (seed * 7) % 76
  const clean = Math.min(98, renewable + 8 + (seed % 18))
  const wind = 12 + (seed % 26)
  const solar = 10 + ((seed * 3) % 22)
  const hydro = 8 + ((seed * 5) % 18)
  const nuclear = Math.max(4, 64 - wind - solar - hydro)
  const fossil = Math.max(8, 100 - wind - solar - hydro - nuclear)

  const base: StateDatum = {
    id,
    name,
    abbr: STATE_ABBREVIATIONS[name] ?? name.slice(0, 2).toUpperCase(),
    intensity,
    renewable,
    clean,
    output: Number((2.4 + ((seed * 13) % 290) / 10).toFixed(1)),
    change: (seed % 19) - 9,
    mix: [
      { name: 'Wind', value: wind, color: '#50c7aa' },
      { name: 'Solar', value: solar, color: '#f7d650' },
      { name: 'Hydro', value: hydro, color: '#64a9ee' },
      { name: 'Nuclear', value: nuclear, color: '#a890f8' },
      { name: 'Fossil', value: fossil, color: '#e28154' },
    ],
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

function RingStat({ value, color, label }: { value: number; color: string; label: string }) {
  const dash = `${Math.round(value * 1.82)} 182`
  return (
    <div className="ring-stat">
      <div className="ring-wrap">
        <svg viewBox="0 0 72 72" aria-hidden="true">
          <circle className="ring-track" cx="36" cy="36" r="29" />
          <circle className="ring-progress" style={{ stroke: color, strokeDasharray: dash }} cx="36" cy="36" r="29" />
        </svg>
        <span>{value}%</span>
      </div>
      <p>{label}</p>
    </div>
  )
}

function HoverCard({ datum, point }: { datum: StateDatum; point: HoverPoint }) {
  const left = Math.max(16, Math.min(point.x + 22, window.innerWidth - 452))
  const top = Math.max(90, Math.min(point.y - 112, window.innerHeight - 306))

  return (
    <div className="hover-card" style={{ left, top }} role="tooltip">
      <div className="hover-card__head">
        <div>
          <div className="hover-card__title"><span className="flag">🇺🇸</span>{datum.name}</div>
          <p>16 Jul 2026, 15:30 EDT</p>
        </div>
        <Chip className="status-chip" size="sm" variant="secondary"><Activity size={13} /> Live estimate</Chip>
      </div>
      <div className="hover-stats">
        <div className="intensity-stat" style={{ backgroundColor: intensityColor(datum.intensity) }}>
          <strong>{datum.intensity}</strong>
          <span>gCO₂e/kWh</span>
          <p>Carbon intensity</p>
        </div>
        <RingStat value={datum.renewable} color="#55c5a5" label="Renewable" />
        <div className="mix-stat">
          <div className="mix-stat__value"><strong>{datum.output}</strong><span>GW</span></div>
          <div className="spark-bars" aria-hidden="true">
            {[35, 48, 56, 49, 70, 77, 64, 86, 78, 91, 83, 88].map((height, index) => (
              <i key={index} style={{ height: `${height}%` }} />
            ))}
          </div>
          <p>Power generated</p>
        </div>
      </div>
      <div className="hover-card__hint">Click to explore {datum.abbr} generation</div>
    </div>
  )
}

function TrendChart({ color }: { color: string }) {
  return (
    <svg className="trend-chart" viewBox="0 0 360 128" preserveAspectRatio="none" aria-label="24 hour carbon intensity trend">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".3" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[28, 62, 96].map((y) => <line key={y} x1="0" x2="360" y1={y} y2={y} className="chart-grid" />)}
      <path d="M0 83 C24 78 30 63 54 68 S86 91 111 72 S146 42 170 54 S199 82 227 67 S263 37 286 45 S324 76 360 50 L360 128 L0 128 Z" fill="url(#trendFill)" />
      <path d="M0 83 C24 78 30 63 54 68 S86 91 111 72 S146 42 170 54 S199 82 227 67 S263 37 286 45 S324 76 360 50" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <circle className="trend-chart__endpoint" cx="360" cy="50" r="5" fill={color} strokeWidth="3" />
    </svg>
  )
}

function StatePanel({ datum, onClose }: { datum: StateDatum; onClose: () => void }) {
  const carbonColor = intensityColor(datum.intensity)
  const plants = [
    { name: `${datum.name} Energy Center`, type: 'Natural gas', cap: '1.8 GW', icon: Factory, color: '#e28154' },
    { name: `${datum.name} Wind Project`, type: 'Wind', cap: '940 MW', icon: Wind, color: '#50c7aa' },
    { name: `Sunrise Solar Farm`, type: 'Solar', cap: '610 MW', icon: Sun, color: '#f7d650' },
  ]

  return (
    <aside className="state-panel" aria-label={`${datum.name} electricity details`}>
      <div className="panel-scroll">
        <header className="panel-header">
          <Button isIconOnly size="sm" variant="ghost" className="panel-icon-button" onPress={onClose} aria-label="Close state details">
            <ArrowLeft size={20} />
          </Button>
          <div className="state-identity">
            <span className="state-monogram">{datum.abbr}</span>
            <div><h2>{datum.name}</h2><p>United States · Live grid</p></div>
          </div>
          <Button isIconOnly size="sm" variant="ghost" className="panel-icon-button" onPress={onClose} aria-label="Close">
            <X size={18} />
          </Button>
        </header>

        <div className="panel-tabs" role="tablist" aria-label="State data view">
          <button className="active" role="tab" aria-selected="true">Electricity</button>
          <button role="tab" aria-selected="false">Emissions</button>
        </div>

        <section className="panel-section overview-section">
          <div className="section-heading">
            <div><h3>Current electricity mix</h3><p>Updated 4 minutes ago</p></div>
            <Chip className="status-chip" size="sm" variant="secondary">Live</Chip>
          </div>
          <div className="primary-stat-row">
            <div className="carbon-tile" style={{ backgroundColor: carbonColor }}>
              <Zap size={17} />
              <strong>{datum.intensity}</strong>
              <span>gCO₂e/kWh</span>
            </div>
            <div className="primary-copy">
              <p>Carbon intensity</p>
              <strong>{datum.change <= 0 ? '↓' : '↑'} {Math.abs(datum.change)}%</strong>
              <span>from yesterday at this time</span>
            </div>
          </div>
          <div className="mix-bar" aria-label="Generation source mix">
            {datum.mix.map((source) => <i key={source.name} style={{ width: `${source.value}%`, backgroundColor: source.color }} />)}
          </div>
          <div className="mix-legend">
            {datum.mix.map((source) => (
              <div key={source.name}><i style={{ backgroundColor: source.color }} /><span>{source.name}</span><strong>{source.value}%</strong></div>
            ))}
          </div>
        </section>

        <section className="panel-section metrics-section">
          <div className="mini-metric"><Leaf size={18} /><div><strong>{datum.renewable}%</strong><span>Renewable</span></div></div>
          <div className="mini-metric"><BatteryCharging size={18} /><div><strong>{datum.clean}%</strong><span>Carbon-free</span></div></div>
          <div className="mini-metric"><Activity size={18} /><div><strong>{datum.output} GW</strong><span>Generated</span></div></div>
        </section>

        <section className="panel-section trend-section">
          <div className="section-heading">
            <div><h3>Carbon intensity</h3><p>Past 24 hours</p></div>
            <button className="quiet-button"><Settings2 size={15} /> Hourly</button>
          </div>
          <TrendChart color={carbonColor} />
          <div className="chart-axis"><span>12am</span><span>6am</span><span>12pm</span><span>Now</span></div>
        </section>

        <section className="panel-section plants-section">
          <div className="section-heading"><div><h3>Largest power plants</h3><p>By operating capacity</p></div><span className="plant-count">12 total</span></div>
          <div className="plant-list">
            {plants.map(({ name, type, cap, icon: Icon, color }) => (
              <button className="plant-row" key={name}>
                <span className="plant-icon" style={{ color }}><Icon size={18} /></span>
                <span><strong>{name}</strong><small>{type}</small></span>
                <em>{cap}</em>
              </button>
            ))}
          </div>
        </section>
      </div>
    </aside>
  )
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null)
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

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  const updatePointer = (event: React.MouseEvent<SVGPathElement>) => {
    setHoverPoint({ x: event.clientX, y: event.clientY })
  }

  return (
    <main className="app-shell">
      <div className="map-surface" ref={containerRef}>
        <div className="ocean-glow" />
        <svg className="usa-map" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} aria-label="United States carbon intensity by state">
          <defs>
            <filter id="stateGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="var(--map-highlight)" floodOpacity=".38" />
            </filter>
            <pattern id="mapGrid" width="34" height="34" patternUnits="userSpaceOnUse">
              <path d="M 34 0 L 0 0 0 34" fill="none" stroke="var(--map-grid)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#mapGrid)" />
          <g className="states-layer" style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}>
            {stateFeatures.map((state) => {
              const id = String(state.id).padStart(2, '0')
              const datum = dataById.get(id)
              const d = path(state as Feature<Geometry>) ?? ''
              const isHovered = hoveredId === id
              const isSelected = selectedId === id
              return (
                <path
                  key={id}
                  d={d}
                  className={`state-shape${isHovered ? ' is-hovered' : ''}${isSelected ? ' is-selected' : ''}`}
                  fill={datum ? intensityColor(datum.intensity) : 'var(--map-missing)'}
                  onMouseEnter={() => setHoveredId(id)}
                  onMouseMove={updatePointer}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => setSelectedId(id)}
                  onFocus={() => setHoveredId(id)}
                  onBlur={() => setHoveredId(null)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${datum?.name}: ${datum?.intensity} grams of CO2 equivalent per kilowatt-hour`}
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
              return <text key={`label-${id}`} x={x} y={y} className="state-label">{datum.abbr}</text>
            })}
            {PLANTS.map((plant) => {
              const point = projection(plant.coordinates as [number, number])
              if (!point) return null
              return (
                <g className="plant-marker" key={plant.name} transform={`translate(${point[0]}, ${point[1]})`}>
                  <circle className="plant-marker__pulse" r={5 + plant.capacity / 2} />
                  <circle className="plant-marker__core" r={2.8} />
                  <title>{plant.name} · {plant.capacity} GW</title>
                </g>
              )
            })}
          </g>
        </svg>

        <header className="topbar">
          <a className="brand" href="#" aria-label="PowerMap home"><span className="brand-mark"><Zap size={17} fill="currentColor" /></span><span>PowerMap</span></a>
          <div className="topbar-divider" />
          <Chip className="live-chip" size="sm" variant="secondary"><i /> Live</Chip>
          <button className="search-control"><Search size={16} /><span>Find a state or plant</span><kbd>⌘ K</kbd></button>
          <div className="topbar-actions">
            <button className="metric-select"><span className="metric-dot" /> Carbon intensity <ChevronDown size={14} /></button>
            <Button
              isIconOnly
              size="sm"
              variant="secondary"
              className="glass-button theme-toggle"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              aria-pressed={theme === 'light'}
              onPress={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </Button>
            <Button isIconOnly size="sm" variant="secondary" className="glass-button" aria-label="Map settings"><Settings2 size={17} /></Button>
          </div>
        </header>

        <div className="map-tools">
          <Button isIconOnly size="sm" variant="secondary" className="glass-button" aria-label="Map layers"><Layers3 size={18} /></Button>
          <div className="zoom-control">
            <button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.2, value + .05))}><Plus size={17} /></button>
            <button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(.92, value - .05))}><Minus size={17} /></button>
          </div>
          <Button isIconOnly size="sm" variant="secondary" className="glass-button" aria-label="Center map" onPress={() => setZoom(1)}><LocateFixed size={17} /></Button>
        </div>

        <div className="map-caption"><Info size={13} /> Select a state to explore its power mix</div>

        <div className="timeline-card">
          <div className="timeline-head"><div><span>16 July 2026</span><strong>15:30 EDT</strong></div><button><Activity size={14} /> Live data</button></div>
          <div className="timeline-track"><i /><b /></div>
          <div className="timeline-labels"><span>12am</span><span>6am</span><span>12pm</span><span>Now</span></div>
        </div>

        <div className="legend-card">
          <div className="legend-title"><div><span>Carbon intensity</span><strong>gCO₂e/kWh</strong></div><button aria-label="About the carbon intensity scale"><Info size={14} /></button></div>
          <div className="legend-gradient" />
          <div className="legend-labels"><span>0</span><span>200</span><span>400</span><span>600</span><span>800+</span></div>
        </div>

        {hovered && !selected && <HoverCard datum={hovered} point={hoverPoint} />}
        {selected && <StatePanel datum={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </main>
  )
}

export default App
