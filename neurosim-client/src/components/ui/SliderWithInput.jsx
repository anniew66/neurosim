// components/ui/SliderWithInput.jsx
// Slider + text input.
// The slider always spans [value/rangeFactor, value*rangeFactor] (log) or
// [value - |value|, value + |value|] (linear) so it stays useful at any scale.
// absMin/absMax (also aliased as min/max) clamp what can be typed or slid to.

import { useState, useCallback } from 'react'

function toLog(v, lo, hi) {
  const a = Math.log10(Math.max(lo, 1e-15))
  const b = Math.log10(Math.max(hi, 1e-15))
  return (Math.log10(Math.max(v, 1e-15)) - a) / (b - a)
}
function fromLog(frac, lo, hi) {
  const a = Math.log10(Math.max(lo, 1e-15))
  const b = Math.log10(Math.max(hi, 1e-15))
  return Math.pow(10, a + frac * (b - a))
}

function autoFormat(v) {
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 10000) return v.toFixed(0)
  if (abs >= 1000)  return v.toFixed(1)
  if (abs >= 10)    return v.toFixed(3)
  if (abs >= 1)     return v.toFixed(4)
  if (abs >= 0.01)  return v.toFixed(5)
  if (abs >= 0.001) return v.toFixed(6)
  return v.toExponential(3)
}

export default function SliderWithInput({
  label,
  value,
  onChange,
  unit        = '',
  log         = false,
  format,
  // rangeSpan: slider covers value ± rangeSpan (linear).
  // Defaults to |value| so slider always spans ±100% of current value.
  rangeSpan   = null,
  // log mode: slider covers [value/rangeFactor, value*rangeFactor]
  rangeFactor = 20,
  // Absolute hard limits — accepted as either absMin/absMax OR min/max
  absMin, min,
  absMax, max,
  style = {},
}) {
  // Accept either naming convention
  const lo = absMin ?? min ?? -1e9
  const hi = absMax ?? max ??  1e9

  const [inputText, setInputText] = useState(null)

  const span     = rangeSpan !== null ? rangeSpan : (Math.abs(value) || 1)
  const sliderLo = log ? Math.max(lo, value / rangeFactor) : Math.max(lo, value - span)
  const sliderHi = log ? Math.min(hi, value * rangeFactor) : Math.min(hi, value + span + 1e-15)

  // Guard: if lo >= hi for log (e.g. value=0), fall back to linear
  const safeLog  = log && sliderLo > 0 && sliderHi > sliderLo

  const frac = safeLog
    ? toLog(value, sliderLo, sliderHi)
    : (sliderHi > sliderLo ? (value - sliderLo) / (sliderHi - sliderLo) : 0.5)

  const handleSlider = useCallback((e) => {
    const f    = Number(e.target.value)
    const next = safeLog
      ? fromLog(f, sliderLo, sliderHi)
      : sliderLo + f * (sliderHi - sliderLo)
    setInputText(null)
    onChange(Math.min(hi, Math.max(lo, next)))
  }, [safeLog, sliderLo, sliderHi, lo, hi, onChange])

  const commit = () => {
    if (inputText === null) return
    const parsed = parseFloat(inputText)
    if (!isNaN(parsed)) onChange(Math.min(hi, Math.max(lo, parsed)))
    setInputText(null)
  }

  const display = inputText !== null
    ? inputText
    : (format ? format(value) : autoFormat(value))

  return (
    <div style={{ marginBottom: 8, ...style }}>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between',
                      alignItems: 'baseline', marginBottom: 3 }}>
          <span className="ns-label" style={{ marginBottom: 0 }}>{label}</span>
          {unit && (
            <span style={{ fontSize: 10, color: 'var(--text-dim)',
                           fontFamily: 'var(--font-mono)' }}>{unit}</span>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="range" className="ns-slider"
          min={0} max={1} step={0.0005}
          value={isNaN(frac) ? 0.5 : Math.min(1, Math.max(0, frac))}
          onChange={handleSlider}
          style={{ flex: 1, minWidth: 0 }} />
        <input className="ns-input" type="text" inputMode="decimal"
          value={display}
          onChange={e => setInputText(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter')  { commit(); e.target.blur() }
            if (e.key === 'Escape') { setInputText(null) }
          }}
          style={{ width: 76, flexShrink: 0, fontFamily: 'var(--font-mono)',
                   fontSize: 11, textAlign: 'right' }} />
      </div>
    </div>
  )
}
