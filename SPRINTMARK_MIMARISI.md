# Sprintmark Mimarisi

## 1. Amaç ve kapsam

Sprintmark; proje, sprint, takvim, backlog ve iş kayıtlarını tek kullanıcıya yönelik yerel bir çalışma alanında yöneten, veritabanı gerektirmeyen bir iş takip uygulamasıdır. Uygulama Node.js üzerinde çalışır ve kalıcı verileri okunabilir YAML/Markdown dosyalarında tutar.

Temel tasarım hedefleri:

- Yerel ve taşınabilir çalışma alanı
- İnsan tarafından okunabilir, sürüm kontrolüne uygun veri dosyaları
- Proje bazlı iş, sprint ve doküman ayrımı
- Markdown tabanlı zengin iş kaydı içeriği
- Güvenli dosya eki, önizleme ve çalışma alanı referansları
- Türkçe ve İngilizce arayüz

## 2. Sistem bağlamı

```text
Tarayıcı
  └─ HTTP/JSON + statik dosyalar
       └─ Node.js HTTP sunucusu (src/server.mjs)
            ├─ ProjectStore
            ├─ WorkItemStore
            ├─ SprintStore
            ├─ DraftStore
            └─ Dosya tabanlı çalışma alanı
```

Uygulama varsayılan olarak `127.0.0.1:4310` üzerinde çalışır. Kimlik doğrulama katmanı bulunmadığı için doğrudan genel internete açılmamalıdır.

## 3. Uygulama katmanları

### 3.1 Sunum katmanı

- `public/index.html`: uygulama kabuğu, diyaloglar ve erişilebilir statik yapı
- `public/app.js`: rota durumu, veri yükleme, ekran üretimi ve kullanıcı etkileşimleri
- `public/i18n.js`: kararlı anahtarlara dayalı Türkçe/İngilizce mesaj katalogları, parametre ve çoğul desteği
- `public/styles.css`: takvim, proje paneli, breadcrumb, görev detayları ve doküman okuyucu stilleri
- Toast UI Editor: iş kayıtlarının Markdown tabanlı düzenlenmesi ve güvenli görüntülenmesi

Arayüz tek sayfa uygulaması davranışı gösterir. Canonical rotalar History API ile korunur; yenileme, geri/ileri ve doğrudan bağlantı senaryoları sunucu tarafından aynı uygulama kabuğuna yönlendirilir.

### 3.2 HTTP ve uygulama servisi

`src/server.mjs` aşağıdaki sorumlulukları taşır:

- Statik uygulama dosyalarını sunma
- Proje, iş kaydı, sprint ve taslak API uçlarını yönlendirme
- ETag/`If-Match` ile eşzamanlı güncelleme çakışmalarını önleme
- Dosya yükleme limitlerini ve türlerini uygulama
- Canonical proje ve iş kaydı rotalarını koruma
- Güvenli inline önizleme ve zorunlu indirme yanıtları üretme

Başlıca API grupları:

- `/api/v1/projects`
- `/api/v1/work-items`
- `/api/v1/sprints`
- `/api/v1/drafts`
- Proje dokümanı ve iş kaydı eki alt uçları

### 3.3 Alan ve kalıcılık katmanı

- `src/projects.mjs`: proje oluşturma, güncelleme ve proje dokümanları
- `src/store.mjs`: iş kayıtları, durum geçişleri, ekler ve özet üretimi
- `src/sprints.mjs`: proje bazlı sprintler
- `src/drafts.mjs`: henüz kaydedilmemiş iş kayıtlarının dosya ekleri
- `src/records.mjs`: YAML ön bilgi ve Markdown gövdesi okuma/yazma
- `src/summaries.mjs`: iş kayıtlarından türetilen özet dosyaları
- `src/identity.mjs`: kimlik, anahtar, slug ve alan doğrulama kuralları
- `src/files.mjs`: dosya türü, MIME, imza ve güvenli yol kontrolleri

## 4. Veri modeli

### 4.1 Proje

Her proje `PRJ-xxx` biçiminde değişmez bir anahtara ve iş kayıtlarında kullanılacak kısa bir proje koduna sahiptir. Projede ad, slug, açıklama, durum ve doküman referansları bulunur.

### 4.2 İş kaydı

İş kayıtları proje kodundan üretilen `SPM-0001` gibi anahtarlar kullanır. YAML metadatası; tür, proje, durum, ekip, öncelik, planlama, tamamlanma zamanı ve ekleri taşır. Açıklama gövdesi Markdown olarak saklanır.

