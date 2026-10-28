import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'GiroTrack', description: 'A calmer way to manage accounts payable.', icons: {icon: '/girotrack-favicon.svg', apple: '/girotrack-logo.png'} };
export default function Layout({children}: {children: React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
