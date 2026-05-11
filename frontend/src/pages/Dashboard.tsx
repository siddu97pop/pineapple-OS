import { NavBar } from '../components/NavBar'
import { StatusBar } from '../components/StatusBar'
import { Terminal } from '../components/Terminal'
import { SessionsFeed } from '../components/SessionsFeed'
import { ClaudeMdEditor } from '../components/ClaudeMdEditor'
import { DotGrid } from '../components/DotGrid'

export function Dashboard() {
  return (
    <div className="h-screen overflow-hidden">
      <DotGrid />
      <NavBar />
      <StatusBar />
      <main className="pt-[84px] h-screen flex flex-col overflow-hidden px-3 pb-3 gap-3">
        <div className="flex flex-1 gap-3 min-h-0">
          {/* Left: Terminal */}
          <div className="flex-1 min-w-0 min-h-0">
            <Terminal className="h-full" />
          </div>
          {/* Right: Sessions feed + CLAUDE.md editor */}
          <div className="w-[360px] flex-shrink-0 flex flex-col gap-3 min-h-0">
            <div className="flex-1 min-h-0">
              <SessionsFeed />
            </div>
            <div className="h-64 flex-shrink-0">
              <ClaudeMdEditor />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
