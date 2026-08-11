import { getApps, getApp, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore } from 'firebase/firestore';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Next.js HMR로 이 모듈이 재실행돼도 기존 앱을 재사용 (중복 초기화 방지)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);

// Initialize Cloud Firestore and get a reference to the service
// Safari에서 백그라운드 전환 시 WebChannel 스트림이 끊기며 발생하는
// "Database is closing/hidden" 오류를 막기 위해 long polling을 강제
// HMR 재실행 시 이미 초기화된 Firestore가 있으면 재사용 (다른 옵션으로
// 재호출 시 발생하는 "initializeFirestore() has already been called" 방지)
let db: ReturnType<typeof getFirestore>;
try {
  db = initializeFirestore(app, {
    experimentalForceLongPolling: true,
  });
} catch {
  db = getFirestore(app);
}
export { db };

// Google Analytics 초기화 (브라우저 + 지원 환경에서만; SSR·미지원 브라우저에서는 건너뜀)
export let analytics: Analytics | undefined;
if (typeof window !== 'undefined') {
  isSupported()
    .then((supported) => {
      if (supported) analytics = getAnalytics(app);
    })
    .catch((e) => console.error('[firebase] Analytics 초기화 실패', e));
}

export default app;