# AURA — Smart-Estate Experience Platform

White-label PWA platform for elite real estate agencies. Combines IoT smart-estate control, AI-powered staff automation, and an on-demand luxury concierge marketplace.

## Tech Stack

- **Framework**: TanStack Start (SSR) + Vite + React 19 + TypeScript
- **Styling**: Tailwind CSS
- **Runtime**: Bun / Node.js 22

## Quick Deploy (Vercel)

```bash
# 1. Install dependencies
bun install

# 2. Build the Vercel output bundle (includes SSR function)
bash build-vercel.sh

# 3. Deploy to Vercel
npx vercel deploy --prebuilt
```

The app will be live at `https://aura-xxxxx.vercel.app`.

## Local Development

```bash
bun install
bun run dev      # Dev server with HMR
bun run build    # Production build
bun run publish  # Build + serve on port 3000
```

## Features

- **Estate Dashboard**: Smart home controls (climate, pool/spa, security perimeter)
- **AI Staff Manager**: Natural language chat with intent-based task dispatch
- **Concierge Marketplace**: Yacht, chauffeur, catering, aviation bookings with mock checkout
- **Revenue Analytics**: Real-time transactions with 3% AURA + 12% agency fee logic
- **Multi-Property**: Three luxury villas (Como, Bellagio, Amalfi) with data isolation
- **White-Label**: Agency preset theming (Sotheby's, Engel & Völkers, Lionard)

## Architecture

```
src/
├── routes/
│   ├── index.tsx     # Main SPA — all tabs and components (~3800 lines)
│   └── __root.tsx    # Root layout
├── styles/
│   └── app.css       # Custom animations and utility classes
├── db.ts             # Database client
├── router.tsx        # Router configuration
└── routeTree.gen.ts  # Generated route tree

public/               # Static assets (favicon, manifest, PWA service worker)
```

## Revenue Model (Simulated)

| Allocation | % |
|---|---|
| AURA Platform Fee | 3% |
| Agency Commission | 12% |
| Vendor Payout | 85% |

All fee logic runs locally — no real Stripe integration is active in this build.