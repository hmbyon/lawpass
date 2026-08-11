import { auth } from '@/lib/firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  User,
} from 'firebase/auth';

export const signup = async (email: string, password: string) => {
  return createUserWithEmailAndPassword(auth, email, password);
};

export const login = async (email: string, password: string) => {
  return signInWithEmailAndPassword(auth, email, password);
};

// 모든 환경에서 리디렉션 방식 사용
export const loginWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  return signInWithRedirect(auth, provider);
};

export const handleRedirectResult = async () => {
  return getRedirectResult(auth);
};

export const logout = async () => {
  return signOut(auth);
};

export const onAuthChange = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, callback);
};
