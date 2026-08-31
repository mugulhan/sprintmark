# Google ile Giriş Kurulumu

Sprintmark iki giriş modu sunar:

- `local`: Yalnız loopback geliştirme ortamında çalışır ve Google hesabı gerektirmez.
- `google`: Davetli ve e-postası doğrulanmış Google hesaplarını OIDC ile doğrular.

Projeyi klonlayan bir geliştirici `npm start` sonrasında tarayıcıdaki ilk kurulum sihirbazından yerel veya Google modunu seçer. Google modu için Google Cloud projesinin sahibi bir kez OAuth istemcisi oluşturmalıdır. Client ID ve client secret kullanıcıya/projeye özel olduğu için repository tarafından güvenli biçimde otomatik üretilemez; sihirbaz bunların oluşturulacağı ekranı ve girilecek kesin callback adresini gösterir.

## 1. Google Cloud yapılandırması

1. [Google Cloud Console](https://console.cloud.google.com/) üzerinde geliştirme/test için ayrı bir proje oluşturun veya seçin.
2. **Google Auth Platform → Branding** altında uygulama adını, destek e-postasını ve gerekli marka alanlarını girin.
3. **Audience** altında:
   - Kurumsal Google Workspace projesinde yalnız çalışanlar kullanacaksa `Internal` seçin.
   - Aksi durumda `External / Testing` seçin ve giriş yapacak hesapları test kullanıcısı olarak ekleyin.
4. **Clients → Create client → Web application** seçin.
5. Yerel geliştirme istemcisine şu değeri tam olarak ekleyin:

   ```text
   Authorized redirect URI
   http://127.0.0.1:4310/auth/google/callback
   ```

   Konsol ayrıca origin isterse:

   ```text
   Authorized JavaScript origin
   http://127.0.0.1:4310
   ```

6. Oluşan Client ID ve Client Secret değerlerini kopyalayın. Secret değerini Git'e, issue metnine veya ekran görüntüsüne eklemeyin.

Google geliştirme sırasında loopback HTTP redirect URI'lerine izin verir. Loopback dışındaki bütün Sprintmark Google kurulumlarında `BASE_URL` ve callback HTTPS olmalıdır.

## 2. Tarayıcıdan ilk kurulum

Repository içinde çalıştırın:

```bash
npm ci
npm start
```

Ardından <http://127.0.0.1:4310> adresini açın. Herhangi bir kimlik modu yapılandırılmamışsa Sprintmark çalışma alanı yerine kurulum sihirbazını gösterir:

1. **Yerel kullanım** yalnız bu bilgisayarda hızlı değerlendirme ve geliştirme içindir. Görünen ad ile yerel profil e-postasını girmeniz yeterlidir.
2. **Google ile ekip kullanımı** için Google Web Client ID, Client Secret ve ilk sistem yöneticilerinin e-postalarını girin.
3. Google modunda ekranda gösterilen callback URI'sini Google Cloud'daki **Authorized redirect URIs** alanına aynen ekleyin.
4. **Yapılandır ve devam et** düğmesine basın. Güçlü `SESSION_SECRET` otomatik üretilir, ayarlar `.env.local` dosyasına yazılır ve seçilen giriş ekranı yeniden başlatma gerektirmeden açılır.

Web sihirbazı yalnız `127.0.0.1`, `localhost` veya `::1` üzerinden ilk yapılandırma tamamlanana kadar çalışır. Kurulum isteği kısa ömürlü, tek kullanımlık bir belirteç ve SameSite/HttpOnly cookie ile korunur. Client secret API yanıtında geri gönderilmez.

## 3. Terminalden yapılandırma

Headless sunucu veya terminal tercihinde aynı doğrulama kuralları şu komutla kullanılabilir:

```bash
npm ci
npm run setup:auth
```

Terminal sihirbazı şu bilgileri ister:

- `google` modu
- Uygulama adresi; yerelde varsayılan `http://127.0.0.1:4310`
- Google Web Client ID
- Google Client Secret
- İlk sistem yöneticisi olacak e-posta veya virgülle ayrılmış e-postalar

Sihirbaz:

- güçlü ve rastgele bir `SESSION_SECRET` üretir;
- değerleri Git tarafından yok sayılan `.env.local` dosyasına yazar;
- Google Console'a girilmesi gereken kesin callback URL'sini gösterir;
- yapılandırmayı HTTPS/loopback, client ID, e-posta ve secret kurallarına göre doğrular.

Ardından henüz çalışmıyorsa:

```bash
npm start
```

`npm start`, varsa önce `.env`, sonra `.env.local` dosyasını otomatik yükler. Giriş ekranında **Continue with Google** görünür.

## Otomasyona uygun kullanım

CI veya kurulum betikleri etkileşimsiz çalışabilir. Secret değerlerini komut satırı argümanı yerine secret store/environment üzerinden verin:

```bash
SPRINTMARK_AUTH_MODE=google \
CLIENT_ID="$CLIENT_ID" \
CLIENT_SECRET="$CLIENT_SECRET" \
BASE_URL="https://sprintmark.example.com" \
BOOTSTRAP_ADMIN_EMAILS="owner@example.com" \
npm run setup:auth -- --non-interactive --force --output=.env.local
```

Üretimde `.env.local` oluşturmak yerine aynı değişkenleri deployment platformunun secret manager'ından doğrudan container'a vermek tercih edilir.

## Docker

Docker Compose `.env` dosyasını kullanır:

```bash
npm run setup:auth -- --output=.env
docker compose up --build
```

Üretim `BASE_URL` değeri dışarıdan görülen kesin HTTPS adresi olmalı ve Google Console'daki redirect URI şu biçimde birebir eşleşmelidir:

```text
https://sprintmark.example.com/auth/google/callback
```

## Davetlerin iki katmanı

Google projesi `External / Testing` durumundaysa kullanıcı hem Google Console'da test kullanıcısı hem Sprintmark davet listesinde bulunmalıdır. `BOOTSTRAP_ADMIN_EMAILS` yalnız ilk yöneticileri oluşturur; sonraki davetler Sprintmark yönetici API'sinden veya ilerideki yönetim ekranından eklenir.

## Sorun giderme

- `redirect_uri_mismatch`: Google Console'daki callback ile `BASE_URL + /auth/google/callback` birebir aynı değildir.
- `access_denied`: Hesap Google test kullanıcılarında veya Sprintmark davet listesinde değildir.
- `Google authentication is disabled`: Sunucu Google değişkenlerini yüklememiştir; `.env.local` konumunu ve `SPRINTMARK_AUTH_MODE=google` değerini kontrol edin.
- Girişten sonra tekrar login ekranı: HTTP loopback dışında Secure cookie kullanımı için HTTPS gerekir; proxy'nin dış URL'si `BASE_URL` ile aynı olmalıdır.

Resmî kaynaklar:

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/openid-connect/openid-connect
- https://support.google.com/cloud/answer/15549945
