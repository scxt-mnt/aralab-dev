import { sb } from './supabase'

export const MAX_PHOTO = 5 * 1024 * 1024
async function resize(file, size = 256) {
  const bmp = await createImageBitmap(file)
  const s = Math.min(bmp.width, bmp.height), c = document.createElement('canvas')
  c.width = c.height = size
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size)
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.85))
}
export function checkPhoto(file) {
  if (!file.type.startsWith('image/')) return 'Please choose an image file.'
  if (file.size > MAX_PHOTO) return 'That photo is over 5 MB.'
  return ''
}
// Uploads to avatars/<user-id>/avatar.jpg and returns its public URL
export async function uploadAvatar(userId, file) {
  const blob = await resize(file)
  const path = `${userId}/avatar.jpg`
  const { error } = await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw error
  return sb.storage.from('avatars').getPublicUrl(path).data.publicUrl + `?v=${Date.now()}`
}

// v82: uploads an already-cropped image (profile photo = 'avatar', cover photo = 'cover') and returns its public URL
export async function uploadBlob(userId, blob, name = 'avatar') {
  const path = `${userId}/${name}.jpg`
  const { error } = await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw error
  return sb.storage.from('avatars').getPublicUrl(path).data.publicUrl + `?v=${Date.now()}`
}

// Google sign-in photos live only in the private auth profile, so other students could never see them (only a letter).
// This copies that photo into our public avatars bucket once and returns its URL ('' if the browser/Google refuses).
export async function importGooglePhoto(userId, url) {
  try {
    if (!url) return ''
    const r = await fetch(String(url).replace(/=s\d+(-c)?$/, '=s256-c'), { referrerPolicy: 'no-referrer' })
    if (!r.ok) return ''
    const blob = await r.blob()
    if (!blob.type.startsWith('image/') || blob.size > MAX_PHOTO) return ''
    return await uploadAvatar(userId, blob)
  } catch { return '' }
}
