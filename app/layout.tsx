import type { Metadata, Viewport } from 'next'
import { Noto_Sans_KR, Inter } from 'next/font/google'
import Script from 'next/script'
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
  description: '수험생을 위한 AI 기반 객관식 문제 분석, CBT 실전 모드, 오답노트, D-1 암기장 플랫폼',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LawPass AI',
  },
  icons: {
    icon: [
      { url: '/icon-192.png?v=2', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png?v=2', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icon-192.png?v=2',
  },
  openGraph: {
    title: 'LawPass AI — 변호사시험 AI 학습 플랫폼',
    description: '수험생을 위한 AI 기반 문제 분석, CBT 실전 모드, 오답노트, D-1 암기장 플랫폼',
    siteName: 'LawPass AI',
    images: [
      {
        url: '/icon-512.png?v=2',
        width: 512,
        height: 512,
        alt: 'LawPass AI Logo',
      },
    ],
    locale: 'ko_KR',
    type: 'website',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#7c3aed',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning className={`${notoSansKR.variable} ${inter.variable}`}>
      <body className="antialiased font-sans min-h-screen bg-background text-foreground">
        <Script id="theme-init" strategy="beforeInteractive">
          {`
            try {
              var theme = localStorage.getItem('lawpass_theme') || 'light';
              document.documentElement.classList.add(theme);
            } catch(e) {}
          `}
        </Script>
        {children}
      </body>
    </html>
  )
}