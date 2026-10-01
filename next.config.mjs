import withPWA from 'next-pwa'

const pwaConfig = withPWA({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // 구글 로그인 팝업(signInWithPopup) 대응.
  //
  // 콘솔에 "Cross-Origin-Opener-Policy policy would block the window.closed call"가 뜨면서
  // 로그인이 "로그인에 실패했습니다"로 떨어지는 문제 — Firebase Auth 가 팝업이 닫혔는지
  // popup.closed 를 직접 읽어서 확인하는데, COOP 가 same-origin(또는 설정이 아예 없어 브라우저
  // 기본값)이면 팝업이 별도 브라우징 컨텍스트 그룹으로 격리돼 그 값을 못 읽는다.
  // same-origin-allow-popups 로 두면 격리는 유지하면서 팝업과의 관계는 열어 둔다
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' }],
      },
    ]
  },
}

export default pwaConfig(nextConfig)
