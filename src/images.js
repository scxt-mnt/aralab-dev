import { sb } from './supabase'
import { uid } from './lib'

export const MAX_IMAGES = 4
const MAX_BYTES = 8 * 1024 * 1024   // original; we shrink it before upload

export function checkImages(files, already = 0) {
  if (already + files.length > MAX_IMAGES) return `You can attach up to ${MAX_IMAGES} photos.`
  for (const f of files) {
    if (!/^image\/(jpeg|png|webp|gif|heic)$/i.test(f.type)) return `${f.name}: please choose a JPG, PNG or WEBP photo.`
    if (f.size > MAX_BYTES) return `${f.name} is over 8 MB.`
  }
  return ''
}
async function shrink(file, max = 1600) {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.82))
}
// uploads to post-images/<user-id>/<random>.jpg and returns public URLs + the paths (to clean up if the post fails)
export async function uploadPostImages(userId, files) {
  const urls = [], paths = []
  try {
    for (const f of files) {
      const blob = await shrink(f), path = `${userId}/${uid()}.jpg`
      const { error } = await sb.storage.from('post-images').upload(path, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      paths.push(path); urls.push(sb.storage.from('post-images').getPublicUrl(path).data.publicUrl)
    }
  } catch (e) { if (paths.length) sb.storage.from('post-images').remove(paths); throw e }
  return { urls, paths }
}
export const removePostImages = paths => paths.length ? sb.storage.from('post-images').remove(paths) : null
