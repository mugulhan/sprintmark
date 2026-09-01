export function parseEffort(value) {
  const text = String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(",", ".");
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const match = text.match(
    /^(\d+(?:\.\d+)?)\s*(dk|dakika|min|m|sa|saat|h|g|gün|gun|d)$/i,
  );
  if (!match) return Number.NaN;
  const amount = Number(match[1]);
  const unit = match[2].toLocaleLowerCase("tr-TR");
  const multiplier = ["dk", "dakika", "min", "m"].includes(unit)
    ? 1
    : ["sa", "saat", "h"].includes(unit)
      ? 60
      : 480;
  return Math.round(amount * multiplier);
}

export function formatEffort(minutes, language = "tr") {
  if (!Number.isFinite(minutes)) return "—";
  if (minutes >= 480 && minutes % 480 === 0)
    return `${minutes / 480} ${language === "tr" ? "g" : "d"}`;
  if (minutes >= 60 && minutes % 60 === 0)
    return `${minutes / 60} ${language === "tr" ? "sa" : "h"}`;
  return `${minutes} ${language === "tr" ? "dk" : "min"}`;
}

export function formatElapsed(minutes, language = "tr") {
  if (!Number.isFinite(minutes)) return "—";
  if (minutes >= 1440) {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return hours
      ? `${days} ${language === "tr" ? "g" : "d"} ${hours} ${language === "tr" ? "sa" : "h"}`
      : `${days} ${language === "tr" ? "g" : "d"}`;
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder
      ? `${hours} ${language === "tr" ? "sa" : "h"} ${remainder} ${language === "tr" ? "dk" : "min"}`
      : `${hours} ${language === "tr" ? "sa" : "h"}`;
  }
  return `${minutes} ${language === "tr" ? "dk" : "min"}`;
}
