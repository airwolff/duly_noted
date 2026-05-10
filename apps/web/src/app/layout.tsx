import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Duly Noted',
  description: 'Local government meeting transcripts and summaries.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900 antialiased">{children}</body>
    </html>
  );
}
