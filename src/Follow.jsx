import { useEffect, useState } from 'react'
import Icon from './Icons'
import { followInfo, follow, unfollow } from './notifyApi'

// Follower counts + Follow / Following button for a profile.
export default function FollowBar({ me, viewId, toast, extra = null }) {
  const [info, setInfo] = useState(null), [busy, setBusy] = useState(false), mine = me === viewId
  useEffect(() => { let live = true; followInfo(me, viewId).then(i => live && setInfo(i)).catch(() => {}); return () => { live = false } }, [me, viewId])
  const toggle = async () => {
    setBusy(true)
    const on = info.iFollow, { error } = await (on ? unfollow(me, viewId) : follow(me, viewId))
    setBusy(false)
    if (error) return toast(/relation|schema cache/i.test(error.message) ? 'Database is out of date. Re-run supabase-setup.sql in Supabase.' : error.message)
    setInfo(i => ({ ...i, iFollow: !on, followers: i.followers + (on ? -1 : 1) }))
    toast(on ? 'Unfollowed.' : 'Following. You will be notified when they publish.')
  }
  return (
    <>
      <div className="pf-stats">
        <span><b>{info?.followers ?? '–'}</b> Followers</span><span><b>{info?.following ?? '–'}</b> Following</span>{extra}
      </div>
      {!mine && info && <button type="button" className={`pf-follow${info.iFollow ? ' on' : ''}`} disabled={busy} onClick={toggle}>{info.iFollow ? <Icon name="check" size={17} /> : <span aria-hidden="true">+</span>} {info.iFollow ? 'Following' : 'Follow'}</button>}
    </>
  )
}
