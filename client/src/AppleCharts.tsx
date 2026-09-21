import { useState } from 'react'
import { Button, Tooltip } from '@heroui/react'
import {
  Bar,
  BarChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import type { BarShapeProps } from 'recharts'
import { Disclosure } from './AppleUI'
import { format } from './plants'
import { MONTHS, chartDomain, monthlySeries } from './chartData'

type Point = { label: string; value: number | null; fullLabel?: string }

/** Recharts geometry with the playground's rounded marks, labels and HeroUI tooltips. */
export function AppleBarChart({
  data,
  unit,
  label,
  color = 'var(--apple-chart-blue)',
  onSelect,
}: {
  data: Point[]
  unit: string
  label: string
  color?: string
  onSelect?: (index: number) => void
}) {
  const [active, setActive] = useState<number | null>(null)
  return (
    <div className="apple-bar-chart" role="group" aria-label={label}>
      <ResponsiveContainer width="100%" height={180} minWidth={0}>
        <BarChart
          data={data}
          margin={{ top: 24, right: 0, left: 0, bottom: 0 }}
          barCategoryGap="14%"
          accessibilityLayer={false}
        >
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            interval={0}
            height={28}
            tickMargin={10}
            tick={{
              fill: 'var(--apple-muted)',
              fontSize: data.length > 7 ? 9 : 11,
            }}
          />
          <YAxis hide domain={chartDomain(data.map((point) => point.value))} />
          <ReferenceLine y={0} stroke="var(--apple-rule)" />
          <Bar
            dataKey="value"
            isAnimationActive={false}
            shape={(props: BarShapeProps) => {
              const { x, y, width, height, index } = props
              const point = data[index]
              if (point?.value == null) return <g />
              const top = Math.min(y, y + height)
              const h = Math.max(Math.abs(height), point.value === 0 ? 1 : 0)
              const focused = active === index
              const faded = active !== null && !focused
              return (
                <g>
                  <rect
                    x={x}
                    y={top}
                    width={width}
                    height={h}
                    rx={Math.min(5, h / 2)}
                    fill={color}
                    opacity={faded ? 0.35 : 1}
                  />
                  {focused && (
                    <rect
                      x={x - 1.5}
                      y={top - 1.5}
                      width={width + 3}
                      height={h + 3}
                      rx={6}
                      fill="none"
                      stroke="var(--apple-ink)"
                      strokeWidth={1}
                    />
                  )}
                  <text
                    x={x + width / 2}
                    y={top - 8}
                    textAnchor="middle"
                    fill={focused ? 'var(--apple-ink)' : 'var(--apple-subtle)'}
                    fontSize={data.length > 7 ? 9 : 11}
                    opacity={faded ? 0.45 : 1}
                  >
                    {Intl.NumberFormat('en-US', {
                      notation: 'compact',
                      maximumSignificantDigits: 2,
                    }).format(point.value)}
                  </text>
                </g>
              )
            }}
          />
        </BarChart>
      </ResponsiveContainer>
      <div className="chart-bands">
        {data.map((point, index) => (
          <Tooltip
            key={point.label}
            delay={0}
            closeDelay={0}
            onOpenChange={(open) =>
              setActive((previous) =>
                open ? index : previous === index ? null : previous,
              )
            }
          >
            <Button
              variant="tertiary"
              className="chart-band"
              aria-label={`${point.fullLabel ?? point.label}: ${point.value == null ? 'Not reported' : `${format(point.value, 3)} ${unit}`}${onSelect ? '. Filter by this source' : ''}`}
              style={{
                left: `${(index * 100) / data.length}%`,
                width: `${100 / data.length}%`,
              }}
              onPress={onSelect ? () => onSelect(index) : undefined}
            />
            <Tooltip.Content
              placement="top"
              offset={4}
              className="apple-tooltip"
            >
              <strong>{point.fullLabel ?? point.label}</strong>
              <span>
                {point.value == null
                  ? 'Not reported'
                  : `${format(point.value, 3)} ${unit}`}
              </span>
            </Tooltip.Content>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}

export function GenerationChart({
  values,
  storage = false,
}: {
  values: (number | null)[]
  storage?: boolean
}) {
  const { data, unit } = monthlySeries(values)
  return (
    <div className="generation-chart">
      {data.every((p) => p.value == null) ? (
        <p className="empty-note">Monthly generation was not reported.</p>
      ) : (
        <>
          <div className="chart-heading">
            <span>Monthly net {storage ? 'storage' : 'generation'}</span>
            <span>{unit} · 2025</span>
          </div>
          <AppleBarChart
            data={data}
            unit={unit}
            label={`Monthly net ${storage ? 'storage' : 'generation'}, 2025. Focus a month for its value.`}
            color={storage ? 'var(--apple-phev)' : undefined}
          />
        </>
      )}
      <Disclosure title="Monthly values · MWh">
        <div className="month-table">
          {MONTHS.map((month, i) => (
            <div className="detail-row" key={month}>
              <span>{month}</span>
              <strong>{format(values[i])}</strong>
            </div>
          ))}
        </div>
      </Disclosure>
    </div>
  )
}
