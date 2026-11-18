// Loading skeletons: grey placeholder shapes that pulse while data loads.
// Everything is aria-hidden except the wrapper, which announces "Loading" once.
export function Bone({ w, h = 14, r, circle, style }) {
  return <i className={circle ? 'bone circ' : 'bone'} style={{ width: circle ? h : w, height: h, borderRadius: r, ...style }} />
}

function Wrap({ label, className = '', children }) {
  return <div className={`skel ${className}`} role="status" aria-busy="true" aria-label={label}>{children}</div>
}

// A feed post: avatar + name line, 3 text lines, reaction row.
export function PostSkeleton({ count = 3 }) {
  return (
    <Wrap label="Loading the feed">
      {Array.from({ length: count }, (_, i) => (
        <div className="clay tile sk-post" key={i} aria-hidden="true">
          <div className="sk-row"><Bone circle h={40} /><div className="sk-col"><Bone w="38%" /><Bone w="24%" h={11} /></div></div>
          <Bone w="96%" /><Bone w="88%" /><Bone w={i % 2 ? '52%' : '70%'} />
          <div className="sk-row sk-gap"><Bone w={64} h={28} r={999} /><Bone w={64} h={28} r={999} /><Bone w={64} h={28} r={999} /></div>
        </div>
      ))}
    </Wrap>
  )
}

// Library reviewer cards (same grid as the real list).
export function CardsSkeleton({ count = 6 }) {
  return (
    <Wrap label="Loading the library" className="cards">
      {Array.from({ length: count }, (_, i) => (
        <div className="clay card sk-card" key={i} aria-hidden="true">
          <Bone w="80%" h={18} /><Bone w="45%" h={12} /><Bone w="100%" h={10} /><Bone w="72%" h={10} />
          <div className="sk-row sk-gap"><Bone circle h={22} /><Bone w="34%" h={11} /></div>
          <div className="sk-row"><Bone w={70} h={28} r={10} /><Bone w={70} h={28} r={10} /></div>
        </div>
      ))}
    </Wrap>
  )
}

// People / ranking / request rows.
export function RowsSkeleton({ count = 6, label = 'Loading' }) {
  return (
    <Wrap label={label} className="people">
      {Array.from({ length: count }, (_, i) => (
        <div className="clay tile sk-person" key={i} aria-hidden="true">
          <Bone circle h={48} />
          <div className="sk-col grow"><Bone w="42%" /><Bone w="62%" h={11} /></div>
          <Bone w={84} h={34} r={12} />
        </div>
      ))}
    </Wrap>
  )
}

// A University Astra guide entry.
export function GuideSkeleton({ count = 3 }) {
  return (
    <Wrap label="Loading guides">
      {Array.from({ length: count }, (_, i) => (
        <div className="clay tile sk-guide" key={i} aria-hidden="true">
          <div className="sk-row"><Bone circle h={30} /><Bone w="46%" h={16} /></div>
          <Bone w="100%" /><Bone w="92%" /><Bone w="64%" />
        </div>
      ))}
    </Wrap>
  )
}

// The whole app shell, shown while the account loads (instead of a bare "Loading…").
export function AppSkeleton() {
  return (
    <div className="shell sk-shell" role="status" aria-busy="true" aria-label="Loading AraLab">
      <aside className="clay side" aria-hidden="true">
        <div className="sk-row"><Bone h={36} r={12} w={36} /><Bone w={70} h={16} /></div>
        <div className="sk-col sk-nav">{Array.from({ length: 6 }, (_, i) => <Bone key={i} w="100%" h={38} r={10} />)}</div>
        <div className="sk-row sk-me"><Bone circle h={40} /><div className="sk-col grow"><Bone w="70%" /><Bone w="50%" h={11} /></div></div>
      </aside>
      <main aria-hidden="true">
        <Bone w="100%" h={42} r={14} style={{ marginBottom: 16 }} />
        <PostSkeleton count={2} />
      </main>
    </div>
  )
}
