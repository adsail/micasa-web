import React from 'react'
import {
  ResponsiveContainer,
  Sankey,
  Tooltip,
  Layer,
  Rectangle,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts'
import { api } from '../api'
import { Card, Stat, Spinner, ErrorBox, Empty, SectionTitle } from './ui'
import { money, fmtDate } from '../format'

const PERIODS = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_year', label: 'This year' },
  { id: 'last_year', label: 'Last year' },
  { id: 'trailing_12', label: 'Trailing 12 months' },
]

// Watch the <html class="dark"> toggle so recharts (inline colors) re-themes.
function useIsDark() {
  const [dark, setDark] = React.useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )
  React.useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() =>
      setDark(el.classList.contains('dark'))
    )
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

// Theme tokens for charts, keyed to the app's split-personality palette.
function chartTheme(dark) {
  return dark
    ? {
        outflow: '#4D9EFF', // cursor accent
        fixed: '#4D9EFF',
        variable: '#8C6D5E', // chocolate reads fine on dark too
        // per-category ordering matches sorted-by-name from the API series
        cats: ['#4D9EFF', '#D4B385', '#A5594E', '#C07B70', '#8C6D5E'],
        link: 'rgba(77,158,255,0.22)',
        node: '#1C1C1C',
        text: '#F0F0F0',
        subtext: '#A0A0A0',
        grid: '#2A2A2A',
        tooltipBg: '#1C1C1C',
        tooltipBorder: '#2A2A2A',
      }
    : {
        outflow: '#A5594E', // sienna
        fixed: '#A5594E',
        variable: '#8C6D5E', // chocolate
        cats: ['#A5594E', '#D4B385', '#8C6D5E', '#C49A68', '#B5665A'],
        link: 'rgba(165,89,78,0.18)',
        node: '#8C6D5E',
        text: '#5E483F',
        subtext: '#8F8578',
        grid: '#D9D6CF',
        tooltipBg: '#ffffff',
        tooltipBorder: '#C3BDB1',
      }
}

function money0(cents) {
  return money(cents == null ? null : { dollars: Math.round((cents || 0) / 100) })
}

// value already in whole dollars (used by Sankey nodes + chart tooltips)
function money0d(dollars) {
  return money(dollars == null ? null : { dollars: Math.round(dollars || 0) })
}

