export default function Donut({ data, center, size = 150 }) {
  const total = data.reduce((a, d) => a + d.value, 0), r = 52, c = 2 * Math.PI * r
  let acc = 0
  return (
    <div className="donut">
      <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label="Donut chart">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--track)" strokeWidth="20" />
        {total > 0 && data.map(d => {
          const len = (d.value / total) * c, off = -acc; acc += len
          return <circle key={d.label} cx="70" cy="70" r={r} fill="none" stroke={d.color} strokeWidth="20" strokeLinecap="round"
            strokeDasharray={`${Math.max(len - 4, 1)} ${c}`} strokeDashoffset={off} transform="rotate(-90 70 70)" />
        })}
        <text x="70" y="76" textAnchor="middle" className="donut-c">{center}</text>
      </svg>
      <ul>{data.slice(0, 6).map(d => <li key={d.label}><i style={{ background: d.color }} />{d.label}<b>{d.text ?? d.value}</b></li>)}</ul>
    </div>
  )
}
