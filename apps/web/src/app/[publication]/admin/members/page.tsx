import { notFound } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server.js';
import { resolvePublication } from '@/lib/resolvers.js';
import { InviteForm } from './invite-form.js';

export const dynamic = 'force-dynamic';

export default async function AdminMembersPage({
  params,
}: {
  params: Promise<{ publication: string }>;
}) {
  const { publication: slug } = await params;
  const supabase = await getSupabaseServerClient();
  const publication = await resolvePublication(supabase, slug);
  if (!publication) notFound();

  const { data: adminMembership } = await supabase
    .from('memberships')
    .select('role')
    .eq('publication_id', publication.id)
    .eq('role', 'admin')
    .maybeSingle();
  if (!adminMembership) notFound();

  const nowIso = new Date().toISOString();
  const { data: pending } = await supabase
    .from('invitations')
    .select('id, email, role, created_at, expires_at')
    .eq('publication_id', publication.id)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false });

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">{publication.name} — Members</h1>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Invite a member</h2>
        <InviteForm publicationId={publication.id} />
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-medium">Pending invitations</h2>
        {pending && pending.length > 0 ? (
          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left">
                <th className="py-2">Email</th>
                <th className="py-2">Role</th>
                <th className="py-2">Invited</th>
                <th className="py-2">Expires</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.id} className="border-b border-slate-200">
                  <td className="py-2">{row.email}</td>
                  <td className="py-2">{row.role}</td>
                  <td className="py-2">{new Date(row.created_at).toLocaleDateString()}</td>
                  <td className="py-2">{new Date(row.expires_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-4 text-slate-600">No pending invitations.</p>
        )}
      </section>
    </main>
  );
}
