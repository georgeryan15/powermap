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
const mapStyle = 'mapbox://styles/mapbox/standard'
const lightPreset = (theme: 'light' | 'dark') =>
  theme === 'dark' ? 'night' : 'day'
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
}: {
  plants: Plant[]
  selected: Plant | null
  theme: 'light' | 'dark'
  onSelect: (id: number) => void
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<mapboxgl.Map | null>(null)
  const latest = useRef({ plants, selected, theme, onSelect })
  latest.current = { plants, selected, theme, onSelect }
  const appliedTheme = useRef(theme)
  const [hover, setHover] = useState<Plant | null>(null),
    [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!token || !container.current) return
    const instance = new mapboxgl.Map({
      container: container.current,
      accessToken: token,
      style: mapStyle,
      config: {
        basemap: { lightPreset: lightPreset(latest.current.theme) },
      },
      bounds,
      fitBoundsOptions: { padding: 40 },
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
    const observer = new ResizeObserver(() => instance.resize())
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
            latest.current.theme === 'dark' ? '#2e3444' : '#27334d',
          'circle-radius': 16,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(135,147,167,0.33)',
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
        },
        paint: { 'text-color': '#ffffff' },
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
            latest.current.theme === 'dark' ? '#11151f' : '#ffffff',
        },
      })
      instance.addLayer({
        id: 'selected',
        type: 'circle',
        source: 'plants',
        filter: ['==', ['get', 'id'], latest.current.selected?.id ?? -1],
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
      m.setConfigProperty('basemap', 'lightPreset', lightPreset(theme))
      if (m.getLayer('clusters'))
        m.setPaintProperty(
          'clusters',
          'circle-color',
          theme === 'dark' ? '#2e3444' : '#27334d',
        )
      if (m.getLayer('points'))
        m.setPaintProperty(
          'points',
          'circle-stroke-color',
          theme === 'dark' ? '#11151f' : '#ffffff',
        )
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
    if (m.getLayer('selected'))
      m.setFilter('selected', ['==', ['get', 'id'], selected?.id ?? -1])
    if (selected?.latitude != null && selected.longitude != null)
      m.easeTo({
        center: [selected.longitude, selected.latitude],
        zoom: Math.max(m.getZoom(), 7),
        duration: 600,
      })
  }, [selected])
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
          onPress={() => map.current?.fitBounds(bounds, { padding: 40 })}
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
