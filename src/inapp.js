// v84: detects the browsers inside Facebook / Messenger / Instagram / TikTok / Line etc. (embedded WebViews).
// Google sign-in is blocked there ("disallowed_useragent"), and they are often old engines, so we show a friendly "Open in your browser" note.
export const inAppName = (ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '') => {
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua)) return /Messenger|MESSENGER|FB_IAB\/MESSENGER|\bMSGR/i.test(ua) ? 'Messenger' : 'Facebook'
  if (/Instagram/i.test(ua)) return 'Instagram'
  if (/musical_ly|TikTok|BytedanceWebview/i.test(ua)) return 'TikTok'
  if (/\bLine\//i.test(ua)) return 'Line'
  if (/Snapchat/i.test(ua)) return 'Snapchat'
  if (/Twitter/i.test(ua)) return 'X'
  if (/LinkedInApp/i.test(ua)) return 'LinkedIn'
  return ''
}
export const isAndroid = (ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '') => /Android/i.test(ua)
// Android can jump straight into Chrome with an intent link; iOS cannot, so there we copy the link and explain.
export const chromeIntentUrl = (href = location.href) => { try { const u = new URL(href); return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;end` } catch { return href } }
export const markInApp = () => { const n = inAppName(); if (n && typeof document !== 'undefined') document.documentElement.classList.add('inapp'); return n }
