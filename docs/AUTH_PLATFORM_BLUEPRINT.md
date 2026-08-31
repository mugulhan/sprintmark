# Acıbadem Uygulama Kimliği ve Oturum Platformu

## Amaç

Acıbadem iç uygulamalarında giriş, oturum, CSRF, kullanıcı kimliği ve denetim kaydı kurallarını tekrar geliştirmeden güvenli ve sürümlenebilir biçimde kullanmak. Sprintmark, ortak sözleşmenin referans uygulamasıdır; uygulamaya özgü proje ve iş akışı yetkileri ortak kimlik katmanının üzerinde kalır.

## Mimari karar

Tarayıcı uygulamaları Backend-for-Frontend (BFF) modeli kullanır. Google OIDC yetkilendirme kodu akışı yalnız sunucuda tamamlanır. Google erişim ve yenileme tokenları tarayıcıya veya uygulama veri dosyalarına verilmez. Her uygulama kendi opak, sunucu taraflı oturumunu ve kendi cookie adını kullanır; uygulamalar arasında cookie paylaşılmaz.

```text
Browser
  -> uygulama BFF / auth adapter
       -> ortak OIDC istemcisi
       -> Google Identity
       -> ortak session store adapter
       -> uygulamaya özgü authorization policy
       -> ortak audit event envelope
```

Google ile merkezi SSO kullanıcı deneyimi OIDC yönlendirmesiyle sağlanır. Tek bir üst-domain cookie'sini bütün uygulamalara açmak kapsam dışıdır.

## Dağıtılabilir bileşenler

1. `@acibadem/auth-contracts`
   - OpenAPI tanımları, JSON Schema modelleri ve hata kodları.
   - `/auth/{provider}/start`, `/auth/{provider}/callback`, `/api/v1/session`, `/api/v1/logout` sözleşmesi.
   - `UserIdentity`, `SessionView`, `ActorSnapshot` ve `AuditEvent` şemaları.
2. `@acibadem/app-auth-node`
   - Node HTTP/Express/Fastify middleware'leri.
   - OIDC discovery, authorization code + PKCE, state, nonce, ID token doğrulaması.
   - Cookie, CSRF, session rotation, logout ve actor üretimi.
3. `acibadem-app-auth`
   - FastAPI/Starlette ve gerektiğinde Flask adaptörleri.
   - Node paketiyle aynı sözleşme ve test vektörleri.
4. `@acibadem/auth-ui`
   - Framework bağımsız giriş, hesap, çıkış ve oturum süresi bileşenleri.
   - Uygulama kabuğu için TR/EN mesaj anahtarları; ürün adı ve renkleri uygulamadan alınır.
5. `@acibadem/auth-testkit`
   - Sahte OIDC sağlayıcısı, iki kullanıcı senaryoları, cookie/CSRF yardımcıları ve yetki matrisi testleri.

Paketler tek bir `acibadem-app-platform` monoreposunda bağımsız SemVer sürümleriyle yayınlanır. Uygulamalar sabit major sürüme bağlanır; Renovate/Dependabot kontrollü güncelleme PR'ları açar.

## Değişmez güvenlik kuralları

- Üretimde yalnız HTTPS ve önceden kayıtlı tam callback URL'leri kullanılır.
- Authorization Code Flow, PKCE `S256`, tek kullanımlık `state` ve `nonce` zorunludur.
- `iss`, `aud`, imza, `exp`, `iat`, `nonce`, doğrulanmış e-posta ve değişmez `sub` doğrulanır.
- Tarayıcı yalnız uygulamaya özel opak session cookie'si taşır. Üretim cookie'si `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` ve mümkünse `__Host-` önekli olur.
- Session store yalnız session özeti tutar; sağlayıcı tokenları kalıcı olarak saklanmaz.
- Mutasyon aktörü yalnız doğrulanmış sunucu oturumundan üretilir. İstemci `actor_id`, e-posta veya rol gönderemez.
- Bütün mutasyonlar CSRF tokenı, Origin kontrolü ve uygulamanın yetki politikasıyla korunur.
- Logout session kaydını iptal eder ve cookie'yi siler. Yenileme kendiliğinden yeniden giriş yapamaz.
- Yerel profil varsayılan olarak kapalıdır; yalnız loopback üzerinde açıkça etkinleştirilir. Giriş ve çıkış yine gerçek session cookie'si kullanır.
- Cookie adları uygulama bazında namespaced olur; localhost portlarının cookie izolasyonu sağlamadığı varsayılır.
- Session kimliği girişte ve yetki seviyesi değişiminde döndürülür. Mutlak ve hareketsizlik zaman aşımı uygulanır.
- Güvenlik olayları kişisel veriyi ve secret değerleri loglamadan yapılandırılmış biçimde kaydedilir.

