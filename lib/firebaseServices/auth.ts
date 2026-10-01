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

export const signup = async (email: string, password: string) => {
  return createUserWithEmailAndPassword(auth, email, password);
};

export const login = async (email: string, password: string) => {
  return signInWithEmailAndPassword(auth, email, password);
};

// 사용자가 스스로 닫았거나 취소한 경우는 재시도가 의미 없다 — 리디렉션으로 다시 보내면
// 오히려 "로그인 안 했는데 갑자기 딴 데로 이동" 하는 경험이 된다
const NON_RETRYABLE_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
]);

// 팝업(signInWithPopup)이 기본이지만, 팝업 차단이나 COOP(Cross-Origin-Opener-Policy) 때문에
// 팝업이 닫혔는지 못 읽어 실패하는 경우(콘솔에 "Cross-Origin-Opener-Policy policy would
// block the window.closed call" + "Database is closing/hidden"로 나타남)가 있어, 그 외의
// 실패는 리디렉션 방식으로 한 번 더 시도한다. 리디렉션은 popup.closed 를 읽을 필요가 없어
// 이 문제의 영향을 받지 않는다. 결과는 handleRedirectResult()가 페이지가 돌아온 뒤 받는다
export const loginWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code && NON_RETRYABLE_CODES.has(code)) throw e;
    return signInWithRedirect(auth, provider);
  }
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