function ChartTooltip({ active, payload, theme }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        background: theme.tooltipBg,
        border: `1px solid ${theme.tooltipBorder}`,
        color: theme.text,
      }}
    >
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: p.color || p.fill }}
          />
          <span>{p.name}:</span>
          <span className="font-semibold">{money0d(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// Custom Sankey node: labelled with name + amount.
function SankeyNode({ x, y, width, height, index, payload, theme }) {
  const isSource = payload.depth === 0
  const labelX = isSource ? x + width + 8 : x - 8
  const anchor = isSource ? 'start' : 'end'
  return (
    <Layer key={`node-${index}`}>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={payload.color}
        fillOpacity={0.95}
        radius={2}
      />
      {height > 10 && (
        <text
          x={labelX}
          y={y + height / 2}
          textAnchor={anchor}
          dominantBaseline="middle"
          fontSize={12}
          fontWeight={600}
          fill={theme.text}
        >
          {payload.name}
          <tspan fill={theme.subtext} fontWeight={400}>
            {'  '}
            {money0d(payload.value)}
          </tspan>
        </text>
      )}
    </Layer>
  )
}

function SankeyLink(props) {
  const { sourceX, sourceY, sourceControlX, targetControlX, targetX, targetY, linkWidth, theme } =
    props
  return (
    <path
      d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={theme.link}
      strokeWidth={Math.max(1, linkWidth)}
      strokeOpacity={1}
    />
  )
}

function BurnSankey({ summary, theme }) {
  const cats = (summary.by_category || []).filter((c) => (c.total_cents || 0) > 0)
  if (!cats.length) return <Empty>No spend in this period.</Empty>

  const nodes = [{ name: 'Total Outflow', color: theme.outflow }]
  cats.forEach((c, i) => {
    nodes.push({ name: c.category_name, color: theme.cats[i % theme.cats.length] })
  })
  const links = cats.map((c, i) => ({
    source: 0,
    target: i + 1,
    value: Math.max(1, Math.round((c.total_cents || 0) / 100)),
  }))

  return (
    <ResponsiveContainer width="100%" height={40 + cats.length * 64}>
      <Sankey
        data={{ nodes, links }}
        nodePadding={26}
        nodeWidth={14}
        margin={{ top: 10, bottom: 10, left: 8, right: 8 }}
        link={<SankeyLink theme={theme} />}
        node={<SankeyNode theme={theme} />}
      >
        <Tooltip content={<ChartTooltip theme={theme} />} />
      </Sankey>
    </ResponsiveContainer>
  )
}

function TrendChart({ series, theme }) {
  const data = (series.months || [])
    .filter((m) => (m.total_cents || 0) > 0)
    .map((m) => ({
      month: m.month,
      Fixed: Math.round((m.fixed_cents || 0) / 100),
      Variable: Math.round((m.variable_cents || 0) / 100),
    }))
  if (!data.length) return <Empty>No monthly history yet.</Empty>
  const fmtMonth = (s) => {
    const d = new Date(s + 'T00:00:00')
    return isNaN(d) ? s : d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  }
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={fmtMonth}
          tick={{ fill: theme.subtext, fontSize: 11 }}
          axisLine={{ stroke: theme.grid }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          tick={{ fill: theme.subtext, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          content={<ChartTooltip theme={theme} />}
          cursor={{ fill: theme.grid, fillOpacity: 0.3 }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: theme.text }} />
        <Bar dataKey="Fixed" stackId="a" fill={theme.fixed} radius={[0, 0, 0, 0]} />
        <Bar dataKey="Variable" stackId="a" fill={theme.variable} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function SplitBar({ fixed, variable, theme }) {
  const total = (fixed || 0) + (variable || 0)
  if (!total) return null
  const fpct = Math.round((fixed / total) * 100)
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-calm dark:bg-cursor-elevated">
        <div style={{ width: `${fpct}%`, background: theme.fixed }} />
        <div style={{ width: `${100 - fpct}%`, background: theme.variable }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-shale-500 dark:text-cursor-muted">
        <span>Fixed {fpct}%</span>
        <span>Variable {100 - fpct}%</span>
      </div>
    </div>
  )
}

export default function OpExTab() {
  const [period, setPeriod] = React.useState('trailing_12')
  const [s, setS] = React.useState({ loading: true })
  const [series, setSeries] = React.useState(null)
  const dark = useIsDark()
  const theme = React.useMemo(() => chartTheme(dark), [dark])

  React.useEffect(() => {
    let alive = true
    setS({ loading: true })
    api
      .opexSummary(period)
      .then((data) => alive && setS({ loading: false, data }))
      .catch((error) => alive && setS({ loading: false, error }))
    return () => {
      alive = false
    }
  }, [period])

  React.useEffect(() => {
    let alive = true
    api
      .opexSeries()
      .then((data) => alive && setSeries(data))
      .catch(() => alive && setSeries(null))
    return () => {
      alive = false
    }
  }, [])

  if (s.loading) return <Spinner />
  if (s.error) return <ErrorBox error={s.error} />

  const d = s.data || {}
  const periodLabel = PERIODS.find((p) => p.id === period)?.label || period

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>Home OpEx</SectionTitle>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="rounded-xl border border-shale/70 bg-white px-3.5 py-2 text-sm font-semibold text-chocolate shadow-sm transition focus:border-sienna focus:outline-none focus:ring-2 focus:ring-sienna/30 dark:border-cursor-border dark:bg-cursor-surface dark:text-cursor-text dark:focus:border-cursor-accent dark:focus:ring-cursor-accent/30"
        >
          {PERIODS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {d.no_data ? (
        <Empty>No OpEx data yet — run the Monarch pull to populate the snapshot.</Empty>
      ) : (
        <>
          {/* Headline burn rate */}
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-r from-calm-50 to-white p-6 dark:from-cursor-surface dark:to-cursor-surface">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-shale-500 dark:text-cursor-muted">
                Burn rate · {periodLabel}
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-4xl font-extrabold tracking-tight text-chocolate dark:text-cursor-text sm:text-5xl">
                  {money0(d.monthly_burn_cents)}
                </span>
                <span className="text-lg font-semibold text-shale-500 dark:text-cursor-muted">
                  / month
                </span>
                <span className="text-sm font-medium text-shale-500 dark:text-cursor-muted">
                  {money0(d.annualized_cents)} / yr annualized
                </span>
              </div>
              <div className="mt-2 text-xs text-shale-500 dark:text-cursor-muted">
                {money0(d.total_cents)} total over {d.months} month{d.months === 1 ? '' : 's'}
              </div>
            </div>
          </Card>

          {/* Fixed vs Variable */}
          <Card className="p-5">
            <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-shale-500">
              Fixed vs Variable
            </h3>
            <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Fixed" value={money0(d.fixed_cents)} sub="Mortgage + Insurance" />
              <Stat
                label="Variable"
                value={money0(d.variable_cents)}
                sub="Maint. + Improve. + Furniture"
              />
              <Stat label="Total" value={money0(d.total_cents)} sub={periodLabel} />
            </div>
            <SplitBar fixed={d.fixed_cents} variable={d.variable_cents} theme={theme} />
          </Card>

          {/* Sankey */}
          <Card className="p-5">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-shale-500">
              Where it goes · {periodLabel}
            </h3>
            <BurnSankey summary={d} theme={theme} />
          </Card>

          {/* Trend */}
          <Card className="p-5">
            <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-shale-500">
              Monthly burn over time
            </h3>
            {series ? <TrendChart series={series} theme={theme} /> : <Spinner />}
          </Card>

          {d.pulled_at && (
            <p className="text-center text-xs text-shale-500 dark:text-cursor-muted">
              Updated {fmtDate(d.pulled_at)}
            </p>
          )}
        </>
      )}
    </div>
  )
}
