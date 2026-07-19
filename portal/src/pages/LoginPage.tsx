import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { BookHeart, Cat, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../features/auth/AuthProvider';
import { Button, InlineSpinner } from '../components/ui';
import { ApiError } from '../lib/api';

const loginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  if (user) {
    return <Navigate to={user.role === 'SUPERADMIN' ? '/caretaker' : '/my-network'} replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    setServerError('');
    try {
      const signedIn = await login(values.email, values.password);
      const requested = (location.state as { from?: string } | null)?.from;
      navigate(requested && requested.startsWith('/') ? requested : (
        signedIn.role === 'SUPERADMIN' ? '/caretaker' : '/my-network'
      ), { replace: true });
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : 'Sign in could not be completed.');
    }
  });

  return (
    <main className="login-page">
      <section className="login-story" aria-label="Welcome">
        <div className="login-brand"><Cat /><span>Our Companion</span></div>
        <p className="eyebrow">Network Portal</p>
        <h1>Your companion’s little passport to the wider world.</h1>
        <p className="login-intro">
          Keep an eye on visits, friendships, published motion packs, and the devices
          that carry your companion with you.
        </p>
        <div className="postcard-stack" aria-hidden="true">
          <div className="postcard postcard--back"><Sparkles /></div>
          <div className="postcard postcard--front">
            <span className="postcard-stamp">CONNECTED</span>
            <BookHeart />
            <strong>A quiet social notebook</strong>
            <small>Private by design · owner-scoped · always yours</small>
          </div>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-form" onSubmit={onSubmit} noValidate>
          <div className="login-seal"><LockKeyhole aria-hidden="true" /></div>
          <p className="eyebrow">Welcome back</p>
          <h2>Open My Network</h2>
          <p>Use the same Network Account as the desktop companion.</p>
          {serverError && <div className="form-error" role="alert">{serverError}</div>}
          <label className="field">
            <span>Email</span>
            <input
              autoComplete="email"
              inputMode="email"
              aria-invalid={Boolean(errors.email)}
              {...register('email')}
            />
            {errors.email && <small role="alert">{errors.email.message}</small>}
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(errors.password)}
              {...register('password')}
            />
            {errors.password && <small role="alert">{errors.password.message}</small>}
          </label>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <InlineSpinner label="Opening your notebook" /> : 'Sign in securely'}
          </Button>
          <div className="security-note">
            <ShieldCheck aria-hidden="true" />
            <span>Your browser session uses secure cookies. Tokens are never stored in browser storage.</span>
          </div>
        </form>
      </section>
    </main>
  );
}
