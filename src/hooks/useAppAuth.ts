import { useEffect, useState } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useIdentity } from './useIdentity';

export interface AppAuthOptions {}

export function useAppAuth(_opts: AppAuthOptions) {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const identity = useIdentity();

  /** Nombre a mostrar: cuenta registrada si la hay, si no el de invitado. */
  const displayName = currentUser?.displayName || identity.guestName || '';

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  return { currentUser, setCurrentUser, identity, displayName };
}
