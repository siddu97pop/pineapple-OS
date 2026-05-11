import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { DotGrid } from '../components/DotGrid'

type Mode = 'login' | 'reset'

export function Login() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMessage({ type: 'error', text: error.message })
    setLoading(false)
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) setMessage({ type: 'error', text: error.message })
    else setMessage({ type: 'success', text: 'Reset link sent! Check siddu97pop@gmail.com' })
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <DotGrid />
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🍍</div>
          <h1 className="text-2xl font-bold text-white">Pineapple OS</h1>
          <p className="text-slate-500 text-sm mt-1">Personal command center</p>
        </div>
        <div className="card p-6">
          <h2 className="text-sm font-medium text-slate-400 mb-6 uppercase tracking-wider">
            {mode === 'login' ? 'Sign In' : 'Reset Password'}
          </h2>
          <form onSubmit={mode === 'login' ? handleLogin : handleReset} className="space-y-4">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input-field"
              required
            />
            {mode === 'login' && (
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input-field"
                required
              />
            )}
            {message && (
              <div className={`text-xs px-3 py-2 rounded-lg ${message.type === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                {message.text}
              </div>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Send Reset Link'}
            </button>
          </form>
          <div className="mt-4 text-center">
            {mode === 'login' ? (
              <button
                onClick={() => { setMode('reset'); setMessage(null) }}
                className="text-xs text-slate-500 hover:text-electric transition-colors"
              >
                Forgot password?
              </button>
            ) : (
              <button
                onClick={() => { setMode('login'); setMessage(null) }}
                className="text-xs text-slate-500 hover:text-electric transition-colors"
              >
                ← Back to sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
