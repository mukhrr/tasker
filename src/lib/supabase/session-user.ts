import type { SupabaseClient } from '@supabase/supabase-js';

// The part of a Supabase user the app reads, taken from the session token.
export interface SessionUser {
  id: string;
  email: string | undefined;
  user_metadata: Record<string, unknown>;
}

export function userFromClaims(
  claims: Record<string, unknown> | null | undefined
): SessionUser | null {
  if (!claims || typeof claims.sub !== 'string' || !claims.sub) return null;
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    user_metadata:
      claims.user_metadata && typeof claims.user_metadata === 'object'
        ? (claims.user_metadata as Record<string, unknown>)
        : {},
  };
}

// Verifies the token's signature against the project's public keys, cached
// in memory, so a page render makes no call to Supabase Auth. Unlike
// auth.getUser() it does not notice a session revoked before the token
// expires (an hour at most); routes that write still use getUser().
export async function sessionUser(
  supabase: SupabaseClient
): Promise<SessionUser | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (data) return userFromClaims(data.claims);
  if (!error) return null;
  // Local verification failed for a reason other than "no session" (keys
  // unreachable, say): ask Supabase Auth rather than sign the user out.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user
    ? {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata ?? {},
      }
    : null;
}
