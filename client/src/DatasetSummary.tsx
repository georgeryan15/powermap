import { useMemo } from 'react'
import { Card, Popover, Button } from '@heroui/react'
import { ArrowUpRight, Info, MapPin } from 'lucide-react'
import type { Dataset, Plant } from './plants'
import { format } from './plants'
import { AppleBarChart } from './AppleCharts'

export function DatasetInfo({ dataset }: { dataset: Dataset | null }) {
  return (
    <Popover>
      <Button
        variant="tertiary"
        size="sm"
        className="data-info-button"
        aria-label="About this dataset"
      >
        <Info size={14} />
        <span>Early release</span>
      </Button>
      <Popover.Content className="dataset-popover">
        <Popover.Dialog>
          <h2>About the data</h2>
          <p>
            {dataset?.warning ||
              '2025 early release data. Plant-level records may be incomplete; not suitable for state, regional or national totals.'}
          </p>
          <p>
            Annual reporting from EIA-860 and EIA-923. This is not live power
            output.
          </p>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}

export function DatasetSummary({
  plants,
  visible,
  dataset,
  loading,
  error,
  onFuelSelect,
}: {
  plants: Plant[]
  visible: Plant[]
  dataset: Dataset | null
  loading: boolean
  error: string | null
  onFuelSelect: (fuel: string) => void
}) {
  const sources = useMemo(() => {
    const counts = new Map<string, number>()
    for (const plant of visible)
      counts.set(plant.primary_fuel, (counts.get(plant.primary_fuel) ?? 0) + 1)
    const short: Record<string, string> = {
      'Natural gas': 'Gas',
      'Pumped storage': 'Pumped',
      'Other storage': 'Storage',
      'Other gas': 'Other gas',
      Geothermal: 'Geo',
      Petroleum: 'Oil',
    }
    return [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([fuel, value]) => ({
        label: short[fuel] ?? fuel,
        fullLabel: fuel,
        value,
      }))
  }, [visible])
  return (
    <Card className="dataset-summary floating-surface">
      <Card.Header className="summary-heading">
        <div>
          <span className="eyebrow">The national catalogue</span>
          <Card.Title>Power, in perspective</Card.Title>
        </div>
      </Card.Header>
      <Card.Content>
        <div className="catalogue-total">
          <strong>{loading || error ? '—' : format(plants.length, 0)}</strong>
          <span>power plants in the catalogue</span>
        </div>
        <div className="summary-stats">
          <div>
            <MapPin size={13} />
            <span>Mapped plants</span>
            <strong>
              {dataset ? format(dataset.report.mapped_plants, 0) : '—'}
            </strong>
          </div>
          <div>
            <ArrowUpRight size={13} />
            <span>With generation</span>
            <strong>
              {dataset ? format(dataset.report.plants_with_generation, 0) : '—'}
            </strong>
          </div>
        </div>
        <div className="chart-heading">
          <span>Leading sources</span>
          <span>Plant count</span>
        </div>
        {sources.length > 0 ? (
          <AppleBarChart
            data={sources}
            unit="plants"
            label="Plant counts by primary source. Select a bar to filter plants."
            onSelect={(index) => onFuelSelect(sources[index].fullLabel)}
          />
        ) : (
          <p className="summary-empty">
            {loading
              ? 'Loading source breakdown…'
              : error
                ? 'Catalogue unavailable'
                : 'No matching sources'}
          </p>
        )}
        <p className="chart-footnote">
          {visible.length !== plants.length
            ? 'Based on your filtered plants.'
            : 'Top sources by primary fuel.'}{' '}
          Each plant is counted once.
        </p>
      </Card.Content>
      <Card.Footer className="summary-footer">
        <Info size={13} />
        <span>2025 early release · Plant-level records</span>
      </Card.Footer>
    </Card>
  )
}
