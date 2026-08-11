import { auth } from '@/lib/firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  User,
} from 'firebase/auth';

export const signup = async (email: string, password: string) => {
  return createUserWithEmailAndPassword(auth, email, password);
};

export const login = async (email: string, password: string) => {
  return signInWithEmailAndPassword(auth, email, password);
};

export const loginWithGoogle = () => {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
};

export const logout = async () => {
  return signOut(auth);
};

export const onAuthChange = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, callback);
};
