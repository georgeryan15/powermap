import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Card,
  ListBox,
  SearchField,
  Spinner,
  Switch,
  ToggleButton,
} from '@heroui/react'
import {
  ChevronLeft,
  ChevronRight,
  Factory,
  Globe2,
  MapPin,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  SlidersHorizontal,
  Sun,
  Zap,
} from 'lucide-react'
import { PlantMap } from './PlantMap'
import { PlantDetail } from './PlantDetail'
import { AppleSelect, IconButton } from './AppleUI'
import { DatasetInfo, DatasetSummary } from './DatasetSummary'
import { usePowerMapTheme } from './theme'
import { FUEL_COLORS, format, getJson } from './plants'
import type { Dataset, Plant } from './plants'

const PAGE_SIZE = 75
function App() {
  const { theme, setTheme } = usePowerMapTheme()
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
  const [browserOpen, setBrowserOpen] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
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
        setSelectedId(null)
        setBrowserOpen(true)
        requestAnimationFrame(() => searchRef.current?.focus())
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
  const activeFilters = [fuel, region, status].filter(Boolean).length
  return (
    <main
      className={`power-app ${browserOpen ? 'browser-open' : 'browser-closed'} ${selected ? 'detail-open' : ''}`}
    >
      <PlantMap
        plants={visible}
        selected={selected}
        theme={theme}
        onSelect={setSelectedId}
        browserOpen={browserOpen}
      />

      <header className="app-header floating-surface">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault()
            reset()
            setSelectedId(null)
            setBrowserOpen(true)
          }}
        >
          <span className="brand-mark">
            <Zap size={21} fill="currentColor" />
          </span>
          <span className="brand-copy">
            <strong>PowerMap</strong>
            <span>The U.S. power plant atlas</span>
          </span>
        </a>
        <div className="header-location">
          <Globe2 size={15} />
          <span>United States</span>
          <span className="header-divider" />
          <span>2025</span>
        </div>
        <div className="header-actions">
          <DatasetInfo dataset={dataset} />
          <Switch
            aria-label="Use dark mode"
            size="sm"
            isSelected={theme === 'dark'}
            onChange={(dark) => setTheme(dark ? 'dark' : 'light')}
          >
            <Switch.Content>
              <span className="theme-label">
                {theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
                <span>Dark mode</span>
              </span>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </div>
      </header>

      {!browserOpen && (
        <div className="open-browser floating-surface">
          <Button variant="tertiary" onPress={() => setBrowserOpen(true)}>
            <PanelLeftOpen size={17} />
            Explore plants
          </Button>
        </div>
      )}

      {browserOpen && (
        <aside
          className="plant-browser floating-surface"
          aria-label="Plant browser"
        >
          <div className="browser-heading">
            <div>
              <span className="eyebrow">Discover the grid</span>
              <h1>Explore power plants</h1>
            </div>
            <IconButton
              label="Hide plant browser"
              onPress={() => setBrowserOpen(false)}
            >
              <PanelLeftClose size={18} />
            </IconButton>
          </div>
          <div className="browser-filters">
            <SearchField
              aria-label="Search plants, operators or EIA IDs"
              value={query}
              onChange={(value) => changed(() => setQuery(value))}
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  ref={searchRef}
                  placeholder="Plant, operator or EIA ID"
                />
                {query ? <SearchField.ClearButton /> : <kbd>⌘ K</kbd>}
              </SearchField.Group>
            </SearchField>
            <div className="filter-toolbar">
              <Button
                size="sm"
                variant="tertiary"
                className={activeFilters ? 'has-filters' : ''}
                aria-expanded={filtersOpen}
                aria-controls="plant-filters"
                onPress={() => setFiltersOpen(!filtersOpen)}
              >
                <SlidersHorizontal size={14} />
                Filters
                {activeFilters > 0 && (
                  <span className="filter-count">{activeFilters}</span>
                )}
              </Button>
              <AppleSelect
                label="Sort by"
                value={sort}
                onChange={(v) => changed(() => setSort(v))}
                options={[
                  { value: 'capacity', label: 'Highest capacity' },
                  { value: 'generation', label: 'Annual generation' },
                  { value: 'name', label: 'Plant name' },
                  { value: 'newest', label: 'First commissioned' },
                ]}
              />
            </div>
            {filtersOpen && (
              <div className="filter-grid" id="plant-filters">
                <AppleSelect
                  label="Fuel source"
                  value={fuel}
                  onChange={(v) => changed(() => setFuel(v))}
                  options={[
                    { value: '', label: 'All sources' },
                    ...fuels.map((v) => ({ value: v, label: v })),
                  ]}
                />
                <AppleSelect
                  label="State"
                  value={region}
                  onChange={(v) => changed(() => setRegion(v))}
                  options={[
                    { value: '', label: 'All states' },
                    ...states.map((v) => ({ value: v, label: v })),
                  ]}
                />
                <AppleSelect
                  label="Status"
                  value={status}
                  onChange={(v) => changed(() => setStatus(v))}
                  options={[
                    { value: '', label: 'All statuses' },
                    ...statuses.map((v) => ({ value: v, label: v })),
                  ]}
                />
                <Button variant="tertiary" size="sm" onPress={reset}>
                  Reset filters
                </Button>
              </div>
            )}
            {activeFilters > 0 && !filtersOpen && (
              <div className="active-filter-summary">
                {[fuel, region, status].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
          <div className="results-caption">
            <span role="status">
              {loading
                ? 'Loading plants'
                : `${format(visible.length, 0)} ${visible.length === 1 ? 'plant' : 'plants'}`}
            </span>
            {(query || activeFilters > 0) && (
              <Button size="sm" variant="tertiary" onPress={reset}>
                Clear
              </Button>
            )}
            <span>Capacity · MW</span>
          </div>
          <div className="plant-results" aria-busy={loading}>
            {loading ? (
              <div className="empty-note" role="status">
                <Spinner size="sm" />
                <p>Loading plant records…</p>
              </div>
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
                <Search size={24} />
                <h2>No plants match</h2>
                <p>Try another name, source, state or status.</p>
                <Button variant="secondary" onPress={reset}>
                  Clear filters
                </Button>
              </div>
            ) : (
              <ListBox
                aria-label="Power plants"
                selectionMode="single"
                selectedKeys={selectedId == null ? [] : [selectedId]}
                onAction={(key) => setSelectedId(Number(key))}
                className="plant-list"
              >
                {visible
                  .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
                  .map((p) => (
                    <ListBox.Item
                      id={p.id}
                      key={p.id}
                      textValue={`${p.name}, ${p.state}, EIA ${p.id}`}
                      className="plant-row"
                    >
                      <span
                        className="plant-icon"
                        style={{
                          color:
                            FUEL_COLORS[p.primary_fuel] || FUEL_COLORS.Other,
                        }}
                      >
                        <Factory size={17} />
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
                            · {p.state ?? '—'}
                          </span>
                          <span>{p.operable_unit_count} units</span>
                        </span>
                        <span className="plant-row-id">
                          EIA {p.id}
                          <span>
                            {p.latitude == null ? (
                              <>
                                <MapPin size={10} />
                                Location under review
                              </>
                            ) : (
                              p.status
                            )}
                          </span>
                        </span>
                      </span>
                    </ListBox.Item>
                  ))}
              </ListBox>
            )}
          </div>
          <div className="pagination">
            <IconButton
              label="Previous plants"
              isDisabled={currentPage === 0}
              onPress={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={16} />
            </IconButton>
            <span>
              {currentPage + 1} <span className="pagination-separator">/</span>{' '}
              {pageCount}
            </span>
            <IconButton
              label="Next plants"
              isDisabled={currentPage + 1 >= pageCount}
              onPress={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={16} />
            </IconButton>
          </div>
          <div className="browser-footer">
            <span className="status-dot" />
            EIA-860 & EIA-923<span>2025 data</span>
          </div>
        </aside>
      )}

      {!selected && (
        <DatasetSummary
          plants={plants}
          visible={visible}
          dataset={dataset}
          loading={loading}
          error={error}
          onFuelSelect={(value) =>
            changed(() => setFuel(fuel === value ? '' : value))
          }
        />
      )}

      <Card
        className="map-legend floating-surface"
        aria-label="Map source filters"
      >
        <span className="legend-label">Energy sources</span>
        <div>
          {Object.entries(FUEL_COLORS)
            .filter(([f]) => fuels.includes(f))
            .map(([f, c]) => (
              <ToggleButton
                key={f}
                size="sm"
                isSelected={fuel === f}
                onChange={(isSelected) =>
                  changed(() => setFuel(isSelected ? f : ''))
                }
                className="legend-toggle"
              >
                <i style={{ background: c }} />
                {f}
              </ToggleButton>
            ))}
        </div>
      </Card>
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
