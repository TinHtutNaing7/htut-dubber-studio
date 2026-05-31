import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="my">
      <Head>
        <meta charSet="utf-8" />
        <meta name="description" content="Premium AI Movie Recap & Dubbing Production Suite — Myanmar Language" />
        <meta name="theme-color" content="#030712" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:wght@300;400;500;700&family=Noto+Sans+Myanmar:wght@400;500;700&display=swap" rel="stylesheet" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎬</text></svg>" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
