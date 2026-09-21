import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import type { ExpressionSpecification, GeoJSONSource } from 'mapbox-gl'
import type { FeatureCollection, Point } from 'geojson'
import { Button, ButtonGroup } from '@heroui/react'
import { LocateFixed, Minus, Plus } from 'lucide-react'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Plant } from './plants'
import { FUEL_COLORS, format } from './plants'
const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
const bounds: [[number, number], [number, number]] = [
  [-125.5, 24.2],
  [-66.4, 49.8],
]
const mapStyle = (theme: 'light' | 'dark') =>
  theme === 'dark'
    ? 'mapbox://styles/mapbox/dark-v11'
    : 'mapbox://styles/mapbox/streets-v12'

function viewportPadding(browserOpen: boolean, detailOpen: boolean) {
  const width = window.innerWidth
  if (width <= 640)
    return {
      top: 100,
      bottom:
        browserOpen && !detailOpen
          ? Math.min(window.innerHeight * 0.6 + 40, window.innerHeight - 180)
          : 80,
      left: 25,
      right: 50,
    }
  const browserWidth = width >= 1600 ? 380 : width > 1200 ? 360 : 330
  const detailWidth = width >= 1600 ? 480 : width > 1200 ? 454 : 414
  return {
    top: 130,
    bottom: 170,
    left: browserOpen && !(detailOpen && width <= 960) ? browserWidth + 48 : 48,
    right: detailOpen
      ? detailWidth + 48
      : width > 960
        ? width > 1200
          ? 328
          : 304
        : 60,
  }
}
const colors = [
  'match',
  ['get', 'fuel'],
  ...Object.entries(FUEL_COLORS).flat(),
  '#8b93a7',
] as ExpressionSpecification
function geojson(plants: Plant[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: plants
      .filter((p) => p.latitude != null && p.longitude != null)
      .map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.longitude!, p.latitude!] },
        properties: { id: p.id, fuel: p.primary_fuel },
      })),
  }
}
export function PlantMap({
  plants,
  selected,
  theme,
  onSelect,
  browserOpen,
}: {
  plants: Plant[]
  selected: Plant | null
  theme: 'light' | 'dark'
  onSelect: (id: number) => void
  browserOpen: boolean
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<mapboxgl.Map | null>(null)
  const latest = useRef({ plants, selected, theme, onSelect, browserOpen })
  latest.current = { plants, selected, theme, onSelect, browserOpen }
  const appliedTheme = useRef(theme)
  const [hover, setHover] = useState<Plant | null>(null),
    [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!token || !container.current) return
    const instance = new mapboxgl.Map({
      container: container.current,
      accessToken: token,
      style: mapStyle(latest.current.theme),
      bounds,
      fitBoundsOptions: {
        padding: viewportPadding(
          latest.current.browserOpen,
          !!latest.current.selected,
        ),
      },
      minZoom: 1,
      maxZoom: 15,
      attributionControl: false,
    })
    map.current = instance
    appliedTheme.current = latest.current.theme
    instance.addControl(
      new mapboxgl.AttributionControl({ compact: true }),
      'bottom-right',
    )
    const observer = new ResizeObserver(() => {
      instance.resize()
      instance.setPadding(
        viewportPadding(latest.current.browserOpen, !!latest.current.selected),
      )
    })
    observer.observe(container.current)
    instance.on('error', (event) => {
      if (map.current !== instance) return
      console.warn('Map data error:', event.error.message)
      setError(
        'Some map data could not load. The plant list is still available.',
      )
    })
    instance.on('idle', () => {
      if (
        map.current === instance &&
        instance.getSource('plants') &&
        instance.isSourceLoaded('plants')
      )
        setError(null)
    })
    instance.on('style.load', () => {
      if (map.current !== instance) return
      setError(null)
      if (instance.getSource('plants')) return
      instance.addSource('plants', {
        type: 'geojson',
        data: geojson(latest.current.plants),
        cluster: true,
        clusterRadius: 44,
        clusterMaxZoom: 9,
      })
      instance.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'plants',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color':
            latest.current.theme === 'dark' ? '#e5e5ea' : '#ffffff',
          'circle-radius': 16,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(115,115,115,0.25)',
        },
      })
      instance.addLayer({
        id: 'counts',
        type: 'symbol',
        source: 'plants',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 11,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#1d1d1f' },
      })
      instance.addLayer({
        id: 'points',
        type: 'circle',
        source: 'plants',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': colors,
          'circle-radius': 5,
          'circle-stroke-width': 1.5,
          'circle-stroke-color':
            latest.current.theme === 'dark' ? '#1c1c1e' : '#ffffff',
        },
      })
      instance.addSource('selected-plant', {
        type: 'geojson',
        data: geojson(latest.current.selected ? [latest.current.selected] : []),
      })
      instance.addLayer({
        id: 'selected',
        type: 'circle',
        source: 'selected-plant',
        paint: {
          'circle-radius': 10,
          'circle-opacity': 0,
          'circle-stroke-width': 2,
          'circle-stroke-color': colors,
        },
      })
    })
    instance.on('click', 'points', (e) => {
      const id = Number(e.features?.[0]?.properties?.id)
      if (id) latest.current.onSelect(id)
      setHover(null)
    })
    instance.on('click', 'clusters', (e) => {
      const f = e.features?.[0]
      if (!f) return
      const source = instance.getSource('plants') as GeoJSONSource
      source.getClusterExpansionZoom(
        Number(f.properties?.cluster_id),
        (err, zoom) => {
          if (!err && zoom != null)
            instance.easeTo({
              center: (f.geometry as Point).coordinates as [number, number],
              zoom,
            })
        },
      )
    })
    instance.on('mousemove', 'points', (e) =>
      setHover(
        latest.current.plants.find(
          (p) => p.id === Number(e.features?.[0]?.properties?.id),
        ) ?? null,
      ),
    )
    instance.on('mouseleave', 'points', () => setHover(null))
    instance.on('dragstart', () => setHover(null))
    for (const layer of ['points', 'clusters']) {
      instance.on('mouseenter', layer, () => {
        instance.getCanvas().style.cursor = 'pointer'
      })
      instance.on('mouseleave', layer, () => {
        instance.getCanvas().style.cursor = ''
      })
    }
    return () => {
      observer.disconnect()
      map.current = null
      instance.remove()
    }
  }, [])
  useEffect(() => {
    const m = map.current
    if (m && appliedTheme.current !== theme) {
      appliedTheme.current = theme
      m.setStyle(mapStyle(theme), {
        diff: false,
        localFontFamily: undefined,
        localIdeographFontFamily: undefined,
      })
    }
  }, [theme])
  useEffect(() => {
    ;(map.current?.getSource('plants') as GeoJSONSource | undefined)?.setData(
      geojson(plants),
    )
  }, [plants])
  useEffect(() => {
    const m = map.current
    if (!m) return
    ;(m.getSource('selected-plant') as GeoJSONSource | undefined)?.setData(
      geojson(selected ? [selected] : []),
    )
    if (selected?.latitude != null && selected.longitude != null)
      m.easeTo({
        center: [selected.longitude, selected.latitude],
        zoom: Math.max(m.getZoom(), 7),
        duration: matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 0
          : 600,
        padding: viewportPadding(browserOpen, true),
      })
    else
      m.easeTo({
        padding: viewportPadding(browserOpen, !!selected),
        duration: 0,
      })
  }, [selected, browserOpen])
  return (
    <div className="plant-map">
      <div
        ref={container}
        className="absolute inset-0 size-full"
        role="region"
        aria-label="Power plant map. Choose plants using the adjacent searchable list."
      />
      {(!token || error) && (
        <div className="map-message">
          <p>
            {error ||
              'The map is unavailable. Browse and open plants in the list.'}
          </p>
        </div>
      )}
      <div className="map-controls">
        <ButtonGroup orientation="vertical" size="sm" variant="secondary">
          <Button
            isIconOnly
            aria-label="Zoom in"
            onPress={() => map.current?.zoomIn()}
          >
            <Plus size={16} />
          </Button>
          <Button
            isIconOnly
            aria-label="Zoom out"
            onPress={() => map.current?.zoomOut()}
          >
            <Minus size={16} />
          </Button>
        </ButtonGroup>
        <Button
          isIconOnly
          size="sm"
          variant="secondary"
          aria-label="Fit contiguous United States"
          onPress={() =>
            map.current?.fitBounds(bounds, {
              padding: viewportPadding(browserOpen, !!selected),
              duration: matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 0
                : 600,
            })
          }
        >
          <LocateFixed size={16} />
        </Button>
      </div>
      {hover && (
        <div className="map-hover">
          <span className="eyebrow">
            EIA plant {hover.id} · {hover.state}
          </span>
          <strong>{hover.name}</strong>
          <p>
            {hover.primary_fuel} · {format(hover.nameplate_mw)} MW nameplate
          </p>
          <p>{hover.operable_unit_count} operable units · Click for details</p>
        </div>
      )}
      <div className="map-caption">
        One marker per plant · Colour shows largest capacity source
      </div>
    </div>
  )
}
