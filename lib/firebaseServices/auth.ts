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

// 이메일 회원가입
export const signup = async (email: string, password: string) => {
  return createUserWithEmailAndPassword(auth, email, password);
};

// 이메일 로그인
export const login = async (email: string, password: string) => {
  return signInWithEmailAndPassword(auth, email, password);
};

// 구글 로그인
export const loginWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
};

// 로그아웃
export const logout = async () => {
  return signOut(auth);
};

// 현재 사용자 감시
export const onAuthChange = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, callback);
};
