import { auth } from '@/lib/firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
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

// 구글 로그인 (모바일은 리디렉션, 데스크탑은 팝업)
export const loginWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isMobile) {
    return signInWithRedirect(auth, provider);
  } else {
    return signInWithPopup(auth, provider);
  }
};

// 리디렉션 결과 처리
export const handleRedirectResult = async () => {
  return getRedirectResult(auth);
};

// 로그아웃
export const logout = async () => {
  return signOut(auth);
};

// 현재 사용자 감시
export const onAuthChange = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, callback);
};
