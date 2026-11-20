import { useState, type FormEvent } from 'react'
import { ArrowRight, Leaf, LockKeyhole, Mail, UserRound } from 'lucide-react'
import { supabase } from './lib/supabase'

export function AuthGate() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: name.trim() } },
        })
        if (signUpError) throw signUpError
        setMessage(data.session
          ? 'Account created. You are signed in.'
          : 'Account created. Check your email to confirm it, then sign in here.')
        if (!data.session) setMode('login')
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (loginError) throw loginError
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-screen">
    <section className="auth-card">
      <div className="auth-brand"><span className="brand-mark"><Leaf size={21} /></span><b>CivicLens<span> AI</span></b></div>
      <div className="eyebrow">KANPUR CIVIC OPERATIONS</div>
      <h1>{mode === 'login' ? 'Welcome back' : 'Create your citizen account'}</h1>
      <p className="auth-intro">{mode === 'login' ? 'Sign in to report issues and track your submissions.' : 'Register to submit civic issues and follow their progress.'}</p>
      {message && <div className="auth-message" role="status">{message}</div>}
      {error && <div className="auth-error" role="alert">{error}</div>}
      <form onSubmit={submit}>
        {mode === 'signup' && <label className="auth-label"><span>Your name</span><div><UserRound size={16} /><input required minLength={2} maxLength={100} autoComplete="name" value={name} onChange={event => setName(event.target.value)} /></div></label>}
        <label className="auth-label"><span>Email</span><div><Mail size={16} /><input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></div></label>
        <label className="auth-label"><span>Password</span><div><LockKeyhole size={16} /><input required type="password" minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} /></div></label>
        <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'} {!busy && <ArrowRight size={16} />}</button>
      </form>
      <p className="auth-toggle">{mode === 'login' ? 'New to CivicLens?' : 'Already have an account?'}{' '}
        <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }}>{mode === 'login' ? 'Create account' : 'Sign in'}</button>
      </p>
      <small className="auth-note">Account creation only gives citizen access. Admin and staff access must be granted by a trusted project administrator.</small>
    </section>
  </main>
}
