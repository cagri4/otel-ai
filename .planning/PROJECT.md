# OtelAI — Virtual Hotel Staff Platform

## What This Is

A SaaS platform that provides AI-powered virtual employees to boutique hotel owners. Instead of a traditional dashboard, hotel owners interact with a team of AI staff members — each with a specific role — who handle daily hotel operations autonomously or through chat-based conversations. Think of it as hiring a digital team that works 24/7, communicates naturally, and costs a fraction of real staff.

## Core Value

Boutique hotel owners with limited staff can run professional-level operations by deploying AI virtual employees that handle guest communication, bookings, and back-office tasks around the clock.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] AI sanal çalışan sistemi (her biri belirli bir otel rolünü üstleniyor)
- [ ] Chat bazlı etkileşim (otel sahibi elemanlarla sohbet edebilir)
- [ ] Otonom çalışma (elemanlar kendi başlarına görev yürütür, gerektiğinde insan müdahalesi ister)
- [ ] Misafir iletişimi (bazı elemanlar misafirlerle doğrudan iletişime geçer — WhatsApp/web chat)
- [ ] 5-6 temel otel rolü (araştırmada belirlenecek — resepsiyonist, housekeeping yöneticisi vb.)
- [ ] Çoklu dil desteği (uluslararası misafirler ve farklı pazarlar)
- [ ] Aylık abonelik sistemi (eleman/paket bazlı fiyatlandırma)
- [ ] Otel sahibi dashboard (ekibi yönetme, performans izleme, ayarlar)

### Out of Scope

- Fiziksel cihaz entegrasyonu (IoT, akıllı kilit vb.) — karmaşıklık, v1'de gereksiz
- Büyük zincir otellere özel enterprise özellikler — odak butik oteller
- Mobil app — web-first, mobil sonra
- Video/ses bazlı AI iletişim — text-first yaklaşım

## Context

- Butik oteller (10-50 oda) hedef segment — sınırlı personel, her elin bir işte olduğu yapılar
- AI elemanlar "gerçek çalışan" metaforuyla sunuluyor — klasik SaaS'ten farkı bu
- Bazı elemanlar misafir-facing (resepsiyonist), bazıları sadece iç ekiple çalışır (muhasebe)
- Hybrid çalışma modeli: otonom + chat bazlı müdahale
- Otel sektörü uluslararası — dil desteği kritik
- Eleman rolleri araştırma aşamasında belirlenecek (sektör analizi)

## Constraints

- **Tech Stack**: Next.js + Vercel deploy + GitHub
- **Database**: Supabase veya Firebase (araştırmada belirlenecek)
- **AI Engine**: Claude API (Anthropic) — tüm elemanların arkasında
- **Target Market**: Butik oteller, çoklu dil/pazar
- **Business Model**: Aylık abonelik (eleman/paket bazlı)
- **Approach**: Web-first, text-based iletişim

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| AI elemanlar metaforu (klasik SaaS yerine) | Otel sahipleri için daha anlaşılır, "ekip kurma" hissi veriyor | — Pending |
| Claude API (Anthropic) | Uzun context, güvenli, instruction-following — otel operasyonları için uygun | — Pending |
| Next.js + Vercel | Hızlı deploy, SSR, deneyim var | — Pending |
| Butik otel odağı | Sınırlı personel = en çok ihtiyaç duyan segment | — Pending |
| Chat + otonom hybrid | Ne tamamen otonom ne tamamen manuel — gerçekçi beklenti | — Pending |
| DB seçimi (Supabase vs Firebase) | Araştırmada belirlenecek | — Pending |

---
*Last updated: 2026-03-01 after initialization*
