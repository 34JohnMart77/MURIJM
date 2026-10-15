import type { ReactNode } from 'react'
import type { View } from '../lib/api'
import {
  BookIcon,
  ChatIcon,
  GamepadIcon,
  MenuIcon,
  NoteIcon,
  PlusIcon,
} from './Icons'

interface MobileLayoutProps {
  sidebar: ReactNode
  topbar: ReactNode
  content: ReactNode
  overlays?: ReactNode
  view: View
  onNavigate: (view: View) => void
  onNewChat: () => void
  onOpenMenu: () => void
}

const TABS: { id: View; label: string; icon: typeof ChatIcon }[] = [
  { id: 'learn', label: 'Learn', icon: BookIcon },
  { id: 'games', label: 'Games', icon: GamepadIcon },
  { id: 'chat', label: 'Chat', icon: ChatIcon },
  { id: 'notes', label: 'Notes', icon: NoteIcon },
]

/** Phone shell: topbar + content + bottom tab bar. Sidebar becomes a drawer. */
export default function MobileLayout({
  sidebar,
  topbar,
  content,
  overlays,
  view,
  onNavigate,
  onNewChat,
  onOpenMenu,
}: MobileLayoutProps) {
  return (
    <div className="app is-mobile">
      {sidebar}
      <div className="main mobile-main">
        {topbar}
        <div className="mobile-content">{content}</div>
        <nav className="mobile-tabbar" aria-label="Primary">
          {TABS.slice(0, 2).map((tab) => {
            const TabIcon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                className={`mobile-tab ${view === tab.id ? 'active' : ''}`}
                onClick={() => onNavigate(tab.id)}
              >
                <TabIcon size={22} />
                <span>{tab.label}</span>
              </button>
            )
          })}
          <button
            type="button"
            className="mobile-fab"
            onClick={onNewChat}
            aria-label="New chat"
            title="New chat"
          >
            <PlusIcon size={24} />
          </button>
          {TABS.slice(2).map((tab) => {
            const TabIcon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                className={`mobile-tab ${view === tab.id ? 'active' : ''}`}
                onClick={() => onNavigate(tab.id)}
              >
                <TabIcon size={22} />
                <span>{tab.label}</span>
              </button>
            )
          })}
          <button
            type="button"
            className="mobile-tab"
            onClick={onOpenMenu}
            aria-label="Open menu"
          >
            <MenuIcon size={22} />
            <span>Menu</span>
          </button>
        </nav>
      </div>
      {overlays}
    </div>
  )
}
