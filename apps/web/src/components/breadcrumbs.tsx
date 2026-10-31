import Link from 'next/link';

export interface Crumb {
  href: string;
  label: string;
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-stone-500">
      {crumbs.map((c, i) => (
        <span key={c.href}>
          {i > 0 && <span className="mx-1.5 text-stone-300">/</span>}
          <Link href={c.href} className="hover:text-stone-800 hover:underline">
            {c.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}
