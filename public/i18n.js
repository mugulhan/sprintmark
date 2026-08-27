const english = new Map([
  ["Takvim", "Calendar"],
  ["Sorun Backlog'u", "Issue backlog"],
  ["Projeler", "Projects"],
  ["Yeni iş", "New item"],
  ["Proje", "Project"],
  ["Yeni proje", "New project"],
  ["Son aya git", "Latest month"],
  ["Tüm durumlar", "All statuses"],
  ["Tüm ekipler", "All teams"],
  ["İçerik / Teknik", "Content / Technical"],
  ["Web Yazılım", "Web development"],
  ["Tüm öncelikler", "All priorities"],
  ["Belirlenmedi", "Unspecified"],
  ["Kritik", "Critical"],
  ["Yüksek", "High"],
  ["Orta", "Medium"],
  ["Düşük", "Low"],
  ["Sprint oluştur", "Create sprint"],
  ["Pazartesi", "Monday"],
  ["Salı", "Tuesday"],
  ["Çarşamba", "Wednesday"],
  ["Perşembe", "Thursday"],
  ["Cuma", "Friday"],
  ["Cumartesi", "Saturday"],
  ["Pazar", "Sunday"],
  ["Tarihi bulunmayan işler", "Unscheduled items"],
  ["Kartı takvimdeki bir güne sürükleyin.", "Drag a card onto a calendar day."],
  ["Tarihi kaldırmak için buraya bırakın", "Drop here to remove the date"],
  ["Kalıcı bağlantıyı kopyala", "Copy permanent link"],
  ["İçeriği düzenle", "Edit item"],
  ["İş bilgileri", "Work item fields"],
  ["Bilgileri güncelle", "Update fields"],
  ["✓ Tamamlandı olarak işaretle", "✓ Mark as done"],
  ["Yeniden aç", "Reopen"],
  ["Kanıt görseli ekle", "Add evidence image"],
  ["Kanıt görselleri", "Evidence images"],
  ["Kanıt dosyaları", "Evidence files"],
  ["Görsel ekle", "Add image"],
  ["Dosya ekle", "Add file"],
  ["Aç", "Open"],
  ["İndir", "Download"],
  ["Dosya bulunamadı", "File not found"],
  [
    "Tıklayın, sürükleyin veya Ctrl+V ile yapıştırın",
    "Click, drag or paste with Ctrl+V",
  ],
  ["Kaldır", "Remove"],
  ["Yükle", "Upload"],
  ["Kaydet", "Save"],
  ["Vazgeç", "Cancel"],
  ["Yeni iş kaydı", "New work item"],
  ["Tür", "Type"],
  ["Görev", "Task"],
  ["Başlık", "Title"],
  ["Ekip", "Team"],
  ["Öncelik", "Priority"],
  ["Takvim tarihi", "Calendar date"],
  ["Planlanan saat", "Scheduled time"],
  ["Planlanan tarih", "Scheduled date"],
  ["Planlanan zaman", "Scheduled date and time"],
  ["Güncelle", "Update"],
  ["Detay", "Details"],
  ["Kaydı oluştur", "Create item"],
  ["Durum", "Status"],
  ["Tarih", "Date"],
  ["Saat", "Time"],
  ["Proje adı", "Project name"],
  ["Açıklama", "Description"],
  ["Kısa kod", "Short code"],
  ["Aktif", "Active"],
  ["Arşivlendi", "Archived"],
  ["Projeyi oluştur", "Create project"],
  ["Projeyi güncelle", "Update project"],
  ["Sprint adı", "Sprint name"],
  ["Başlangıç", "Start"],
  ["Bitiş", "End"],
  ["Planlandı", "Planned"],
  ["Tamamlandı", "Done"],
  ["Açık", "Open"],
  ["Beklemede", "Waiting"],
  ["Genel Bakış", "Overview"],
  ["Dokümanlar", "Documents"],
  ["Proje dokümanları", "Project documents"],
  ["Dosya yükle", "Upload file"],
  ["Çalışma alanındaki dosyayı bağla", "Link a workspace file"],
  ["Bağla", "Link"],
  ["Önizle", "Preview"],
  ["Yeni sekmede aç", "Open in new tab"],
  ["İçindekiler", "Contents"],
  ["Doküman hazırlanıyor…", "Preparing document…"],
  ["Henüz doküman eklenmedi.", "No documents have been added yet."],
]);

export function locale() {
  return document.documentElement.lang === "en" ? "en" : "tr";
}

export function t(value) {
  return locale() === "en" ? english.get(value) || value : value;
}

export function translateDocument() {
  document.title = "Sprintmark";
  const walker = document.createTreeWalker(
    document.body,
    globalThis.NodeFilter.SHOW_TEXT,
  );
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const turkish = new Map([...english].map(([key, value]) => [value, key]));
  for (const node of nodes) {
    if (node.parentElement?.closest("script, style, .toastui-editor-contents"))
      continue;
    const trimmed = node.nodeValue.trim();
    if (!trimmed) continue;
    const translated =
      locale() === "en" ? english.get(trimmed) : turkish.get(trimmed);
    if (translated)
      node.nodeValue = node.nodeValue.replace(trimmed, translated);
  }
  const search = document.getElementById("search");
  if (search)
    search.placeholder =
      locale() === "en" ? "Search work items…" : "Görevlerde ara…";
}
