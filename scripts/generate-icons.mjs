import sharp from 'sharp'

const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#7c3aed" rx="80"/>
  <text x="256" y="320" font-size="220" font-weight="bold" text-anchor="middle" fill="white" font-family="sans-serif">LP</text>
</svg>`

const buf = Buffer.from(svg)
await sharp(buf).resize(192).png().toFile('public/icon-192.png')
await sharp(buf).resize(512).png().toFile('public/icon-512.png')
console.log('아이콘 생성 완료!')
