const COLORS = [
  "#7b61ff",
  "#f97316",
  "#06b6d4",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#6366f1",
];

export function getColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function initials(email) {
  return email ? email.substring(0, 2).toUpperCase() : "??";
}

export function timeStr(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
