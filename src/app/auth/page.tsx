'use client';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { ScrambleText } from '@/components/ui/ScrambleText';
import { cn } from '@/utils/cn';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import styles from './auth.module.css';

type AuthMode = 'signin' | 'signup' | 'magic';

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect') || '/';
  const { user, signInWithEmail, signUpWithEmail, signInWithMagicLink, signInWithOAuth, error, isLoading, clearError } = useAuthStore();

  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordKey, setPasswordKey] = useState(0);
  const [magicSent, setMagicSent] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && user) {
      router.replace(redirectUrl);
    }
  }, [mounted, user, router, redirectUrl]);

  // Dynamic 3D Card Mouse Tilt Effect State
  const cardRef = useRef<HTMLDivElement>(null);
  const [transformStyle, setTransformStyle] = useState('');
  const [spotlightStyle, setSpotlightStyle] = useState('');

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -6;
    const rotateY = ((x - centerX) / centerX) * 6;

    setTransformStyle(`perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.01, 1.01, 1.01)`);
    setSpotlightStyle(`radial-gradient(400px circle at ${x}px ${y}px, rgba(139, 92, 246, 0.12), transparent 80%)`);
  };

  const handleMouseLeave = () => {
    setTransformStyle('perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)');
    setSpotlightStyle('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (mode === 'magic') {
      await signInWithMagicLink(email);
      setMagicSent(true);
      return;
    }

    if (mode === 'signin') {
      await signInWithEmail(email, password);
    } else {
      await signUpWithEmail(email, password);
    }

    const currentState = useAuthStore.getState();
    if (currentState.error && mode === 'signup' && currentState.error.toLowerCase().includes('already registered')) {
      setMode('signin');
    } else if (!currentState.error) {
      if (currentState.user) {
        router.push(redirectUrl);
        router.refresh();
      } else if (mode === 'signup') {
        setMagicSent(true);
      }
    }
  };

  if (!mounted) {
    return (
      <div className={styles.authPage} suppressHydrationWarning>
        <div className={styles.card} suppressHydrationWarning />
      </div>
    );
  }

  if (magicSent) {
    return (
      <div className={styles.authPage}>
        <div className={styles.card}>
          <div className={styles.logo}>
            <div className={styles.logoMark}>📬</div>
            <h1 className={styles.appName}>Check your email</h1>
            <p className={styles.tagline}>
              We sent a magic link to <strong>{email}</strong>.
              Click the link to sign in — no password needed.
            </p>
          </div>
          <button className="btn btn-ghost w-full" onClick={() => setMagicSent(false)}>
            ← Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.authPage} suppressHydrationWarning>
      <div
        ref={cardRef}
        className={styles.card}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        suppressHydrationWarning
        style={{
          transform: transformStyle,
          backgroundImage: spotlightStyle ? `${spotlightStyle}` : undefined,
          transition: 'transform 0.1s ease-out, box-shadow 0.2s ease',
        }}
      >
        {/* Logo */}
        <div className={styles.logo}>
          <div className={styles.logoMark}>🧠</div>
          <h1 className={styles.appName}>Noledge</h1>
          <p className={styles.tagline}>Spaced repetition, synced everywhere</p>
        </div>

        {/* Tabs */}
        <div className={styles.tabs} role="tablist">
          <button
            role="tab"
            id="tab-signin"
            className={cn(styles.tab, mode === 'signin' && styles.tabActive)}
            onClick={() => { setMode('signin'); clearError(); }}
          >
            Sign in
          </button>
          <button
            role="tab"
            id="tab-signup"
            className={cn(styles.tab, mode === 'signup' && styles.tabActive)}
            onClick={() => { setMode('signup'); clearError(); }}
          >
            Sign up
          </button>
        </div>

        {/* Error */}
        {error && <div className={styles.error}>{error}</div>}

        {/* Form */}
        <form className={styles.form} onSubmit={(e) => void handleSubmit(e)} suppressHydrationWarning>
          {mode !== 'magic' && (
            <>
              <div className={styles.formGroup} suppressHydrationWarning>
                <label htmlFor="auth-email">Email</label>
                <input
                  id="auth-email"
                  type="email"
                  className="input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  suppressHydrationWarning
                />
              </div>
              <div className={styles.formGroup} suppressHydrationWarning>
                <label htmlFor="auth-password">Password</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    className="input"
                    style={{ width: '100%', paddingRight: '40px' }}
                    placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setPasswordKey((k) => k + 1);
                    }}
                    required
                    minLength={8}
                    suppressHydrationWarning
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      color: 'var(--color-tertiary)',
                      padding: '4px',
                    }}
                    onClick={() => {
                      setShowPassword(!showPassword);
                      setPasswordKey((k) => k + 1);
                    }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                    color: 'var(--color-tertiary)',
                    marginTop: '6px',
                    gap: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                      <ShieldCheck size={14} style={{ color: '#8b5cf6', flexShrink: 0 }} />
                      <span style={{ flexShrink: 0 }}>Entropy:</span>
                      <ScrambleText
                        key={passwordKey}
                        text={showPassword ? (password.length > 16 ? `${password.slice(0, 14)}…` : password) : `••••••••${password.slice(-2)}`}
                        scrambledClassName="font-mono text-purple-400"
                        scrambleSpeed={18}
                        trigger={passwordKey}
                      />
                    </div>
                    <span style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      flexShrink: 0,
                      background: password.length >= 10 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                      color: password.length >= 10 ? '#10b981' : '#f59e0b',
                      border: `1px solid ${password.length >= 10 ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`
                    }}>
                      {password.length >= 10 ? 'Strong' : 'Fair'}
                    </span>
                  </div>
                )}
              </div>
              <button
                id="auth-submit"
                type="submit"
                className={styles.submitBtn}
                disabled={isLoading || !email || !password}
              >
                {isLoading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </>
          )}

          {mode === 'magic' && (
            <>
              <div className={styles.formGroup}>
                <label htmlFor="magic-email">Email</label>
                <input
                  id="magic-email"
                  type="email"
                  className="input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <button
                id="magic-submit"
                type="submit"
                className={styles.submitBtn}
                disabled={isLoading || !email}
              >
                {isLoading ? 'Sending…' : 'Send magic link'}
              </button>
              <p className={styles.magicInfo}>
                No password required. We'll email you a one-click sign-in link.
              </p>
            </>
          )}
        </form>

        {/* OAuth Social Login Buttons */}
        <div className="flex flex-col gap-2 mt-2">
          <button
            type="button"
            className={styles.googleBtn}
            onClick={() => void signInWithOAuth('google')}
            disabled={isLoading}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            Continue with Google
          </button>
        </div>

        {/* Magic link toggle */}
        <div className={styles.divider}>or</div>
        {mode !== 'magic' ? (
          <button
            id="toggle-magic"
            className="btn btn-ghost w-full"
            onClick={() => { setMode('magic'); clearError(); }}
          >
            ✉️ Continue with magic link
          </button>
        ) : (
          <button
            className="btn btn-ghost w-full"
            onClick={() => { setMode('signin'); clearError(); }}
          >
            ← Back to email/password
          </button>
        )}
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<div className={styles.authPage} />}>
      <AuthForm />
    </Suspense>
  );
}
