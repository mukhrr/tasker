import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import { Navbar } from '@/components/navbar';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();

  if (!user) {
    redirect('/auth/login');
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar user={user} />
      <main className="px-4 py-5 sm:px-6 sm:py-8 lg:px-10">
        {children}
      </main>
    </div>
  );
}
