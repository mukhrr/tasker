import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Use getSession (from cookie, no network call) for fast routing decisions.
  // The dashboard layout does the secure getUser() check.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // API routes do their own auth (bearer for cron, cookie-via-createClient
  // for user routes). Don't redirect — they need to return their own status.
  const isApi = request.nextUrl.pathname.startsWith('/api/');

  // Redirect unauthenticated users to login (except for auth pages and APIs)
  if (
    !session &&
    !isApi &&
    !request.nextUrl.pathname.startsWith('/auth') &&
    request.nextUrl.pathname !== '/'
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/login';
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages to dashboard
  if (session && request.nextUrl.pathname.startsWith('/auth')) {
    const url = request.nextUrl.clone();
    url.pathname = '/tasks';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
