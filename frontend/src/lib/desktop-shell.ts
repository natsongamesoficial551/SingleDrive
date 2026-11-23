const marker = 'sd:desktop-shell'

export function rememberDesktopShell() {
  const url = new URL(window.location.href)
  if (url.searchParams.get('app') !== 'desktop') return
  sessionStorage.setItem(marker, '1')
  url.searchParams.delete('app')
  window.history.replaceState(window.history.state, '', url)
}

export function isDesktopShell() {
  return sessionStorage.getItem(marker) === '1'
}
