# Sprintmark Türkçe Kullanım Rehberi

Sprintmark; proje, sprint, takvim ve backlog yönetimini dosya tabanlı olarak çalıştıran, yerel öncelikli bir iş takip uygulamasıdır.

## Kurulum

```bash
npm ci
npm start
```

Ardından <http://127.0.0.1:4310> adresini açın. Yeni kurulumda tarayıcı sihirbazı yerel geliştirme profili veya Google ile ekip erişimi arasında seçim yaptırır; ayarları doğrular, güvenli oturum anahtarını üretir ve Git'in izlemediği `.env.local` dosyasına kaydeder. İlk çalışma alanı boştur; arayüzden proje oluşturabilir veya `npm run seed:demo` komutuyla örnek veri ekleyebilirsiniz.

## Temel kullanım

- Gün hücresindeki `+` düğmesi seçili tarih ve mevcut saatle iş oluşturur.
- Kartlar günler arasında sürüklenebilir; saat bilgisi korunur.
- Öncelik rozeti ve filtresi kritik, yüksek, orta ve düşük seviyelerini destekler.
- İş detayındaki **İş bilgileri** alanından durum, ekip, öncelik, tarih ve saat doğrudan güncellenebilir.
- **Tamamlandı olarak işaretle** işlemi kesin zamanı sunucuda otomatik kaydeder; detayda tarih/saat ve ne kadar önce tamamlandığı birlikte gösterilir. Yeniden açılan işin tamamlanma zamanı temizlenir.
- Editöre veya kanıt alanına birden fazla görsel `Ctrl+V` ile yapıştırılabilir. Kanıt alanına ayrıca PDF, CSV, JSON, metin, Markdown, XLSX ve DOCX dosyaları seçilerek ya da sürüklenerek eklenebilir.
- İş metninde veya `attachments` alanında geçen güvenli `data/` ve `docs/evidence/` referansları, kaynak dosya kopyalanmadan yeni sekmede açılabilir.
- İş metinleri Markdown, kayıt bilgileri YAML frontmatter olarak veri dizininde saklanır.

## Kimlik ve oturum

Loopback geliştirme ortamında yerel profil kullanılabilir. Google ile giriş için Google Cloud üzerinde bir Web OAuth istemcisi oluşturun; `npm start` sonrasında açılan tarayıcı sihirbazına Client ID, Client Secret ve ilk yönetici e-postalarını girin. Sihirbaz Google Console'a eklenmesi gereken kesin callback URL'sini ekranda gösterir.

Terminal veya otomasyon için aynı işlem ayrıca şu komutla yapılabilir:

```bash
npm run setup:auth
npm start
```

Tarayıcı kurulum ekranı yalnız loopback adresinde ve ilk yapılandırma tamamlanana kadar çalışır. Ayrıntılı kurulum için [Google ile giriş rehberine](GOOGLE_AUTH_SETUP.md) bakın.
