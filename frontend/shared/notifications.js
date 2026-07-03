// ── Известия, когато табът е скрит / апа е в background ─────────
const ORIGINAL_TITLE = document.title;

let unreadTotal = 0;
let flashTimer = null;
let audioCtx = null;

/**
 * Табът се смята за "активен", само ако е видим И прозорецът е на фокус.
 * И двете могат да са различни (напр. табът е видим, но друг прозорец е активен).
 */
export function isTabActive() {
  return document.visibilityState === "visible" && document.hasFocus();
}

/**
 * Пита за разрешение за desktop известия (само веднъж, ако вече не е решено).
 */
export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "default") {
    try {
      return await Notification.requestPermission();
    } catch {
      return "denied";
    }
  }
  return Notification.permission;
}

/**
 * Показва native browser/OS известие (работи и когато табът е в background).
 */
export function showBrowserNotification({ title, body, icon, onClick }) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  try {
    const n = new Notification(title || "Ново съобщение", {
      body: body || "",
      icon: icon || "/favicon.ico",
      tag: "chatche-message", // групира ги, вместо да се трупат
      renotify: true,
    });
    n.onclick = () => {
      window.focus();
      if (onClick) onClick();
      n.close();
    };
  } catch (err) {
    console.warn("Notification error:", err);
  }
}

/**
 * Кара заглавието на таба да мига с "(N) Ново съобщение" докато табът
 * не стане активен отново.
 */
export function flashTitle(fromName) {
  unreadTotal++;
  clearInterval(flashTimer);

  const label =
    unreadTotal > 1
      ? `(${unreadTotal}) Нови съобщения`
      : `💬 ${fromName || "Ново съобщение"}`;

  let showFlash = true;
  document.title = label;
  flashTimer = setInterval(() => {
    showFlash = !showFlash;
    document.title = showFlash ? label : ORIGINAL_TITLE;
  }, 1200);
}

/**
 * Спира мигането и връща оригиналното заглавие. Извиква се,
 * когато табът/прозорецът стане активен отново.
 */
export function clearTitleFlash() {
  unreadTotal = 0;
  clearInterval(flashTimer);
  flashTimer = null;
  document.title = ORIGINAL_TITLE;
}

/**
 * Кратък "дзън" звук при ново съобщение, генериран с Web Audio —
 * не изисква аудио файл.
 */
export function playNotifySound() {
  try {
    audioCtx =
      audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g);
    g.connect(audioCtx.destination);
    o.type = "sine";
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.16, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.32);
    o.start();
    o.stop(audioCtx.currentTime + 0.32);
  } catch {
    // тихо игнорирай, ако Web Audio не е наличен/позволен
  }
}
