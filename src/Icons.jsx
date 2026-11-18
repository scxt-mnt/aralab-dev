// Inline SVG icon set (24x24, 1.8 stroke, rounded) so the app has no icon dependency and no emoji.
const P = {
  feed: <><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="5" rx="2" /><rect x="13" y="10" width="8" height="11" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /></>,
  library: <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />,
  sparkles: <path d="M11 3l1.8 4.7L17.5 9.500l-4.7 1.800L11 16l-1.8-4.700L4.5 9.500l4.7-1.800zM19 14l.8 2.200L22 17l-2.2.8L19 20l-.8-2.200L16 17l2.2-.8z" />,
  cap: <path d="M22 9L12 4 2 9l10 5zM6 11.500V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.500M22 9v6" />,
  chart: <path d="M3 3v18h18M8 17v-5M13 17V8M18 17v-3" />,
  flame: <path d="M12 2c.5 4 5 5.5 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.2 1.8 1 2.8 2 3 0-3-1-5.5 1-9.500z" />,
  thumb: <path d="M7 10v11H3V10zM7 10l4-8c1.7 0 3 1.3 3 3v4h5.500a2 2 0 0 1 2 2.300l-1.3 7A2 2 0 0 1 18.2 21H7" />,
  heart: <path d="M12 21s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.800A4.5 4.5 0 0 1 20 10c0 6.2-8 11-8 11z" />,
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.100L12 17l-5.4 2.9 1-6.100L3.2 9.500l6.1-.9z" />,
  zap: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  message: <path d="M21 12a8 8 0 0 1-11.5 7.200L3 21l1.8-5.500A8 8 0 1 1 21 12z" />,
  at: <><circle cx="12" cy="12" r="4" /><path d="M16 12v1a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.5 7.700" /></>,
  share: <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" />,
  repeat: <path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.700l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.700l1-1" />,
  edit: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM14 6l4 4" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  more: <><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-9 9" /></>,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  ghost: <path d="M5 21V11a7 7 0 0 1 14 0v10l-3.5-2.500L12 21l-3.5-2.500zM9.5 11h.01M14.5 11h.01" />,
  bell: <path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21a2 2 0 0 0 4 0" />,
  userplus: <><circle cx="10" cy="8" r="4" /><path d="M2 21a8 8 0 0 1 16 0M19 8v6M16 11h6" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  school: <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6M12 11h.01" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12l5 5L20 7" />,
  alert: <path d="M12 3l10 18H2zM12 10v4.500M12 17.500h.01" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  clip: <path d="M21 11l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />,
  megaphone: <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
  exam: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.500a2.5 2.5 0 1 1 3.5 2.300c-.7.4-1 .900-1 1.700M12 17h.01" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  bot: <><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4M9 14h.01M15 14h.01M2 14h2M20 14h2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  send: <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />,
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  pin: <><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  bulb: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.500c.8.8 1 1.5 1 2.500h6c0-1 .2-1.7 1-2.500A6 6 0 0 0 12 3z" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 7l9 6 9-6" /></>,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  pie: <path d="M21 12A9 9 0 1 1 12 3v9z" />,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /></>,
  bars: <path d="M5 20V12M12 20V5M19 20v-6" />,
  list: <path d="M4 6h16M4 12h16M4 18h10" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  moon: <path d="M20 14.500A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.500z" />,
  book: <path d="M5 4a2 2 0 0 1 2-2h12v17H7a2 2 0 0 0-2 2zM5 21V4M9 7h6" />,
  award: <><circle cx="12" cy="9" r="6" /><path d="M8.5 14L7 22l5-3 5 3-1.5-8" /></>,
  printer: <path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z" />,
  refresh: <path d="M21 12a9 9 0 1 1-3-6.700M21 4v5h-5" />,
  eye: <><path d="M2 12s3.600-7 10-7 10 7 10 7-3.600 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  sliders: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  home: <path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" />,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
  expand: <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />,
  shrink: <path d="M9 3v4a2 2 0 0 1-2 2H3M15 3v4a2 2 0 0 0 2 2h4M9 21v-4a2 2 0 0 0-2-2H3M15 21v-4a2 2 0 0 1 2-2h4" />,
  highlighter: <path d="M9 14l-4 4v3h3l4-4M14 4l6 6-7 7-6-6zM14 4l3-3 6 6-3 3M5 21h6" />,
  type: <path d="M4 6V4h16v2M12 4v16M8 20h8" />,
  volume: <path d="M4 9v6h4l5 4V5L8 9zM17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14" />,
  pause: <path d="M8 5v14M16 5v14" />,
  note: <path d="M4 4h16v12l-4 4H4zM16 20v-4h4M8 9h8M8 13h5" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" /></>,
}

export default function Icon({ name, size = 18, className = '', title, ...rest }) {
  const d = P[name]
  if (!d) return null
  return (
    <svg className={`ic ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} {...rest}>{d}</svg>
  )
}

// Reactions are icons now (the keys in the database stay the same).
export const REACTION_ICON = { like: 'thumb', love: 'heart', fire: 'flame', clap: 'star', wow: 'zap' }
export const REACTION_TONE = { like: '#5b6cf0', love: '#e5517a', fire: '#f08a3c', clap: '#e8b13a', wow: '#9a6bf0' }
export function ReactionIcon({ kind, size = 16, filled = false }) {
  return <span className="ric" style={{ color: REACTION_TONE[kind] }}><Icon name={REACTION_ICON[kind] || 'thumb'} size={size} style={filled ? { fill: 'currentColor', fillOpacity: .18 } : undefined} /></span>
}

// Brand mark: an open book with a guiding star ("Astra" = star).
export function Logo({ size = 36 }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="AraLab">
      <defs><linearGradient id="lg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6d7bff" /><stop offset="1" stopColor="#9b5cf0" /></linearGradient></defs>
      <rect width="48" height="48" rx="14" fill="url(#lg1)" />
      <path d="M10 20.500c4-1.6 9-1.2 14 1.8 5-3 10-3.4 14-1.800V35c-4-1.6-9-1.2-14 1.800C19 33.8 14 33.4 10 35z" fill="#fff" fillOpacity=".96" />
      <path d="M24 22.300V36.8" stroke="#7c6cf5" strokeWidth="1.6" />
      <path d="M24 7l1.9 4.6 4.6 1.9-4.6 1.900L24 20l-1.9-4.6-4.6-1.9 4.6-1.900z" fill="#ffe27a" />
    </svg>
  )
}
