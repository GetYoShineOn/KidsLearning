import './globals.css';
import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: `${BRAND.name} - find the revenue your leads leave behind`, description: 'A free review of where leads may be slipping through, and a way to recover them.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#14513f' };

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body>
      <header className="top"><Link href="/" className="logo">{BRAND.name}</Link><Link href="/login" className="small">Sign in</Link></header>
      {children}
    </body></html>
  );
}
