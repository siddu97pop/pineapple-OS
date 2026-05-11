import { NavBar } from '../components/NavBar'
import { StatusBar } from '../components/StatusBar'
import { Terminal } from '../components/Terminal'
import { DotGrid } from '../components/DotGrid'

export function Dashboard() {
  return (
    <div className="h-screen overflow-hidden">
      <DotGrid />
      <NavBar />
      <StatusBar />
      <main className="pt-[84px] h-screen flex flex-col overflow-hidden px-3 pb-3 gap-3">
        <div className="flex flex-1 min-h-0">
          <Terminal className="h-full w-full" />
        </div>
      </main>
    </div>
  )
}