### 4.3 Sprint

Sprintler proje anahtarıyla ilişkilidir; başlangıç ve bitiş tarihleriyle takvim üzerinde çalışma aralığı sağlar.

### 4.4 Doküman ve ekler

Proje dokümanları iki kaynaktan gelebilir:

- Çalışma alanında güvenli biçimde bağlanan dosya
- Uygulamanın yönettiği depoya yüklenen dosya

İş kaydı ekleri de görsel, PDF, CSV, JSON, metin, Markdown, XLSX ve DOCX biçimlerini destekler. Görseller lightbox içinde, metin tabanlı dosyalar ve PDF tarayıcıda, Office dosyaları indirilerek açılır.

## 5. Rotalama ve navigasyon

Temel canonical rotalar:

- `/projects/`: proje çatısı
- `/projects/{project-key}/{slug}`: proje özeti
- `/projects/{project-key}/{slug}?tab=documents`: proje dokümanları
- `/`: seçili projenin takvimi
- `/backlog`: seçili projenin backlog görünümü
- `/work-items/{item-key}/{slug}`: doğrudan iş kaydı

Global breadcrumb; Projects, proje, görünüm ve açık görev bağlamını gerçek bağlantılarla ifade eder. Son segment `aria-current="page"` taşır.

## 6. Yerelleştirme

Sistem metinleri `public/i18n.js` içindeki kararlı anahtarlarla yönetilir. Render sırasında `t()` ve sayılı mesajlar için `tp()` kullanılır. Proje açıklaması, görev başlığı ve doküman içeriği gibi kullanıcı verileri çevrilmez.

Dil tercihi tarayıcıda saklanır, ilk görünür render öncesinde uygulanır ve açık ekran yenileme gerektirmeden yeniden üretilir.

## 7. Dosya güvenliği

- Genel görev eki limiti dosya başına 25 MB, görev başına 20 dosyadır.
- İçerik içine eklenen görsellerde 8 MB sınırı korunur.
- Uzantı, MIME türü ve desteklenen biçimlerde dosya imzası birlikte doğrulanır.
- HTML, SVG, arşiv ve çalıştırılabilir dosyalar kabul edilmez.
- Çalışma alanı referanslarında absolute path, `..`, symlink kaçışı ve izin verilen köklerin dışı reddedilir.
- Dosya yanıtlarında doğru `Content-Type`, `Content-Disposition` ve `X-Content-Type-Options: nosniff` kullanılır.

## 8. Tutarlılık ve hata yönetimi

Proje ve iş kaydı güncellemeleri içerik ETag’i üretir. Yazma çağrıları güncel `If-Match` değeri taşımadığında işlem reddedilir; böylece eski bir ekranın daha yeni veriyi sessizce ezmesi önlenir.

Dosya yazımları mümkün olduğunda atomik gerçekleştirilir. Taslak eki kalıcı göreve taşınırken hazırlama, finalize ve rollback adımları uygulanır.

## 9. Test ve kalite kapıları

Ana kalite komutları:

```bash
npm test
npm run lint
npm run format:check
```

Test paketi; veri mağazalarını, HTTP uçlarını, dosya güvenliğini, proje dokümanlarını, canonical rotaları, i18n katalog eşitliğini, çoğulları ve breadcrumb üretimini kapsar. Kritik kullanıcı akışları ayrıca `127.0.0.1:4310` üzerinde gerçek tarayıcıyla doğrulanır.

## 10. Dağıtım ve işletim

Gereksinimler Node.js 22+ ve npm 10+ sürümleridir. Uygulama doğrudan Node.js ile veya Docker Compose üzerinden çalıştırılabilir. Kalıcı çalışma alanı `SPRINTMARK_DATA_DIR`, dil `SPRINTMARK_DEFAULT_LOCALE`, saat dilimi `SPRINTMARK_TIMEZONE`, dinleme adresi ve port ise `SPRINTMARK_HOST`/`SPRINTMARK_PORT` değişkenleriyle yapılandırılır.

## 11. Sürümleme yaklaşımı

- Yeni kullanıcı yetenekleri minor sürümü artırır.
- Geriye uyumlu düzeltmeler patch kapsamındadır.
- Çalışma alanı veri şeması değişiklikleri açık migrasyon komutuyla yürütülür.
- Proje ve iş kaydı anahtarları değişmez kimlik olarak korunur.
