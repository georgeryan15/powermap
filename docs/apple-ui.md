# Apple UI

PowerMap's visual reference is the Apple layout in the sibling HeroUIPlayground
project: `Playground.tsx`, `UtilizationCharts.tsx`, `EvAdoptionCard.tsx`, and
`SiteReportCard.tsx`. The light and dark `--apple-*` tokens are copied from that
project's `index.css` and mapped to HeroUI's semantic theme variables.

- `client/src/index.css` owns the theme, floating layouts, responsive breakpoints,
  and component styling. Portalled menus and tooltips inherit the same theme.
- `AppleUI.tsx` wraps HeroUI selects, accordions, and icon buttons. The plant
  browser also uses HeroUI SearchField, ListBox, ToggleButton, and Switch.
- `AppleCharts.tsx` uses Recharts for the bars and axes, with the reference's
  rounded marks, restrained labels, focus rings, and HeroUI tooltips. It renders
  live catalogue counts and reported monthly generation; no example data is used.
- `chartData.ts` keeps missing values distinct from zero, includes negative
  generation in the chart domain, and chooses MWh or GWh to keep labels readable.
- `theme.ts` follows the system appearance until the user chooses a theme, then
  persists it under the existing `powermap-theme` key. `index.html` applies it
  before React mounts to avoid an initial theme flash.

The map fills the viewport. Desktop cards float independently over it; on mobile
the browser becomes a bottom panel and details replace that panel. Hide the
browser to use the whole map, use Cmd/Ctrl+K to reopen search, and Escape to close
plant details. Map camera padding accounts for the floating panels. Selected
plants have an independent map source so they remain marked when clustered or
excluded by subsequent filters.

Run from the project root:

```sh
npm run build --prefix client
npm run lint --prefix client
npm run test --prefix client
```

The six chart tests cover signed ranges, zero and missing data, month alignment,
and unit conversions. Manual browser checks used the real API at desktop and
phone sizes in both themes, including filters, source records, negative generation
(Madelia), absent generation (Palisades), empty search, and keyboard navigation.
