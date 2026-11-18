export default function Ring({ value, max, label, sub, color = 'var(--acc)', size = 120 }) {
  const r = 46, c = 2 * Math.PI * r, p = max > 0 ? Math.min(value / max, 1) : 0
  return (
    <div className="ring">
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`${label}: ${Math.round(p * 100)}%`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--track)" strokeWidth="11" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round"
          strokeDasharray={`${p * c} ${c}`} transform="rotate(-90 60 60)" style={{ transition: 'stroke-dasharray .6s' }} />
        <text x="60" y="66" textAnchor="middle" className="donut-c">{Math.round(p * 100)}%</text>
      </svg>
      <b>{label}</b><small>{sub}</small>
    </div>
  )
}
