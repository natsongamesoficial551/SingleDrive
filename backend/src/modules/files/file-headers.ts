const inlineMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm', 'video/ogg', 'audio/mpeg', 'audio/ogg', 'audio/wav'])

export function safeDisposition(requested: 'inline' | 'attachment' | undefined, mimeType: string, name: string) {
  const disposition = requested === 'inline' && inlineMimeTypes.has(mimeType.toLowerCase()) ? 'inline' : 'attachment'
  const safeName = name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || 'download'
  return `${disposition}; filename*=UTF-8''${encodeURIComponent(safeName).replace(/['()*]/g, value => '%' + value.charCodeAt(0).toString(16).toUpperCase())}`
}
