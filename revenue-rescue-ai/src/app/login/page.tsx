import { redirect } from 'next/navigation';
import { login, getSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/security';
import { headers } from 'next/headers';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  const s = await getSession();
  if (s) redirect(s.role === 'admin' ? '/admin' : '/app');
  async function action(fd: FormData) {
    'use server';
    const ip = ((await headers()).get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
    const email = String(fd.get('email') ?? '');
    const db = await getDb();
    if (!(await rateLimit(db, `login:${ip}`, 10, 900)) || !(await rateLimit(db, `login-user:${email.toLowerCase()}`, 8, 900))) redirect('/login?e=Too+many+attempts.+Try+again+later.');
    if (!(await login(email, String(fd.get('password') ?? '')))) redirect('/login?e=Incorrect+email+or+password.');
    redirect('/login');
  }
  return (
    <main><h1>Sign in</h1>
      <form className="card" action={action}>
        {e && <p className="err" role="alert">{e}</p>}
        <label htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="username" />
        <label htmlFor="password">Password</label><input id="password" name="password" type="password" required autoComplete="current-password" />
        <div style={{ marginTop: 16 }}><button className="btn" type="submit">Sign in</button></div>
      </form></main>
  );
}
