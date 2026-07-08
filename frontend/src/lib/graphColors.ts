// Canvas 2D contexts can't resolve CSS variables, so graph colors must be
// resolved to concrete rgb()/rgba() strings via getComputedStyle first.
export function cssRGB(varName: string, alpha?: number): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  if (!raw) return alpha !== undefined ? `rgba(136,136,136,${alpha})` : '#888'
  const [r, g, b] = raw.split(/\s+/)
  return alpha !== undefined ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`
}
