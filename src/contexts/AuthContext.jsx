import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import { supabase, withTimeout } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // Tracks the user.id that's currently "loaded" (profile fetched).
  // Distinguishes a real user change from a tab-resume re-validation.
  const loadedUserId = useRef(null);

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
      loadedUserId.current = s?.user?.id ?? null;
      await loadProfile(s?.user?.id);
      if (mounted) setLoading(false);
    });

    // Subscribe to auth state changes.
    //
    // Important: SIGNED_IN fires not only on real sign-ins but also
    // every time the tab regains focus and the auth client re-validates
    // the existing session from storage. Treating those re-validations
    // as a real transition (loading=true → re-fetch profile) makes
    // ProtectedRoute unmount the page on every tab return, losing all
    // in-memory state. So we check whether the user actually changed
    // first.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, s) => {
      if (!mounted) return;
      if (event === 'INITIAL_SESSION') {
        // Already handled by getSession() above.
        return;
      }

      const newUserId = s?.user?.id ?? null;
      const sameUser = newUserId && newUserId === loadedUserId.current;

      // Tab-resume re-validation for the same user — quiet update only.
      if (event === 'SIGNED_IN' && sameUser) {
        setSession(s);
        return;
      }

      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Real user transition — show spinner while profile re-loads.
        setLoading(true);
        setSession(s);
        loadedUserId.current = newUserId;
        await loadProfile(newUserId);
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
