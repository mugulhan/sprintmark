# Sprintmark Türkçe Kullanım Rehberi

Sprintmark; proje, sprint, takvim ve backlog yönetimini dosya tabanlı olarak çalıştıran, yerel öncelikli bir iş takip uygulamasıdır.

## Kurulum

```bash
npm ci
npm start
```

Ardından <http://127.0.0.1:4310> adresini açın. İlk açılışta çalışma alanı boştur; arayüzden proje oluşturabilir veya `npm run seed:demo` komutuyla örnek veri ekleyebilirsiniz.

## Temel kullanım

- Gün hücresindeki `+` düğmesi seçili tarih ve mevcut saatle iş oluşturur.
- Kartlar günler arasında sürüklenebilir; saat bilgisi korunur.
- Öncelik rozeti ve filtresi kritik, yüksek, orta ve düşük seviyelerini destekler.
- Editöre veya kanıt alanına birden fazla görsel `Ctrl+V` ile yapıştırılabilir.
- İş metinleri Markdown, kayıt bilgileri YAML frontmatter olarak veri dizininde saklanır.

Bu sürümde kullanıcı hesabı ve yetkilendirme yoktur. Uygulamayı doğrudan internete açmayın.
