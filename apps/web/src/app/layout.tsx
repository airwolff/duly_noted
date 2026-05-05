import type { ReactNode } from 'react';

export const metadata = {
  title: 'Duly Noted',
  description: 'Local government meeting transcripts and summaries.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
