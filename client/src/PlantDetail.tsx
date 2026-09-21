import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Card, Chip, Spinner, Tabs } from '@heroui/react'
import { AppleSelect, Disclosure, IconButton } from './AppleUI'
import { GenerationChart } from './AppleCharts'
import { ExternalLink, Factory, X } from 'lucide-react'
import type { Detail, Metadata, Plant, Source } from './plants'
import { FUEL_COLORS, format, getJson, percent } from './plants'

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value ?? 'Not reported'}</strong>
    </div>
  )
}
function Metric({
  label,
  value,
  unit,
}: {
  label: string
  value: string
  unit?: string
}) {
  return (
    <Card variant="secondary" className="detail-metric">
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
    </Card>
  )
}
function SourceData({
  plantId,
  sources,
}: {
  plantId: number
  sources: Source[]
}) {
  const [source, setSource] = useState(sources[0]?.id ?? ''),
    [offset, setOffset] = useState(0)
  const [data, setData] = useState<Metadata | null>(null),
    [error, setError] = useState<string | null>(null),
    [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!source) return
    const controller = new AbortController()
    setData(null)
    setError(null)
    getJson<Metadata>(
      `/plants/${plantId}/metadata?source=${encodeURIComponent(source)}&limit=10&offset=${offset}`,
      controller.signal,
    )
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [plantId, source, offset, retry])
  if (!sources.length) return <p>No source records.</p>
  return (
    <section>
      <h3>Original source records</h3>
      <p className="explanation">
        Environmental equipment, solar, wind, storage, fuel receipts and other
        supplied fields are preserved here. Values retain EIA’s original units
        and missing-data symbols.
      </p>
      <AppleSelect
        label="Data schedule"
        value={source}
        onChange={(value) => {
          setSource(value)
          setOffset(0)
        }}
        options={sources.map((s) => ({
          value: s.id,
          label: `${s.path.startsWith('data/') ? '860' : '923'} · ${s.sheet} (${s.records}) · ${s.path.split('/').pop()?.split('_Y')[0]}`,
        }))}
      />
      {error ? (
        <div role="alert">
          {error}
          <Button size="sm" onPress={() => setRetry((n) => n + 1)}>
            Retry
          </Button>
        </div>
      ) : !data ? (
        <p role="status">Loading source records…</p>
      ) : (
        <>
          <p className="explanation">
            {data.total} records ·{' '}
            {sources
              .find((s) => s.id === source)
              ?.path.split('/')
              .pop()}
          </p>
          {data.records.map((r) => (
            <Disclosure
              className="source-record"
              key={r.row_number}
              title={`Row ${r.row_number}${r.generator_id ? ` · Unit ${r.generator_id}` : ''}`}
            >
              {Object.entries(r.data).map(([k, v]) => (
                <Row key={k} label={k} value={String(v)} />
              ))}
            </Disclosure>
          ))}
          <div className="pagination">
            <Button
              size="sm"
              variant="secondary"
              isDisabled={offset === 0}
              onPress={() => setOffset((n) => Math.max(0, n - 10))}
            >
              Previous
            </Button>
            <span>
              {offset + 1}–{Math.min(offset + 10, data.total)} of {data.total}
            </span>
            <Button
              size="sm"
              variant="secondary"
              isDisabled={offset + 10 >= data.total}
              onPress={() => setOffset((n) => n + 10)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

export function PlantDetail({
  plant,
  onClose,
}: {
  plant: Plant
  onClose: () => void
}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    panelRef.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      // Let open HeroUI menus and tooltips handle their own Escape first.
      if (event.key === 'Escape' && !event.defaultPrevented) closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true })
    }
  }, [])
  const [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState<string | null>(null),
    [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setError(null)
    getJson<Detail>(`/plants/${plant.id}`, controller.signal)
      .then(setDetail)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [plant.id, retry])
  const color = FUEL_COLORS[plant.primary_fuel] || FUEL_COLORS.Other
  const p = detail?.plant,
    m = detail?.metrics
  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className="plant-detail-panel floating-surface"
      aria-label={`${plant.name} power plant details`}
    >
      <div className="detail-header">
        <div className="detail-close">
          <IconButton label="Close plant details" onPress={onClose}>
            <X size={17} />
          </IconButton>
        </div>
        <span className="eyebrow">
          EIA {plant.id} · {plant.state} · 2025
        </span>
        <h2>{plant.name}</h2>
        <p>{plant.operator_name || 'Operator not reported'}</p>
        <div className="detail-tags">
          <Chip size="sm" variant="soft">
            <i className="fuel-dot" style={{ background: color }} />
            {plant.primary_fuel}
          </Chip>
          <Chip size="sm" variant="soft">
            {plant.status}
          </Chip>
          <Chip size="sm" variant="soft">
            {plant.operable_unit_count} units
          </Chip>
        </div>
      </div>
      <div className="detail-body">
        {error ? (
          <div role="alert" className="empty-note">
            {error}
            <Button onPress={() => setRetry((n) => n + 1)}>Retry</Button>
          </div>
        ) : !detail || !p || !m ? (
          <div role="status" className="empty-note">
            <Spinner size="sm" />
            <p>Loading plant details…</p>
          </div>
        ) : (
          <>
            <div className="detail-metrics">
              <Metric
                label="Operable nameplate"
                value={format(p.nameplate_mw)}
                unit="MW"
              />
              <Metric
                label="2025 net generation"
                value={format(
                  m.net_generation_mwh == null
                    ? null
                    : m.net_generation_mwh / 1000,
                )}
                unit={m.net_generation_mwh == null ? '' : 'GWh'}
              />
              <Metric
                label="Capacity factor¹"
                value={percent(m.capacity_factor)}
              />
              <Metric
                label="First commissioned"
                value={p.first_operating_year?.toString() ?? 'Not reported'}
              />
            </div>
            <p className="data-notice">
              2025 early release · Annual reporting, not live output.
            </p>
            {m.capacity_factor != null &&
              (m.capacity_factor < 0 || m.capacity_factor > 1) && (
                <p className="data-notice">
                  Capacity factor is outside the usual 0–100% range. See Sources
                  for the reported inputs and review notes.
                </p>
              )}
            <Tabs defaultSelectedKey="overview">
              <Tabs.ListContainer>
                <Tabs.List aria-label="Plant detail sections">
                  <Tabs.Tab id="overview">
                    Overview
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="generation">
                    Generation
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="sources">
                    Sources
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
              <Tabs.Panel id="overview" className="detail-tab">
                <section>
                  <h3>Plant capacity</h3>
                  <Row
                    label="Operable nameplate"
                    value={`${format(p.nameplate_mw)} MW`}
                  />
                  <Row
                    label="In-service units (OP)"
                    value={`${format(p.operating_mw)} MW`}
                  />
                  <Row
                    label="Storage, included above"
                    value={`${format(p.storage_mw)} MW`}
                  />
                  <Row
                    label="Proposed, separate"
                    value={`${format(p.proposed_mw)} MW`}
                  />
                  <Row
                    label="Retired, separate"
                    value={`${format(p.retired_mw)} MW`}
                  />
                  <p className="explanation">
                    Operable includes operating, standby and temporarily
                    out-of-service units. Proposed and retired units do not
                    increase the headline capacity.
                  </p>
                  <h3>Capacity by source</h3>
                  {p.fuel_capacity.map((f) => (
                    <div className="fuel-row" key={f.fuel}>
                      <i style={{ background: FUEL_COLORS[f.fuel] }} />
                      <span>{f.fuel}</span>
                      <strong>{format(f.capacity_mw)} MW</strong>
                    </div>
                  ))}
                  {p.nameplate_mw === 0 && (
                    <p className="explanation">
                      Source breakdown refers to proposed or historical units
                      because no operable capacity is reported.
                    </p>
                  )}
                </section>
                <section>
                  <h3>Ownership</h3>
                  <p className="explanation">
                    Shares are weighted by operable unit nameplate capacity.
                    Operator: {p.operator_name ?? 'not reported'}.
                  </p>
                  {p.owners.length ? (
                    p.owners.map((o) => (
                      <Row
                        key={o.id}
                        label={o.name}
                        value={
                          <>
                            {o.plant_capacity_percent == null
                              ? 'Share uncertain'
                              : `${format(o.plant_capacity_percent)}%`}
                            <small>{format(o.attributed_mw)} MW</small>
                          </>
                        }
                      />
                    ))
                  ) : (
                    <p className="empty-note">
                      Ownership was not established from the supplied records.
                    </p>
                  )}
                  <p className="explanation">
                    Coverage:{' '}
                    {p.ownership_coverage_percent == null
                      ? 'not available'
                      : `${format(p.ownership_coverage_percent)}%`}{' '}
                    · {p.ownership_status}. Unreported ownership is left
                    unassigned.
                  </p>
                </section>
                <section>
                  <h3>Location & construction</h3>
                  <Row
                    label="Location"
                    value={[p.city, p.county, p.state]
                      .filter(Boolean)
                      .join(', ')}
                  />
                  <Row label="Address" value={p.address} />
                  <Row
                    label="Coordinates"
                    value={
                      p.latitude != null && p.longitude != null
                        ? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`
                        : 'Unavailable / under review'
                    }
                  />
                  <Row
                    label="First unit commissioned"
                    value={p.first_operating_year}
                  />
                  <Row
                    label="Latest operable unit commissioned"
                    value={p.latest_operating_year}
                  />
                  <Row
                    label="Balancing authority"
                    value={p.balancing_authority}
                  />
                  <Row label="NERC region" value={p.nerc_region} />
                  <p className="explanation">
                    Commissioning years describe units. A single plant
                    construction date or construction cost is not inferred.
                  </p>
                </section>
                <Disclosure
                  className="unit-details"
                  title={
                    <>
                      <Factory size={15} />
                      Supporting unit records ({detail.generators.length})
                    </>
                  }
                >
                  <p className="explanation">
                    These units belong to this plant and are not separate map
                    entries.
                  </p>
                  {detail.generators.map((g) => (
                    <div className="unit-card" key={g.generator_id}>
                      <strong>
                        Unit {g.generator_id} · {format(g.nameplate_mw)} MW
                      </strong>
                      <p>
                        {g.technology} · {g.status}
                      </p>
                      <Row label="Operating year" value={g.operating_year} />
                      {g.planned_operating_year && (
                        <Row
                          label="Planned commissioning"
                          value={g.planned_operating_year}
                        />
                      )}
                      {g.retirement_year && (
                        <Row label="Retired" value={g.retirement_year} />
                      )}
                      {g.planned_retirement_year && (
                        <Row
                          label="Planned retirement"
                          value={g.planned_retirement_year}
                        />
                      )}
                      <Row
                        label="Reported fuels"
                        value={
                          g.fuels
                            .map((f) => `${f.fuel_code} (${f.role})`)
                            .join(', ') || 'Not reported'
                        }
                      />
                      {g.owners.map((o, i) => (
                        <Row
                          key={i}
                          label={o.name}
                          value={`${format(o.fraction * 100)}%`}
                        />
                      ))}
                    </div>
                  ))}
                </Disclosure>
              </Tabs.Panel>
              <Tabs.Panel id="generation" className="detail-tab">
                <section>
                  <GenerationChart values={m.monthly_generation_mwh} />
                  <Row
                    label="Annual net generation"
                    value={
                      m.net_generation_mwh == null
                        ? 'Not reported'
                        : `${format(m.net_generation_mwh)} MWh`
                    }
                  />
                  <Row
                    label="Capacity factor¹"
                    value={percent(m.capacity_factor)}
                  />
                  <Row
                    label="Capacity-hours denominator"
                    value={
                      m.capacity_hours_mwh == null
                        ? 'Not available'
                        : `${format(m.capacity_hours_mwh)} MWh`
                    }
                  />
                  <p className="explanation">
                    ¹ Net generation ÷ non-storage nameplate capacity-hours.
                    Commissioning and retirement months are included in full.
                    Dates are only precise to the month, and within-year
                    capacity changes are not reconstructed. This is an estimate
                    using nameplate capacity, not EIA’s published net-summer
                    capacity factor.
                  </p>
                  <p className="explanation">
                    Missing values remain missing. Negative generation is
                    retained. Reported frequency:{' '}
                    {m.reporting_frequencies.join(', ') || 'not reported'} (A =
                    annual, M = monthly). Monthly figures may include EIA
                    estimates for annual respondents.
                  </p>
                </section>
                {(p.storage_mw > 0 || m.storage_net_generation_mwh != null) && (
                  <section>
                    <h3>Energy storage</h3>
                    <Row
                      label="Gross discharge"
                      value={
                        m.storage_gross_generation_mwh == null
                          ? 'Not reported'
                          : `${format(m.storage_gross_generation_mwh)} MWh`
                      }
                    />
                    <Row
                      label="Net storage generation"
                      value={
                        m.storage_net_generation_mwh == null
                          ? 'Not reported'
                          : `${format(m.storage_net_generation_mwh)} MWh`
                      }
                    />
                    <p className="explanation">
                      Storage is separate from the generation capacity factor.
                      Charging and losses can make net storage generation
                      negative.
                    </p>
                    <GenerationChart
                      values={m.monthly_storage_net_mwh}
                      storage
                    />
                  </section>
                )}
              </Tabs.Panel>
              <Tabs.Panel id="sources" className="detail-tab">
                <section>
                  <h3>Data quality notes ({detail.issues.length})</h3>
                  {detail.issues.length ? (
                    detail.issues.map((issue, i) => (
                      <Disclosure
                        className="source-record"
                        key={i}
                        title={`${issue.code.replaceAll('_', ' ')}${issue.generator_id ? ` · unit ${issue.generator_id}` : ''}`}
                      >
                        {Object.entries(issue.context).map(([key, value]) => (
                          <Row
                            key={key}
                            label={key.replaceAll('_', ' ')}
                            value={String(value)}
                          />
                        ))}
                      </Disclosure>
                    ))
                  ) : (
                    <p className="explanation">
                      No plant-specific consistency issues detected by this
                      import.
                    </p>
                  )}
                </section>
                <SourceData plantId={plant.id} sources={detail.sources} />
                <p className="explanation">
                  <a
                    href="https://www.eia.gov/electricity/data/eia860/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    EIA-860 <ExternalLink size={11} />
                  </a>{' '}
                  ·{' '}
                  <a
                    href="https://www.eia.gov/electricity/data/eia923/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    EIA-923 <ExternalLink size={11} />
                  </a>
                </p>
              </Tabs.Panel>
            </Tabs>
          </>
        )}
      </div>
    </aside>
  )
}