## Ortak veri sözleşmesi

```yaml
identity:
  id: usr-001
  provider: google
  provider_subject: immutable-google-sub
  email: user@example.com
  email_verified: true
  display_name: Example User
  avatar_url: https://...
  status: active

actor:
  type: user
  id: usr-001
  display_name: Example User

audit_event:
  id: evt-...
  type: changed
  actor: { type: user, id: usr-001, display_name: Example User }
  occurred_at: 2026-08-28T12:24:10.000Z
  request_id: req-...
  target: { type: work_item, id: wi-... }
  changes: []
```

Kimlik katmanı “bu kişi kim?” sorusunu yanıtlar. “Bu projede ne yapabilir?” kararı uygulamanın policy modülünde kalır. Ortak paket yalnız `requireSession`, sistem rolü, ekip üyeliği ve policy çağırma arayüzünü sağlar.

## Standart HTTP davranışı

- `GET /api/v1/session`: giriş varsa kullanıcı, CSRF tokenı, auth modu ve süreleri; yoksa `401` ile auth modu ve güvenli giriş URL'si.
- `GET /auth/{provider}/start`: tek kullanımlık giriş işlemi başlatır.
- `GET|POST /auth/{provider}/callback`: doğrulamadan sonra yeni session üretir ve izin verilen yerel dönüş URL'sine yönlendirir.
- `POST /api/v1/logout`: CSRF doğrular, session'ı iptal eder ve cookie'yi temizler. İdempotent tasarlanır.
- API hataları sabit kod, kullanıcı mesaj anahtarı ve `request_id` döndürür; stack trace istemciye verilmez.

## Uygulama sırası

### Faz 0 — Sprintmark referansı

- Yerel ve Google girişlerini aynı session yaşam döngüsüne getir.
- Sign-out sonrası yenileme regresyonunu test et.
- Mevcut OAuth, CSRF, davet, askıya alma, rol ve audit testlerini test kitinin başlangıç vektörleri yap.

### Faz 1 — Sözleşme ve test kiti

- OpenAPI/JSON Schema paketini çıkar.
- Sahte OIDC sağlayıcısı ve dil bağımsız uygunluk testlerini yayınla.
- Cookie adlandırma, hata kodu ve env değişkeni standardını sabitle.

### Faz 2 — Node ve Python adaptörleri

- Sprintmark auth çekirdeğini Node paketine çıkar; Sprintmark paketin ilk tüketicisi olur.
- Python adaptörünü aynı test vektörleriyle geliştir.
- Dosya store, Redis ve SQL session store arayüzlerini tanımla; üretimde Redis/SQL tercih et.

### Faz 3 — Pilot uygulamalar

- SiteFlow'u Node veya Python adaptörüyle ilk pilot yap.
- İki gerçek kullanıcıyla giriş, çıkış, session expiry, askıya alma, CSRF ve audit kabul testi çalıştır.
- Gözlemleme panosu: giriş başarısı, callback hatası, 401/403 oranı ve aktif session sayısı.

### Faz 4 — Portföy yayılımı

- Yeniweb yardımcı uygulamalarını risk ve kullanıcı sayısına göre sırala.
- Her uygulama için mevcut auth kaldırma, kullanıcı eşleme, rollback ve secret rotation planı hazırla.
- Eski auth kodunu ancak iki sürümlük geri dönüş penceresinden sonra kaldır.

## Kabul kapıları

- Ortak conformance testleri Node ve Python'da aynı sonuçları verir.
- İki tarayıcı kullanıcısıyla login, logout, refresh, session expiry ve hesap askıya alma geçer.
- PKCE/state/nonce tekrar kullanımı, callback mix-up, CSRF, session fixation ve cookie çakışması testleri geçer.
- Uygulama aktörü istemciden taklit edilemez; audit zamanları UTC ve değişmezdir.
- Paket yükseltmesi uygulama başına yeni auth kodu yazmayı gerektirmez.

## Standart dayanakları

- OAuth 2.0 Security Best Current Practice: https://www.rfc-editor.org/rfc/rfc9700
- OpenID Connect Core 1.0: https://openid.net/specs/openid-connect-core-1_0.html
- Google OpenID Connect server flow: https://developers.google.com/identity/openid-connect/openid-connect
- OAuth 2.0 for Browser-Based Applications (BFF guidance): https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/
