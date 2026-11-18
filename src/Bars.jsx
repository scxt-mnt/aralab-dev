export function VBars({ data, height = 150 }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div className="vbars" style={{ height }}>
      {data.map(d => (
        <div key={d.label} className="vbar-col" title={d.text}>
          <small>{d.value ? d.text : ''}</small>
          <div className="vbar-track"><div className="vbar-fill" style={{ height: `${(d.value / max) * 100}%`, background: d.color }} /></div>
          <small>{d.label}</small>
        </div>))}
    </div>
  )
}
