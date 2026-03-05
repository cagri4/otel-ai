# OtelAI — Virtual Hotel Staff Platform

## What This Is

A SaaS platform that provides AI-powered virtual employees to boutique hotel owners. Instead of a traditional dashboard, hotel owners interact with a team of AI staff members — each with a specific role — who handle daily hotel operations autonomously or through chat-based conversations. Think of it as hiring a digital team that works 24/7, communicates naturally, and costs a fraction of real staff.

## Core Value

Boutique hotel owners with limited staff can run professional-level operations by deploying AI virtual employees that handle guest communication, bookings, and back-office tasks around the clock.

## Current Milestone: v2.0 Agent-Native SaaS

**Goal:** Tüm otel sahibi etkileşimini Telegram-first agent-native modele taşımak — her AI eleman ayrı Telegram botu, kurulum sohbetle, fiyatlandırma eleman bazlı

**Target features:**
- Süper admin paneli (tek kişilik, üyelik oluşturma, Telegram link üretme)
- Kurulum Sihirbazı Telegram botu (onboarding tamamen sohbet ile)
- Her AI eleman ayrı Telegram botu (Front Desk, Booking, Housekeeping, Guest Experience)
- Eleman bazlı fiyatlandırma (her eleman farklı fiyat, seçtiklerin toplamı = aylık ücret)
- 14 gün deneme süresi (tüm elemanlar aktif)
- Deneme sonu eleman seçimi akışı (Telegram üzerinden)
- Web dashboard opsiyonel readonly görünüm

## Requirements

### Validated

- ✓ AI sanal çalışan sistemi (4 rol: Front Desk, Guest Experience, Booking, Housekeeping) — v1.0
- ✓ Chat bazlı etkileşim (otel sahibi elemanlarla sohbet edebilir) — v1.0
- ✓ Otonom çalışma (elemanlar kendi başlarına görev yürütür, gerektiğinde insan müdahalesi ister) — v1.0
- ✓ Misafir iletişimi (WhatsApp + web chat widget) — v1.0
- ✓ Çoklu dil desteği (EN, TR, NL, DE, FR) — v1.0
- ✓ Aylık abonelik sistemi (iyzico TR + Mollie EU) — v1.0
- ✓ Otel sahibi dashboard (ekip yönetimi, konuşma geçmişi, audit log) — v1.0
- ✓ Multi-tenant izolasyon (Supabase RLS) — v1.0
- ✓ Onboarding wizard (5 dakikada kurulum) — v1.0

### Active

- [ ] Telegram Bot API entegrasyonu (her eleman ayrı bot)
- [ ] Kurulum Sihirbazı Telegram botu (sohbet ile A'dan Z'ye kurulum)
- [ ] Süper admin paneli (üyelik oluşturma, Telegram link üretme)
- [ ] Eleman bazlı fiyatlandırma (her eleman farklı fiyat)
- [ ] 14 gün deneme + eleman seçimi akışı
- [ ] Mevcut agent'ların Telegram'a adaptasyonu
- [ ] Web dashboard readonly modda opsiyonel erişim

### Out of Scope

- Fiziksel cihaz entegrasyonu (IoT, akıllı kilit vb.) — karmaşıklık
- Büyük zincir otellere özel enterprise özellikler — odak butik oteller
- Mobil app — Telegram zaten mobil çalışıyor
- Video/ses bazlı AI iletişim — text-first yaklaşım
- Telegram Payments API — mevcut iyzico+Mollie web ödeme yeterli
- Birden fazla süper admin — şimdilik tek kişi

## Context

- Butik oteller (10-50 oda) hedef segment — sınırlı personel, her elin bir işte olduğu yapılar
- AI elemanlar "gerçek çalışan" metaforuyla sunuluyor — klasik SaaS'ten farkı bu
- v1.0 web dashboard ile 8 phase tamamlandı (20 plan, ~236 min execution)
- v2.0 pivotu: web-first → Telegram-first (agent-native SaaS)
- Otel sahibi Telegram'dan yönetir, misafirler WhatsApp'tan iletişim kurar
- Süper admin (tek kişi) üyelik açar → Telegram link → otel sahibi onboarding
- Eleman bazlı fiyatlandırma: her eleman ayrı fiyat, otel sahibi tutmak istediklerini seçer

## Constraints

- **Tech Stack**: Next.js + Vercel + Supabase + GitHub (v1.0'dan devam)
- **AI Engine**: Claude API (Anthropic) — tüm elemanların arkasında
- **Owner Channel**: Telegram Bot API (her eleman ayrı bot)
- **Guest Channel**: WhatsApp (mevcut Twilio entegrasyonu)
- **Payment**: iyzico (TR) + Mollie (EU) — web üzerinden ödeme
- **Business Model**: Eleman bazlı fiyatlandırma (her eleman farklı aylık ücret)
- **Admin**: Tek süper admin paneli

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| AI elemanlar metaforu (klasik SaaS yerine) | Otel sahipleri için daha anlaşılır, "ekip kurma" hissi veriyor | — Pending |
| Claude API (Anthropic) | Uzun context, güvenli, instruction-following — otel operasyonları için uygun | — Pending |
| Next.js + Vercel | Hızlı deploy, SSR, deneyim var | — Pending |
| Butik otel odağı | Sınırlı personel = en çok ihtiyaç duyan segment | — Pending |
| Chat + otonom hybrid | Ne tamamen otonom ne tamamen manuel — gerçekçi beklenti | — Pending |
| DB seçimi (Supabase vs Firebase) | Araştırmada belirlenecek | ✓ Good — Supabase |
| Telegram-first pivot (v2.0) | Agent-native SaaS — otel sahibi dashboard yerine Telegram'dan yönetir | — Pending |
| Her eleman ayrı Telegram botu | Gerçekçi "eleman" hissi, bağımsız sohbetler | — Pending |
| Eleman bazlı fiyatlandırma | Sezgisel: "Front Desk X TL, Booking Y TL" — otel sahibi bütçesine göre seçer | — Pending |
| Kurulum Sihirbazı ayrı bot | Onboarding bittikten sonra pasifleşir, her bot ayrı chat yapısına uygun | — Pending |

---
*Last updated: 2026-03-06 after v2.0 milestone start*
