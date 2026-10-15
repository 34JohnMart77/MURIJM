import type { ReactNode } from 'react'

interface DesktopLayoutProps {
  sidebar: ReactNode
  topbar: ReactNode
  content: ReactNode
  overlays?: ReactNode
}

/** Laptop / wide-screen shell: fixed sidebar + main column. */
export default function DesktopLayout({
  sidebar,
  topbar,
  content,
  overlays,
}: DesktopLayoutProps) {
  return (
    <div className="app is-desktop">
      {sidebar}
      <div className="main">
        {topbar}
        {content}
      </div>
      {overlays}
    </div>
  )
}
