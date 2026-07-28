import React from 'react'
import { Card, Stat, SectionTitle } from './ui'
import { money, fmtNum, fmtDate, titleCase } from '../format'

function Group({ title, items }) {
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-shale-500">{title}</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
        {items.map(([label, value, sub]) => (
          <Stat key={label} label={label} value={value} sub={sub} />
        ))}
      </div>
    </Card>
  )
}

export default function HouseTab({ house }) {
  if (!house) return null
  const h = house
  const addr = [h.address_line1, h.address_line2].filter(Boolean).join(', ')
  return (
    <div className="space-y-6">
      <SectionTitle>House Profile</SectionTitle>
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-calm-50 to-white p-6 dark:from-cursor-surface dark:to-cursor-surface">
          <h2 className="text-2xl font-extrabold">{h.nickname}</h2>
          <p className="mt-1 text-shale-600 dark:text-cursor-muted">
            {addr}{addr && <br />}
            {h.city}, {h.state} {h.postal_code}
          </p>
        </div>
      </Card>

      <Group title="Overview" items={[
        ['Year Built', h.year_built],
        ['Bedrooms', h.bedrooms],
        ['Bathrooms', h.bathrooms],
        ['Living Area', h.square_feet ? `${fmtNum(h.square_feet)} sqft` : '—'],
        ['Lot Size', h.lot_square_feet ? `${fmtNum(h.lot_square_feet)} sqft` : '—'],
        ['Parking', h.parking_type],
      ]} />

      <Group title="Construction" items={[
        ['Foundation', h.foundation_type],
        ['Basement', h.basement_type],
        ['Roof', h.roof_type],
        ['Exterior', h.exterior_type],
        ['Wiring', h.wiring_type],
      ]} />

      <Group title="Systems" items={[
        ['Heating', h.heating_type],
        ['Cooling', h.cooling_type],
        ['Water', h.water_source],
        ['Sewer', h.sewer_type],
      ]} />

      <Group title="Financial" items={[
        ['Property Tax', money(h.property_tax_cents), 'per year'],
        ['Insurance Carrier', h.insurance_carrier],
        ['Policy #', h.insurance_policy],
        ['Insurance Renewal', fmtDate(h.insurance_renewal)],
        ['HOA', h.hoa_name && h.hoa_name !== 'N/A' ? h.hoa_name : 'None'],
        ['HOA Fee', h.hoa_fee_cents ? money(h.hoa_fee_cents) : '—'],
      ]} />
    </div>
  )
}
