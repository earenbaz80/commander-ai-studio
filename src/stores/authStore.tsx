/**
 * Auth Store - Centralized authentication state
 * 
 * Manages: Firebase user, guest identity, auth modal, onboarding
 */
import { createContext, useContext, useReducer, useEffect, useCallback, ReactNode } from 'react';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { useIdentity } from '../hooks/useIdentity';

export interface AuthState {
  currentUser: FirebaseUser | null;
  guestName: string;
  isAuthModalOpen: boolean;
  isOnboardingModalOpen: boolean;
  hasCompletedOnboarding: boolean;
}

type AuthAction =
  | { type: 'SET_CURRENT_USER'; payload: FirebaseUser | null }
  | { type: 'SET_GUEST_NAME'; payload: string }
  | { type: 'SET_AUTH_MODAL_OPEN'; payload: boolean }
  | { type: 'SET_ONBOARDING_MODAL_OPEN'; payload: boolean }
  | { type: 'SET_ONBOARDING_COMPLETE'; payload: boolean }
  | { type: 'REOPEN_ONBOARDING' };

const initialState: AuthState = {
  currentUser: null,
  guestName: '',
  isAuthModalOpen: false,
  isOnboardingModalOpen: false,
  hasCompletedOnboarding: false,
};

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SET_CURRENT_USER':
      return { ...state, currentUser: action.payload };
    case 'SET_GUEST_NAME':
      return { ...state, guestName: action.payload };
    case 'SET_AUTH_MODAL_OPEN':
      return { ...state, isAuthModalOpen: action.payload };
    case 'SET_ONBOARDING_MODAL_OPEN':
      return { ...state, isOnboardingModalOpen: action.payload };
    case 'SET_ONBOARDING_COMPLETE':
      return { ...state, hasCompletedOnboarding: action.payload };
    case 'REOPEN_ONBOARDING':
      return { ...state, isOnboardingModalOpen: true, hasCompletedOnboarding: false };
    default:
      return state;
  }
}

interface AuthStoreContextValue {
  state: AuthState;
  dispatch: React.Dispatch<AuthAction>;
  // Computed
  displayName: string;
  isAuthenticated: boolean;
  // Actions
  openAuthModal: () => void;
  closeAuthModal: () => void;
  openOnboarding: () => void;
  closeOnboarding: () => void;
  completeOnboarding: () => void;
  reopenOnboarding: () => void;
  setGuestName: (name: string) => void;
}

const AuthStoreContext = createContext<AuthStoreContextValue | null>(null);

// We need a custom hook to use the identity hook inside the provider
function AuthStoreProviderInner({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const identity = useIdentity();

  // Firebase auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      dispatch({ type: 'SET_CURRENT_USER', payload: user });
    });
    return () => unsubscribe();
  }, []);

  // Sync guest name from identity hook
  useEffect(() => {
    if (identity.guestName) {
      dispatch({ type: 'SET_GUEST_NAME', payload: identity.guestName });
    }
  }, [identity.guestName]);

  // Check onboarding completion
  useEffect(() => {
    try {
      const completed = localStorage.getItem('ai_studio_onboarding_complete') === 'true';
      dispatch({ type: 'SET_ONBOARDING_COMPLETE', payload: completed });
    } catch {}
  }, []);

  const computed = {
    displayName: state.currentUser?.displayName || state.guestName || '',
    isAuthenticated: !!state.currentUser,
  };

  const actions = {
    openAuthModal: useCallback(() => dispatch({ type: 'SET_AUTH_MODAL_OPEN', payload: true }), []),
    closeAuthModal: useCallback(() => dispatch({ type: 'SET_AUTH_MODAL_OPEN', payload: false }), []),
    openOnboarding: useCallback(() => dispatch({ type: 'SET_ONBOARDING_MODAL_OPEN', payload: true }), []),
    closeOnboarding: useCallback(() => dispatch({ type: 'SET_ONBOARDING_MODAL_OPEN', payload: false }), []),
    completeOnboarding: useCallback(() => {
      try { localStorage.setItem('ai_studio_onboarding_complete', 'true'); } catch {}
      dispatch({ type: 'SET_ONBOARDING_COMPLETE', payload: true });
      dispatch({ type: 'SET_ONBOARDING_MODAL_OPEN', payload: false });
    }, []),
    reopenOnboarding: useCallback(() => {
      try { localStorage.removeItem('ai_studio_onboarding_complete'); } catch {}
      dispatch({ type: 'REOPEN_ONBOARDING' });
    }, []),
    setGuestName: useCallback((name: string) => dispatch({ type: 'SET_GUEST_NAME', payload: name }), []),
  };

  return (
    <AuthStoreContext.Provider value={{ state, dispatch, ...computed, ...actions }}>
      {children}
    </AuthStoreContext.Provider>
  );
}

export function AuthStoreProvider({ children }: { children: ReactNode }) {
  return <AuthStoreProviderInner>{children}</AuthStoreProviderInner>;
}

export function useAuthStore() {
  const context = useContext(AuthStoreContext);
  if (!context) {
    throw new Error('useAuthStore must be used within an AuthStoreProvider');
  }
  return context;
}

export function useAuthState() {
  const { state } = useAuthStore();
  return state;
}

export function useAuthActions() {
  const actions = useAuthStore();
  return actions;
}

export function useDisplayName() {
  const { displayName } = useAuthStore();
  return displayName;
}

export function useIsAuthenticated() {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated;
}