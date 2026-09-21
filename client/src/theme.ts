import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const storageKey = 'powermap-theme'
export function usePowerMapTheme() {
  const [preference, setPreference] = useState<Theme | null>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved === 'light' || saved === 'dark' ? saved : null
    } catch {
      return null
    }
  })
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const theme: Theme = preference ?? (systemDark ? 'dark' : 'light')
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#1c1c1e' : '#f2f2f7')
    if (preference) {
      try {
        localStorage.setItem(storageKey, preference)
      } catch {
        /* Theme still works without storage. */
      }
    }
  }, [theme, preference])
  return { theme, setTheme: setPreference }
}
