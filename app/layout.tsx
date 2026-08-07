import type { Metadata, Viewport } from 'next'
import { Noto_Sans_KR, Inter } from 'next/font/google'
import './globals.css'

const notoSansKR = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-noto',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'LawPass AI — 변호사시험 AI 학습 플랫폼',
  description: '변호사시험 수험생을 위한 AI 기반 문제 분석, CBT 실전 모드, 오답노트, D-1 암기장 플랫폼',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#1a1040',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${notoSansKR.variable} ${inter.variable} bg-background`}>
      <body className="antialiased font-sans min-h-screen">{children}</body>
    </html>
  )
}
