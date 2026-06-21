# Rota Fácil — Product Requirements

## Overview
Rota Fácil is a mobile delivery route optimization app (similar to Circuit) built in React Native / Expo. Drivers upload their delivery list (PDF, Excel, CSV, TXT, or paste manually), the app extracts package codes (Shopee BR…, Mercado Livre MLB…, Correios), geocodes addresses via free OpenStreetMap Nominatim API, displays them on an interactive dark map (Leaflet via WebView) with numbered pins and a polyline route, and lets the driver optimize using a TSP nearest-neighbor algorithm, scan barcodes with the camera, mark deliveries as completed/failed, navigate via Google Maps, and export a CSV report.

## Monetization
- Monthly subscription: R$ 20 / month (positioned as "less than R$ 1 per day")
- Payment via PIX (Brazilian instant payment), CNPJ key: 48.223.054/0001-42
- Static PIX BR Code (EMVCo / BACEN compliant) generated server-side
- User pays via banking app then taps "Já paguei" to activate (auto-confirms for MVP)

## Tech Stack
- Frontend: Expo SDK 54, React Native 0.81, expo-router, react-native-webview (Leaflet map), expo-camera (barcode scanner), react-native-qrcode-svg, expo-haptics, expo-document-picker, expo-clipboard
- Backend: FastAPI, MongoDB (motor), pandas/openpyxl/pypdf for file parsing, crcmod for PIX CRC16
- Storage: AsyncStorage (local route + user_id), MongoDB (subscriptions + PIX transactions)

## Key Screens
1. **Landing (/)** — Hero, features grid, subscribe CTA or start route
2. **Paywall (/paywall)** — Price card, benefits, PIX QR code, Copy Pix Copia e Cola, "Já paguei" confirmation
3. **Upload (/upload)** — Tabs (Arquivo / Manual), file picker, text paste area, processes via backend
4. **Route (/route)** — Map (top), stops list (middle), action bar (Navegar/Falhou/Entregue), floating active widget, menu modal
5. **Scanner (/scanner)** — expo-camera with framing overlay, torch toggle, code detection (Shopee/MLB/Correios)

## Backend Endpoints
- GET /api/ — health
- POST /api/parse-file — multipart upload, returns extracted Stop[]
- POST /api/parse-text — JSON {text}, returns extracted Stop[]
- POST /api/geocode-batch — batch geocode addresses via Nominatim
- POST /api/optimize — TSP nearest-neighbor
- POST /api/pix/generate — returns PIX EMV BR code + txid
- POST /api/pix/confirm — marks paid and activates 30-day subscription
- GET /api/subscription/{user_id} — subscription status

## Code Detection Patterns
- Shopee/Correios: `BR\d{11,15}`
- Correios international: `[A-Z]{2}\d{9}[A-Z]{2}`
- Mercado Livre: `MLB\d{10,14}`
- Generic numeric tracking: `\d{14,18}`
