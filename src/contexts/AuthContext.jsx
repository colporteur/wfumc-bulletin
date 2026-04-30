import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase, withTimeout } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      // Explicit sign-out → clear the profile.
      setProfile(null);
      return;
    }
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('staff_profiles')
          .select('user_id, full_name, role')
          .eq('user_id', userId)
          .maybeSingle()
      );
      if (error) {
        // On a transient query error, KEEP the existing profile rather
        // than nulling it. Otherwise a momentary network blip would
        // show "No staff profile" until the next reload.
        console.error('Error loading staff profile:', error);
        return;
      }
      setProfile(data);
    } catch (e) {
      // Same here: on timeout, keep the last-known-good profile.
      console.error('Timeout loading staff profile:', e);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    // Initial session fetch
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (!mounted) return;
      setSession(s);
      await loadProfile(s?.user?.id);
      if (mounted) setLoading(false);
    });

    // Subscribe to auth state changes.
    //
    // Important: we ONLY re-load the profile when the user actually
    // changes (sign-in / sign-out). TOKEN_REFRESHED and other events
    // (which fire roughly every hour for token rotation) don't change
    // who's signed in, so re-fetching the profile on those events
    // accomplishes nothing — and if the re-fetch fails, it would null
    // out a perfectly good profile.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, s) => {
      if (!mounted) return;
      if (event === 'INITIAL_SESSION') {
        // Already handled by getSession() above.
        return;
      }
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Set loading=true during the transition so ProtectedRoute
        // shows the spinner instead of "No staff profile" while
        // the profile re-loads.
        setLoading(true);
        setSession(s);
        await loadProfile(s?.user?.id);
        if (mounted) setLoading(false);
      } else {
        // TOKEN_REFRESHED and similar — just update the session ref,
        // don't touch profile or loading state.
        setSession(s);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    isStaff: !!profile,
    isPastor: profile?.role === 'pastor',
    loading,
    signIn,
    signOut,
    refreshProfile: () => loadProfile(session?.user?.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
