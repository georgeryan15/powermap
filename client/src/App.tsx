import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@heroui/react'
import {
  ChevronLeft,
  ChevronRight,
  Factory,
  MapPin,
  Moon,
  Search,
  Sun,
  Zap,
} from 'lucide-react'
import { PlantMap } from './PlantMap'
import { PlantDetail } from './PlantDetail'
import { FUEL_COLORS, format, getJson } from './plants'
import type { Dataset, Plant } from './plants'

const PAGE_SIZE = 75
function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('powermap-theme') === 'light' ? 'light' : 'dark',
  )
  const [plants, setPlants] = useState<Plant[]>([]),
    [dataset, setDataset] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0)
  const [query, setQuery] = useState(''),
    [fuel, setFuel] = useState(''),
    [region, setRegion] = useState(''),
    [status, setStatus] = useState('')
  const [sort, setSort] = useState('capacity'),
    [page, setPage] = useState(0),
    [selectedId, setSelectedId] = useState<number | null>(null)
  const [mobileView, setMobileView] = useState('list'),
    searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
    localStorage.setItem('powermap-theme', theme)
  }, [theme])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    Promise.all([
      getJson<{ plants: Plant[] }>('/plants/map', controller.signal),
      getJson<Dataset>('/plants/dataset', controller.signal),
    ])
      .then(([data, meta]) => {
        setPlants(data.plants)
        setDataset(meta)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [retry])
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setMobileView('list')
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
  const states = useMemo(
    () =>
      [
        ...new Set(plants.map((p) => p.state).filter((v): v is string => !!v)),
      ].sort(),
    [plants],
  )
  const fuels = useMemo(
    () => [...new Set(plants.flatMap((p) => p.fuel_types))].sort(),
    [plants],
  )
  const statuses = useMemo(
    () => [...new Set(plants.map((p) => p.status))].sort(),
    [plants],
  )
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return plants
      .filter(
        (p) =>
          (!q ||
            `${p.id} ${p.name} ${p.operator_name || ''} ${p.county || ''}`
              .toLowerCase()
              .includes(q)) &&
          (!fuel || p.fuel_types.includes(fuel)) &&
          (!region || p.state === region) &&
          (!status || p.status === status),
      )
      .sort((a, b) =>
        sort === 'capacity'
          ? b.nameplate_mw - a.nameplate_mw || a.id - b.id
          : sort === 'generation'
            ? (b.net_generation_mwh ?? -Infinity) -
                (a.net_generation_mwh ?? -Infinity) || a.id - b.id
            : sort === 'newest'
              ? (b.first_operating_year ?? 0) - (a.first_operating_year ?? 0) ||
                a.id - b.id
              : a.name.localeCompare(b.name) || a.id - b.id,
      )
  }, [plants, query, fuel, region, status, sort])
  const selected = plants.find((p) => p.id === selectedId) ?? null
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE)),
    currentPage = Math.min(page, pageCount - 1)
  const reset = () => {
    setQuery('')
    setFuel('')
    setRegion('')
    setStatus('')
    setPage(0)
  }
  const changed = (fn: () => void) => {
    fn()
    setPage(0)
  }
  return (
    <main className="power-app">
      <header className="app-header">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault()
            reset()
            setSelectedId(null)
          }}
        >
          <span>
            <Zap size={17} fill="currentColor" />
          </span>
          PowerMap
        </a>
        <span className="release-badge">2025 · Early release</span>
        <span className="header-subtitle">U.S. power plant explorer</span>
        <div className="header-actions">
          <Button
            size="sm"
            variant="secondary"
            isIconOnly
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            onPress={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
        </div>
      </header>
      <div className="dataset-strip">
        <div>
          <span>Plants in catalogue</span>
          <strong>{loading ? '—' : format(plants.length, 0)}</strong>
        </div>
        <div>
          <span>With map coordinates</span>
          <strong>
            {dataset ? format(dataset.report.mapped_plants, 0) : '—'}
          </strong>
        </div>
        <div>
          <span>With annual generation</span>
          <strong>
            {dataset ? format(dataset.report.plants_with_generation, 0) : '—'}
          </strong>
        </div>
        <div>
          <span>Reporting basis</span>
          <strong className="reporting-basis">EIA-860 + EIA-923</strong>
        </div>
      </div>
      <div className="release-note">
        {dataset?.warning ||
          '2025 early release data. Plant-level records may be incomplete; not suitable for state, regional or national totals.'}
      </div>
      <div className="mobile-switch">
        <Button
          size="sm"
          variant={mobileView === 'list' ? 'primary' : 'secondary'}
          onPress={() => setMobileView('list')}
        >
          Plant list
        </Button>
        <Button
          size="sm"
          variant={mobileView === 'map' ? 'primary' : 'secondary'}
          onPress={() => setMobileView('map')}
        >
          Map
        </Button>
      </div>
      <div className={`explorer mobile-${mobileView}`}>
        <section className="map-region">
          <PlantMap
            plants={visible}
            selected={selected}
            theme={theme}
            onSelect={setSelectedId}
          />
          <div className="map-legend">
            <span className="eyebrow">Plant sources</span>
            <div>
              {Object.entries(FUEL_COLORS)
                .filter(([f]) => fuels.includes(f))
                .map(([f, c]) => (
                  <button
                    type="button"
                    key={f}
                    aria-pressed={fuel === f}
                    onClick={() => changed(() => setFuel(fuel === f ? '' : f))}
                  >
                    <i style={{ background: c }} />
                    {f}
                  </button>
                ))}
            </div>
          </div>
        </section>
        <aside className="plant-browser">
          <div className="browser-heading">
            <h1>Power plants</h1>
            <span>Plant-level records</span>
          </div>
          <div className="browser-filters">
            <label className="search-input">
              <Search size={15} />
              <input
                ref={searchRef}
                aria-label="Search plants, operators or EIA IDs"
                placeholder="Search plants, operators or EIA IDs"
                value={query}
                onChange={(e) => changed(() => setQuery(e.target.value))}
              />
            </label>
            <div className="filter-grid">
              <label className="field-label">
                Fuel source
                <select
                  value={fuel}
                  onChange={(e) => changed(() => setFuel(e.target.value))}
                >
                  <option value="">All sources</option>
                  {fuels.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                State
                <select
                  value={region}
                  onChange={(e) => changed(() => setRegion(e.target.value))}
                >
                  <option value="">All states</option>
                  {states.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Status
                <select
                  value={status}
                  onChange={(e) => changed(() => setStatus(e.target.value))}
                >
                  <option value="">All statuses</option>
                  {statuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Sort by
                <select
                  value={sort}
                  onChange={(e) => changed(() => setSort(e.target.value))}
                >
                  <option value="capacity">Nameplate capacity</option>
                  <option value="generation">Annual generation</option>
                  <option value="name">Plant name</option>
                  <option value="newest">First commissioned</option>
                </select>
              </label>
            </div>
          </div>
          <div className="results-caption">
            <span>
              {format(visible.length, 0)}{' '}
              {visible.length === 1 ? 'plant' : 'plants'}
              {visible.length !== plants.length
                ? ` of ${format(plants.length, 0)}`
                : ''}
            </span>
            {(query || fuel || region || status) && (
              <button type="button" onClick={reset}>
                Clear filters
              </button>
            )}
            <span>Nameplate MW</span>
          </div>
          <div className="plant-results" aria-busy={loading}>
            {loading ? (
              <p className="empty-note" role="status">
                Loading government plant records…
              </p>
            ) : error ? (
              <div className="empty-note" role="alert">
                <p>{error}</p>
                <Button
                  variant="secondary"
                  onPress={() => setRetry((n) => n + 1)}
                >
                  Retry
                </Button>
              </div>
            ) : visible.length === 0 ? (
              <div className="empty-note">
                <Search size={22} />
                <h2>No plants match</h2>
                <p>Try another name, source, state or status.</p>
                <Button variant="secondary" onPress={reset}>
                  Clear filters
                </Button>
              </div>
            ) : (
              visible
                .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
                .map((p) => (
                  <button
                    type="button"
                    className={`plant-row ${selectedId === p.id ? 'is-selected' : ''}`}
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    aria-label={`Open ${p.name}, EIA plant ${p.id}`}
                  >
                    <span
                      className="plant-icon"
                      style={{
                        color: FUEL_COLORS[p.primary_fuel] || FUEL_COLORS.Other,
                      }}
                    >
                      <Factory size={16} />
                    </span>
                    <span className="plant-row-copy">
                      <span className="plant-row-title">
                        <strong>{p.name}</strong>
                        <b>{format(p.nameplate_mw)}</b>
                      </span>
                      <span className="plant-row-meta">
                        <span>
                          {p.primary_fuel}
                          {p.fuel_types.length > 1
                            ? ` +${p.fuel_types.length - 1}`
                            : ''}{' '}
                          · {p.state} · {p.operable_unit_count} units
                        </span>
                        <span>
                          {p.status === 'Operating'
                            ? 'Operating'
                            : p.status === 'Standby / out of service'
                              ? 'Standby / offline'
                              : p.status}
                        </span>
                      </span>
                      <span className="plant-row-id">
                        EIA {p.id}
                        {p.latitude == null && (
                          <span>
                            <MapPin size={10} /> Location under review
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                ))
            )}
          </div>
          <div className="pagination">
            <Button
              isIconOnly
              size="sm"
              variant="secondary"
              aria-label="Previous plants"
              isDisabled={currentPage === 0}
              onPress={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={16} />
            </Button>
            <span>
              Page {currentPage + 1} of {pageCount}
            </span>
            <Button
              isIconOnly
              size="sm"
              variant="secondary"
              aria-label="Next plants"
              isDisabled={currentPage + 1 >= pageCount}
              onPress={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        </aside>
      </div>
      {selected && (
        <PlantDetail
          key={selected.id}
          plant={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </main>
  )
}
export default App
