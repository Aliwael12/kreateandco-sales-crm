import { Outlet } from 'react-router-dom'
import { useState } from 'react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { useProfile } from '@/context/auth'

export default function AppShell() {
  const profile = useProfile()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        profile={profile}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {/* Dedicated scroll container — separates "what scrolls" from "what flex-layouts" */}
        <div className="flex-1 overflow-y-auto">
          <main className="flex flex-col gap-4 p-5">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
