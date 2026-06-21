# Rota+Rápida App — Product Requirements

## Overview
Mobile delivery app for Brazilian drivers built in React Native / Expo. After the June 2026 PIVOT, the MVP focuses on a single, opinionated flow: **driver loads the Circuit PDF, the app preserves the PDF order exactly, and the camera Scanner is the main work surface**. Whenever the driver beeps a package, the app speaks the stop number aloud (e.g. "Parada 10") using Text-to-Speech and increments the "X de Y" counter. Map, route optimization (TSP) and location editing are temporarily locked behind an "EM BREVE" (coming soon) state.

## Monetization
- Monthly subscription: R$ 20 / month (positioned as "less than R$ 1 per day")
- Payment via PIX (Brazilian instant payment), CNPJ key: 48.223.054/0001-42
- Static PIX BR Code (EMVCo / BACEN compliant) generated server-side
- User pays via banking app then taps "Já paguei". Admin approves manually via the Russian-doll honeypot-protected `/admin` dashboard.

## Tech Stack
- Frontend: Expo SDK 54, React Native 0.81, expo-router, expo-camera (barcode scanner), **expo-speech (TTS)**, react-native-qrcode-svg, expo-haptics, expo-document-picker, expo-clipboard
- Backend: FastAPI, MongoDB (motor), pandas/openpyxl/pypdf for file parsing, crcmod for PIX CRC16
- Storage: AsyncStorage (local route + user_id), MongoDB (subscriptions + PIX transactions + admin users)

## Key Screens (post-pivot)
1. **Landing (/)** — Hero, 4 feature cards (PDF Circuit ✓, Scanner ✓, Mapa EM BREVE, Otimização EM BREVE), primary CTA = "Carregar PDF do Circuit" or "Continuar Rota • N paradas".
2. **Paywall (/paywall)** — PIX QR code, Copy Pix Copia e Cola, "Já paguei" → pending state.
3. **Upload (/upload)** — Picks PDF/XLSX/CSV/TXT, parses via backend, saves stops, then jumps **directly to /scanner**.
4. **Scanner (/scanner)** — Full-screen camera. On scan: matches code → marks stop as `entregue` → persists → speaks "Parada N" (pt-BR) → shows X de Y counter, last delivered badge, and reset/new-route button.
5. **Admin (/admin)** — JWT login with honeypot rate-limiting; approve/reject pending PIX submissions.
6. **Route (/route)** — Locked. Auto-redirects to /scanner (has route) or /upload (no route).

## Backend Endpoints
- GET /api/ — health
- POST /api/parse-file — multipart upload, returns extracted Stop[] preserving Circuit PDF order
- POST /api/parse-text — JSON {text}, returns extracted Stop[]
- POST /api/geocode-batch — batch geocode (Mapbox + Nominatim/Photon fallback) — still works for future map unlock
- POST /api/optimize — TSP nearest-neighbor — kept for future unlock
- POST /api/pix/generate — returns PIX EMV BR code + txid
- POST /api/pix/confirm — marks paid and activates 30-day subscription
- GET /api/subscription/{user_id} — subscription status

## Code Detection Patterns
- Shopee/Correios: `BR\d{11,15}`
- Correios international: `[A-Z]{2}\d{9}[A-Z]{2}`
- Mercado Livre: `MLB\d{10,14}`
- Generic numeric tracking: `\d{14,18}`
