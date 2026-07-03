import { sb } from "../shared/supabase.js";
import { state } from "../shared/state.js";
import { getColor, initials, timeStr, escapeHtml } from "../shared/utils.js";
import { showToast } from "../shared/toast.js";
import {
  getUser,
  logout,
  getFriends,
  getPendingInvites,
  sendFriendRequest,
  respondToFriendRequest,
  searchProfiles,
  subscribeToFriendRequests,
  getMessages,
  sendMessage,
  sendImageMessage,
  uploadImage,
  uploadVoice,
  sendVoiceMessage,
  subscribeToConversation,
  unsubscribe,
  updateProfile,
  uploadAvatar,
  dismissOnboarding,
  getContactNames,
  setContactName,
  deleteContactName,
  createOnlineChannel,
  deleteMessage,
  subscribeToAllIncomingMessages,
} from "../shared/api.js";
import { createPicker } from "picmo";
import {
  requestNotificationPermission,
  showBrowserNotification,
  flashTitle,
  clearTitleFlash,
  playNotifySound,
  isTabActive,
} from "../shared/notifications.js";

// ── Мобилна височина на екрана (фикс за 100vh зад адресната лента) ──
function setAppHeight() {
  document.documentElement.style.setProperty(
    "--app-height",
    `${window.innerHeight}px`,
  );
}
setAppHeight();
window.addEventListener("resize", setAppHeight);
window.addEventListener("orientationchange", setAppHeight);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", setAppHeight);
}

window.toggleAttachMenu = function () {
  const menu = document.getElementById("attachMenu");
  if (!menu) return;
  const willOpen = !menu.classList.contains("open");
  closeAttachMenu();
  togglePicker(false);
  if (willOpen) menu.classList.add("open");
};

function closeAttachMenu() {
  document.getElementById("attachMenu")?.classList.remove("open");
}

window.attachImage = function () {
  closeAttachMenu();
  document.getElementById("imageInput").click();
};

window.attachVoice = function () {
  closeAttachMenu();
  window.startVoiceRecording();
};

document.addEventListener("click", (e) => {
  const menu = document.getElementById("attachMenu");
  const btn = document.getElementById("plusBtn");
  if (
    menu?.classList.contains("open") &&
    !menu.contains(e.target) &&
    e.target !== btn &&
    !btn?.contains(e.target)
  ) {
    closeAttachMenu();
  }
});

// ── Contact names cache ───────────────────────────────────────
let contactNames = {};

// ── Профили на приятели (за име/аватар в известията) ───────────
let friendProfiles = {};

// ── Непрочетени съобщения по контакт ────────────────────────────
let unreadByUser = {};

function getDisplayName(profile) {
  // Приоритет: локален псевдоним → display_name → email
  if (contactNames[profile.id]) return contactNames[profile.id];
  if (profile.display_name) return profile.display_name;
  return profile.email;
}

function renderAvatar(profile, size = 34) {
  const name = getDisplayName(profile);
  const color = getColor(profile.id);
  if (profile.avatar_url) {
    return `<img src="${profile.avatar_url}" 
      style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0" 
      onerror="this.style.display='none';this.nextSibling.style.display='flex'" />
      <div class="user-avatar" style="display:none;background:${color}22;color:${color};width:${size}px;height:${size}px;font-size:${size > 30 ? 13 : 11}px">${initials(name)}</div>`;
  }
  return `<div class="user-avatar" style="background:${color}22;color:${color};width:${size}px;height:${size}px;font-size:${size > 30 ? 13 : 11}px">${initials(name)}</div>`;
}

// ── Emoji picker ──────────────────────────────────────────────
let pickerVisible = false;

function initEmojiPicker() {
  const container = document.getElementById("picker-container");
  const trigger = document.getElementById("emoji-btn");
  const picker = createPicker({ rootElement: container });

  picker.addEventListener("emoji:select", (e) => {
    const input = document.getElementById("msgInput");
    input.value += e.emoji;
    if (window.innerWidth > 640) input.focus();
  });

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAttachMenu();
    togglePicker(!pickerVisible);
  });

  document.addEventListener("click", (e) => {
    if (
      pickerVisible &&
      !container.contains(e.target) &&
      e.target !== trigger
    ) {
      togglePicker(false);
    }
  });
}

function togglePicker(show) {
  pickerVisible = show;
  document.getElementById("picker-container").classList.toggle("open", show);
}

// ── Typing indicator ──────────────────────────────────────────
let typingChannel = null;
let typingTimeout = null;

function initTypingIndicator(me, other) {
  unsubscribe(typingChannel);
  const id = [me, other].sort().join("-");
  typingChannel = sb.channel(`typing:${id}`, {
    config: { broadcast: { self: false } },
  });

  typingChannel
    .on("broadcast", { event: "typing" }, (payload) => {
      if (payload.payload.userId !== other) return;
      const isTyping = payload.payload.typing === true;
      document.getElementById("typingIndicator").style.display = isTyping
        ? "flex"
        : "none";
      if (isTyping) scrollToBottom();
    })
    .subscribe();
}

function trackTyping(typing) {
  if (!typingChannel || !state.currentUser) return;
  typingChannel.send({
    type: "broadcast",
    event: "typing",
    payload: { userId: state.currentUser.id, typing },
  });
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const { data } = await getUser();
  if (!data.user) {
    window.location.href = "../auth/auth.html";
    return;
  }

  state.currentUser = data.user;

  // Зареди пълния профил
  const { data: profile } = await sb
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();
  state.currentProfile = profile || {
    id: data.user.id,
    email: data.user.email,
  };

  updateMeFooter();

  // Покажи модал при първо влизане (няма display_name и не е бил пропуснат преди)
  if (
    !state.currentProfile.onboarding_dismissed &&
    !state.currentProfile.display_name &&
    !state.currentProfile.avatar_url
  ) {
    setTimeout(() => openProfileSettings(true), 600);
  }

  // Зареди contact names
  const { data: cn } = await getContactNames(state.currentUser.id);
  if (cn)
    cn.forEach((c) => {
      contactNames[c.contact_id] = c.custom_name;
    });

  const msgInput = document.getElementById("msgInput");
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      window.sendMessage();
    }
  });
  msgInput.addEventListener("input", () => {
    trackTyping(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => trackTyping(false), 1500);
  });
  msgInput.addEventListener("focus", () => {
    // На мобилни клавиатурата бута layout-а — задръж последното съобщение видимо.
    setTimeout(() => scrollToBottomRobust(), 250);
    setTimeout(() => scrollToBottomRobust(), 500);
  });

  initMessagesScrollTracking();
  initEmojiPicker();
  loadFriends();
  loadPendingInvites();
  subscribeToFriendRequests(state.currentUser.id, onNewFriendRequest);

  createOnlineChannel(state.currentUser.id, (onlineIds) => {
    state.onlineUsers = onlineIds;
    updateOnlineStatus(onlineIds);
  });

  // ── Настройка за дълго натискане (мобилни) ────────────────
  setupLongPress();

  // ── Известия при друг таб / background ────────────────────
  requestNotificationPermission();

  subscribeToAllIncomingMessages(state.currentUser.id, (msg) => {
    handleIncomingMessage(msg);
  });

  // Изчисти мигащото заглавие, щом табът/прозорецът стане активен
  document.addEventListener("visibilitychange", () => {
    if (isTabActive()) onTabBecameActive();
  });
  window.addEventListener("focus", onTabBecameActive);
});

// ── Обработка на входящо съобщение (независимо от отворения чат) ──
function handleIncomingMessage(msg) {
  const isOpenConversation = state.selectedUser === msg.sender_id;
  const tabActive = isTabActive();

  // Ако разговорът е отворен И табът е активен, съобщението вече
  // се обработва от subscribeToConversation по-долу — нищо повече не пращаме.
  if (isOpenConversation && tabActive) return;

  const senderProfile = friendProfiles[msg.sender_id];
  const senderName = senderProfile
    ? getDisplayName(senderProfile)
    : "Ново съобщение";
  const preview = msg.image_url ? "📷 Снимка" : msg.content || "";

  if (!tabActive) {
    showBrowserNotification({
      title: senderName,
      body: preview,
      icon: senderProfile?.avatar_url,
      onClick: () => window.selectUser(msg.sender_id),
    });
    playNotifySound();
    flashTitle(senderName);
  } else {
    // Табът е активен, но разговорът с този човек не е отворен
    showToast("info", senderName, preview || "Ново съобщение");
  }

  if (!isOpenConversation) {
    markUnread(msg.sender_id);
  }
}

function onTabBecameActive() {
  clearTitleFlash();
  if (state.selectedUser) clearUnreadFor(state.selectedUser);
}

// ── Останалите функции (без промени) ──────────────────────────

function updateMeFooter() {
  const p = state.currentProfile;
  const name = p.display_name || p.email;
  document.getElementById("meEmail").textContent = name;

  const meAvatarEl = document.getElementById("meAvatar");
  if (p.avatar_url) {
    meAvatarEl.innerHTML = `<img src="${p.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />`;
  } else {
    meAvatarEl.textContent = initials(name);
  }
}

function updateOnlineStatus(onlineIds) {
  document.querySelectorAll(".user").forEach((el) => {
    const id = el.id.replace("user-", "");
    const hint = el.querySelector(".user-hint");
    if (hint) {
      hint.textContent = onlineIds.includes(id) ? "онлайн" : "офлайн";
      hint.className = onlineIds.includes(id)
        ? "user-hint online"
        : "user-hint";
    }
  });

  // Обнови header-а ако е отворен чат
  if (state.selectedUser) {
    const sub = document.getElementById("chatHeaderSub");
    if (sub)
      sub.textContent = onlineIds.includes(state.selectedUser)
        ? "онлайн"
        : "офлайн";
  }
}

// ── Profile settings modal ────────────────────────────────────
window.openProfileSettings = function (isFirstLogin = false) {
  state.isFirstLogin = isFirstLogin;
  document.getElementById("profileModal").style.display = "flex";
  document.getElementById("firstLoginBanner").style.display = isFirstLogin
    ? "block"
    : "none";
  document.getElementById("profileModalClose").style.display = isFirstLogin
    ? "none"
    : "flex";
  document.getElementById("profileCancelBtn").textContent = isFirstLogin
    ? "Пропусни"
    : "Откажи";

  const p = state.currentProfile;
  document.getElementById("profileDisplayName").value = p.display_name || "";

  const preview = document.getElementById("profileAvatarPreview");
  const placeholder = document.getElementById("avatarPlaceholder");
  if (p.avatar_url) {
    preview.src = p.avatar_url;
    preview.style.display = "block";
    placeholder.style.display = "none";
  } else {
    preview.style.display = "none";
    placeholder.style.display = "flex";
  }
};

window.closeProfileSettings = function () {
  if (state.isFirstLogin) {
    // Потребителят реши да пропусне — запази го, за да не изскача пак.
    state.currentProfile.onboarding_dismissed = true;
    dismissOnboarding(state.currentUser.id).catch((err) =>
      console.error("dismissOnboarding error:", err),
    );
  }
  state.isFirstLogin = false;
  document.getElementById("profileModal").style.display = "none";
};

window.handleAvatarChange = function (event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById("profileAvatarPreview");
    preview.src = e.target.result;
    preview.style.display = "block";
  };
  reader.readAsDataURL(file);
};

window.saveProfile = async function () {
  const displayName = document
    .getElementById("profileDisplayName")
    .value.trim();
  const avatarFile = document.getElementById("profileAvatarInput").files[0];
  const btn = document.getElementById("saveProfileBtn");

  btn.classList.add("loading");

  let avatarUrl = state.currentProfile.avatar_url;

  if (avatarFile) {
    if (avatarFile.size > 3 * 1024 * 1024) {
      showToast("error", "Файлът е твърде голям", "Максимум 3MB");
      btn.classList.remove("loading");
      return;
    }
    const { url, error: avatarError } = await uploadAvatar(
      state.currentUser.id,
      avatarFile,
    );
    if (avatarError) {
      console.error("Avatar upload error:", avatarError);
      showToast(
        "error",
        "Грешка при качване",
        avatarError.message || "Провери правата на bucket-а",
      );
      btn.classList.remove("loading");
      return;
    }
    avatarUrl = url;
  }

  const { data, error } = await updateProfile(state.currentUser.id, {
    displayName: displayName || null,
    avatarUrl,
    onboardingDismissed: state.isFirstLogin ? true : undefined,
  });

  btn.classList.remove("loading");

  if (error) {
    showToast("error", "Грешка", "Профилът не беше запазен");
    return;
  }

  state.currentProfile = {
    ...state.currentProfile,
    display_name: displayName || null,
    avatar_url: avatarUrl,
    onboarding_dismissed: state.isFirstLogin
      ? true
      : state.currentProfile.onboarding_dismissed,
  };
  updateMeFooter();
  showToast("success", "Профилът е запазен!", "");
  closeProfileSettings();
  loadFriends();
};

// ── Rename contact modal ──────────────────────────────────────
window.openRenameContact = function () {
  if (!state.selectedUser) return;
  document.getElementById("renameModal").style.display = "flex";
  const current = contactNames[state.selectedUser] || "";
  document.getElementById("renameInput").value = current;
  document.getElementById("renameInput").focus();
};

window.closeRenameContact = function () {
  document.getElementById("renameModal").style.display = "none";
};

window.saveContactName = async function () {
  const name = document.getElementById("renameInput").value.trim();

  if (!name) {
    // Изтрий псевдонима ако е празно
    await deleteContactName(state.currentUser.id, state.selectedUser);
    delete contactNames[state.selectedUser];
  } else {
    const { error } = await setContactName(
      state.currentUser.id,
      state.selectedUser,
      name,
    );
    if (error) {
      showToast("error", "Грешка", "Не можах да запазя името");
      return;
    }
    contactNames[state.selectedUser] = name;
  }

  // Обнови header-а
  const chatName =
    contactNames[state.selectedUser] ||
    state.currentFriendProfile?.display_name ||
    state.currentFriendProfile?.email ||
    "";
  document.getElementById("chatName").textContent = chatName;

  closeRenameContact();
  loadFriends();
  showToast("success", "Името е запазено!", "");
};

// ── Friends ───────────────────────────────────────────────────
async function loadFriends() {
  const { data, error } = await getFriends(state.currentUser.id);
  if (error) {
    showToast("error", "Грешка", "Не можах да заредя приятелите");
    return;
  }

  const container = document.getElementById("users");
  if (!data.length) {
    container.innerHTML = `<div class="no-friends">Нямаш приятели още.<br/>Добави някого с бутона +</div>`;
    return;
  }

  container.innerHTML = data
    .map((f) => {
      const friend =
        f.sender_id === state.currentUser.id ? f.receiver : f.sender;
      friendProfiles[friend.id] = friend;
      const name = getDisplayName(friend);
      const unread = unreadByUser[friend.id] || 0;
      const badge = unread
        ? `<span class="unread-badge">${unread > 9 ? "9+" : unread}</span>`
        : "";
      return `
      <div class="user" id="user-${friend.id}" onclick="selectUser('${friend.id}')">
        ${renderAvatar(friend, 34)}
        <div class="user-info">
          <div class="user-name">${escapeHtml(name)}</div>
          <div class="user-hint">Натисни за чат</div>
        </div>
        ${badge}
      </div>
    `;
    })
    .join("");
  if (state.onlineUsers) updateOnlineStatus(state.onlineUsers);
}

function setUnreadBadge(userId, count) {
  const el = document.querySelector(`#user-${userId} .unread-badge`);
  if (count <= 0) {
    if (el) el.remove();
    return;
  }
  const text = count > 9 ? "9+" : String(count);
  if (el) {
    el.textContent = text;
  } else {
    const userEl = document.getElementById(`user-${userId}`);
    if (userEl) {
      const span = document.createElement("span");
      span.className = "unread-badge";
      span.textContent = text;
      userEl.appendChild(span);
    }
  }
}

function markUnread(userId) {
  unreadByUser[userId] = (unreadByUser[userId] || 0) + 1;
  setUnreadBadge(userId, unreadByUser[userId]);
}

function clearUnreadFor(userId) {
  if (!unreadByUser[userId]) return;
  delete unreadByUser[userId];
  setUnreadBadge(userId, 0);
}

// ── Pending invites ───────────────────────────────────────────
async function loadPendingInvites() {
  const { data, error } = await getPendingInvites(state.currentUser.id);
  if (error) return;

  const badge = document.getElementById("inviteBadge");
  badge.style.display = data.length ? "flex" : "none";
  badge.textContent = data.length;

  const list = document.getElementById("inviteList");
  if (!data.length) {
    list.innerHTML = `<div class="no-invites">Няма чакащи покани</div>`;
    return;
  }

  list.innerHTML = data
    .map(
      (f) => `
    <div class="invite-item">
      ${renderAvatar(f.sender, 30)}
      <div class="invite-email">${escapeHtml(f.sender.display_name || f.sender.email)}</div>
      <div class="invite-actions">
        <button class="btn-accept" onclick="acceptInvite('${f.id}')">✓</button>
        <button class="btn-decline" onclick="declineInvite('${f.id}')">✕</button>
      </div>
    </div>
  `,
    )
    .join("");
}

function onNewFriendRequest() {
  showToast("info", "Нова покана!", "Получи покана за приятелство");
  loadPendingInvites();
}

window.acceptInvite = async function (id) {
  const { error } = await respondToFriendRequest(id, "accepted");
  if (error) {
    showToast("error", "Грешка", "Не можах да приема поканата");
    return;
  }
  showToast("success", "Приятел добавен!", "");
  loadPendingInvites();
  loadFriends();
};

window.declineInvite = async function (id) {
  const { error } = await respondToFriendRequest(id, "declined");
  if (error) {
    showToast("error", "Грешка", "Не можах да откажа поканата");
    return;
  }
  loadPendingInvites();
};

// ── Add friend ────────────────────────────────────────────────
let searchTimeout = null;

window.toggleAddFriend = function () {
  const panel = document.getElementById("addFriendPanel");
  const isOpen = panel.style.display !== "none";
  panel.style.display = isOpen ? "none" : "block";
  document.getElementById("invitePanel").style.display = "none";
  if (!isOpen) document.getElementById("friendSearch").focus();
};

window.toggleInvitePanel = function () {
  const panel = document.getElementById("invitePanel");
  const isOpen = panel.style.display !== "none";
  panel.style.display = isOpen ? "none" : "block";
  document.getElementById("addFriendPanel").style.display = "none";
};

window.searchFriends = function (value) {
  clearTimeout(searchTimeout);
  if (!value.trim()) {
    document.getElementById("searchResults").innerHTML = "";
    return;
  }
  searchTimeout = setTimeout(() => doSearch(value), 300);
};

async function doSearch(email) {
  const { data, error } = await searchProfiles(email, state.currentUser.id);
  const container = document.getElementById("searchResults");
  if (error || !data.length) {
    container.innerHTML = `<div class="no-results">Няма резултати</div>`;
    return;
  }

  container.innerHTML = data
    .map(
      (u) => `
    <div class="search-result">
      ${renderAvatar(u, 30)}
      <div class="search-result-email">${escapeHtml(u.display_name || u.email)}</div>
      <button class="btn-add-friend" onclick="addFriend('${u.id}')">+</button>
    </div>
  `,
    )
    .join("");
}

window.addFriend = async function (receiverId) {
  const { error } = await sendFriendRequest(state.currentUser.id, receiverId);
  if (error) {
    showToast("error", "Грешка", "Не можах да изпратя покана");
    return;
  }
  showToast("success", "Поканата е изпратена!", "");
  document.getElementById("addFriendPanel").style.display = "none";
  document.getElementById("friendSearch").value = "";
  document.getElementById("searchResults").innerHTML = "";
};

// ── Select user ───────────────────────────────────────────────
let activeChannel = null;

window.selectUser = async function (id) {
  if (mediaRecorder) window.cancelVoiceRecording();

  unsubscribe(activeChannel);
  activeChannel = null;

  state.selectedUser = id;
  closeSidebar();
  togglePicker(false);
  closeAttachMenu();
  clearUnreadFor(id);

  document
    .querySelectorAll(".user")
    .forEach((el) => el.classList.remove("active"));
  document.getElementById(`user-${id}`)?.classList.add("active");

  document.getElementById("emptyState").style.display = "none";
  document.getElementById("activeChat").style.display = "flex";
  document.getElementById("typingIndicator").style.display = "none";

  // Намери профила на приятеля
  const { data: friendData } = await getFriends(state.currentUser.id);
  const friendship = friendData?.find(
    (f) => f.sender_id === id || f.receiver_id === id,
  );
  const friendProfile = friendship
    ? friendship.sender_id === state.currentUser.id
      ? friendship.receiver
      : friendship.sender
    : { id, email: "" };

  state.currentFriendProfile = friendProfile;
  friendProfiles[friendProfile.id] = friendProfile;

  const displayName = getDisplayName(friendProfile);
  document.getElementById("chatName").textContent = displayName;

  // Header avatar
  const headerAvatarEl = document.getElementById("chatHeaderAvatar");
  headerAvatarEl.innerHTML = renderAvatar(friendProfile, 34);

  const { data, error } = await getMessages(state.currentUser.id, id);
  if (error) {
    showToast("error", "Грешка", "Не можах да заредя съобщенията");
    return;
  }

  state.messages = data || [];
  stickToBottom = true; // всеки отворен разговор започва от последното съобщение
  renderMessages();
  scrollToBottomRobust();

  activeChannel = subscribeToConversation(state.currentUser.id, id, (msg) => {
    if (state.messages.some((m) => m.id === msg.id)) return;
    state.messages.push(msg);
    renderMessages();
    scrollToBottomRobust();
  });

  initTypingIndicator(state.currentUser.id, id);
};

// ── Send message ──────────────────────────────────────────────
window.sendMessage = async function () {
  const input = document.getElementById("msgInput");
  const content = input.value.trim();
  if (!content || !state.selectedUser) return;

  input.value = "";
  trackTyping(false);
  clearTimeout(typingTimeout);

  const { data, error } = await sendMessage(
    state.currentUser.id,
    state.selectedUser,
    content,
  );
  if (error) {
    showToast("error", "Грешка", "Съобщението не беше изпратено");
    input.value = content;
    return;
  }

  state.messages.push(data);
  renderMessages();
  stickToBottom = true;
  scrollToBottomRobust();
};

// ── Image upload ──────────────────────────────────────────────
window.handleImageUpload = async function (event) {
  const file = event.target.files[0];
  if (!file || !state.selectedUser) return;
  event.target.value = "";

  if (file.size > 5 * 1024 * 1024) {
    showToast("error", "Файлът е твърде голям", "Максимум 5MB");
    return;
  }

  const imgBtn = document.querySelector(".img-btn");
  imgBtn.classList.add("loading");

  const { url, error: uploadError } = await uploadImage(
    state.currentUser.id,
    file,
  );
  if (uploadError) {
    showToast("error", "Грешка при качване", "Снимката не беше качена");
    imgBtn.classList.remove("loading");
    return;
  }

  const { data, error } = await sendImageMessage(
    state.currentUser.id,
    state.selectedUser,
    url,
  );
  imgBtn.classList.remove("loading");
  if (error) {
    showToast("error", "Грешка", "Съобщението не беше записано");
    return;
  }

  state.messages.push(data);
  renderMessages();
  stickToBottom = true;
  scrollToBottomRobust();
};

// ── Гласови съобщения: запис ────────────────────────────────────
let mediaRecorder = null;
let recordedChunks = [];
let recordingStream = null;
let recordingStartTime = null;
let recordingTimerInterval = null;

const MAX_RECORDING_SECONDS = 180; // 3 мин таван, за да не се качват огромни файлове

function pickSupportedAudioMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const type of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(type)) return type;
  }
  return null;
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

window.startVoiceRecording = async function () {
  if (!state.selectedUser) return;
  if (mediaRecorder && mediaRecorder.state === "recording") return;

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast("error", "Не се поддържа", "Браузърът не поддържа запис на глас");
    return;
  }

  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
  } catch (err) {
    showToast(
      "error",
      "Няма достъп до микрофона",
      "Разреши достъп в настройките на браузъра",
    );
    return;
  }

  recordedChunks = [];
  const mimeType = pickSupportedAudioMimeType();
  mediaRecorder = new MediaRecorder(
    recordingStream,
    mimeType ? { mimeType } : undefined,
  );

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.start();
  recordingStartTime = Date.now();
  document.getElementById("inputBar").classList.add("recording");
  updateRecordingTime();
  recordingTimerInterval = setInterval(updateRecordingTime, 250);
};

function updateRecordingTime() {
  const el = document.getElementById("recordingTime");
  if (!el || !recordingStartTime) return;
  const elapsed = (Date.now() - recordingStartTime) / 1000;
  el.textContent = formatDuration(elapsed);
  if (elapsed >= MAX_RECORDING_SECONDS) window.stopAndSendVoiceRecording();
}

function stopRecordingInternal() {
  clearInterval(recordingTimerInterval);
  recordingTimerInterval = null;
  document.getElementById("inputBar")?.classList.remove("recording");
  if (recordingStream) {
    recordingStream.getTracks().forEach((t) => t.stop());
    recordingStream = null;
  }
}

window.cancelVoiceRecording = function () {
  if (!mediaRecorder) return;
  mediaRecorder.onstop = null;
  if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
  mediaRecorder = null;
  recordedChunks = [];
  stopRecordingInternal();
};

window.stopAndSendVoiceRecording = function () {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;

  const durationSeconds = Math.round((Date.now() - recordingStartTime) / 1000);
  const recorder = mediaRecorder;
  mediaRecorder = null;

  recorder.onstop = async () => {
    stopRecordingInternal();

    if (!recordedChunks.length || durationSeconds < 1) {
      recordedChunks = [];
      showToast("info", "Записът е твърде кратък", "");
      return;
    }

    const blob = new Blob(recordedChunks, {
      type: recorder.mimeType || "audio/webm",
    });
    recordedChunks = [];
    await sendVoiceBlob(blob, durationSeconds);
  };

  recorder.stop();
};

async function sendVoiceBlob(blob, durationSeconds) {
  if (!state.selectedUser) return;

  const micBtn = document.getElementById("micBtn");
  micBtn?.classList.add("loading");

  const { url, error: uploadError } = await uploadVoice(
    state.currentUser.id,
    blob,
  );
  if (uploadError) {
    showToast(
      "error",
      "Грешка при качване",
      "Гласовото съобщение не беше качено",
    );
    micBtn?.classList.remove("loading");
    return;
  }

  const { data, error } = await sendVoiceMessage(
    state.currentUser.id,
    state.selectedUser,
    url,
    durationSeconds,
  );
  micBtn?.classList.remove("loading");
  if (error) {
    showToast("error", "Грешка", "Съобщението не беше записано");
    return;
  }

  state.messages.push(data);
  renderMessages();
  stickToBottom = true;
  scrollToBottomRobust();
}

// ── Гласови съобщения: възпроизвеждане ──────────────────────────
let activeVoiceAudio = null;
let activeVoiceUrl = null;

function resetVoiceButton(btn) {
  if (!btn) return;
  const playIcon = btn.querySelector(".icon-play");
  const pauseIcon = btn.querySelector(".icon-pause");
  if (playIcon) playIcon.style.display = "block";
  if (pauseIcon) pauseIcon.style.display = "none";
}

// След всеки renderMessages() DOM-ът се пресъздава — ако в момента
// нещо се възпроизвежда, синхронизирай иконата/прогреса с новия DOM.
function syncVoicePlaybackUI() {
  if (!activeVoiceAudio || activeVoiceAudio.paused) return;
  const btn = document.querySelector(
    `.voice-play-btn[data-audio-url="${activeVoiceUrl}"]`,
  );
  if (!btn) return;
  btn.querySelector(".icon-play").style.display = "none";
  btn.querySelector(".icon-pause").style.display = "block";
}

window.toggleVoicePlayback = function (btn, url) {
  const playIcon = btn.querySelector(".icon-play");
  const pauseIcon = btn.querySelector(".icon-pause");
  const progressFill = btn
    .closest(".voice-msg")
    .querySelector(".voice-progress-fill");

  if (activeVoiceAudio && activeVoiceUrl === url) {
    if (activeVoiceAudio.paused) {
      activeVoiceAudio.play();
    } else {
      activeVoiceAudio.pause();
    }
    return;
  }

  if (activeVoiceAudio) {
    activeVoiceAudio.pause();
    resetVoiceButton(
      document.querySelector(
        `.voice-play-btn[data-audio-url="${activeVoiceUrl}"]`,
      ),
    );
  }

  const audio = new Audio(url);
  activeVoiceAudio = audio;
  activeVoiceUrl = url;

  audio.addEventListener("play", () => {
    playIcon.style.display = "none";
    pauseIcon.style.display = "block";
  });
  audio.addEventListener("pause", () => {
    playIcon.style.display = "block";
    pauseIcon.style.display = "none";
  });
  audio.addEventListener("timeupdate", () => {
    if (audio.duration) {
      progressFill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
    }
  });
  audio.addEventListener("ended", () => {
    resetVoiceButton(btn);
    progressFill.style.width = "0%";
    activeVoiceAudio = null;
    activeVoiceUrl = null;
  });

  audio.play();
};

function renderVoiceBubble(m) {
  const duration = m.audio_duration ? formatDuration(m.audio_duration) : "";
  return `
    <div class="voice-msg">
      <button class="voice-play-btn" data-audio-url="${m.audio_url}" onclick="toggleVoicePlayback(this, '${m.audio_url}')">
        <svg class="icon-play" viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><polygon points="6 4 20 12 6 20 6 4"/></svg>
        <svg class="icon-pause" viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style="display:none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
      </button>
      <div class="voice-progress"><div class="voice-progress-fill"></div></div>
      <div class="voice-duration">${duration}</div>
    </div>
  `;
}

// ── Render messages ───────────────────────────────────────────
function renderMessages() {
  const container = document.getElementById("messages");
  const me = state.currentProfile;
  const friend = state.currentFriendProfile;

  container.innerHTML = state.messages
    .map((m) => {
      const isMine = m.sender_id === state.currentUser.id;
      const profile = isMine ? me : friend;
      const color = isMine ? "var(--accent)" : getColor(m.sender_id);
      const name = isMine
        ? me.display_name || me.email
        : getDisplayName(friend || { id: m.sender_id, email: "" });

      const avatarHtml = profile?.avatar_url
        ? `<img src="${profile.avatar_url}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;flex-shrink:0;opacity:0.8;align-self:flex-end" />`
        : `<div class="msg-avatar" style="background:${color}22;color:${color}">${initials(name)}</div>`;

      const bubbleContent = m.image_url
        ? `<img src="${m.image_url}" class="msg-image" onclick="openImage('${m.image_url}')" />`
        : m.audio_url
          ? renderVoiceBubble(m)
          : escapeHtml(m.content || "");

      // ⬇️ Бутон с 3 точки (само за моите съобщения)
      const menuButton = isMine
        ? `<button class="msg-menu-btn" data-msg-id="${m.id}" onclick="event.stopPropagation(); toggleMessageMenu(event, '${m.id}')">⋮</button>`
        : "";

      return `
      <div class="msg-row ${isMine ? "mine" : ""}" data-msg-id="${m.id}">
        ${avatarHtml}
        <div class="msg-content-wrapper">
          <div class="msg-bubble ${m.image_url ? "image-bubble" : ""} ${m.audio_url ? "voice-bubble" : ""}">
            ${bubbleContent}
          </div>
          <div class="msg-time">${timeStr(m.created_at)}</div>
        </div>
        ${menuButton}
      </div>
    `;
    })
    .join("");

  syncVoicePlaybackUI();
}

window.openImage = (url) => window.open(url, "_blank");

// ── Скрол до последното съобщение (устойчив на снимки/шрифтове/клавиатура) ──
let stickToBottom = true;

function scrollToBottom() {
  const c = document.getElementById("messages");
  if (c) c.scrollTop = c.scrollHeight;
}

// Извиква се при: отваряне на разговор, изпращане/получаване на съобщение.
// Скролва веднага, после пак — след като аватарите/снимките се заредят
// и след кратки паузи, за да хване по-бавни reflow-и (шрифтове, клавиатура,
// адресна лента на мобилен браузър и т.н.).
function scrollToBottomRobust() {
  if (!stickToBottom) return;
  scrollToBottom();
  requestAnimationFrame(scrollToBottom);
  waitForImagesThenScroll();
  setTimeout(() => stickToBottom && scrollToBottom(), 60);
  setTimeout(() => stickToBottom && scrollToBottom(), 300);
}

function waitForImagesThenScroll() {
  const container = document.getElementById("messages");
  if (!container) return;
  container.querySelectorAll("img").forEach((img) => {
    if (img.complete) return;
    const onDone = () => {
      if (stickToBottom) scrollToBottom();
    };
    img.addEventListener("load", onDone, { once: true });
    img.addEventListener("error", onDone, { once: true });
  });
}

// Проследява дали потребителят е ръчно скролнал нагоре, за да не го
// "дърпаме" насила обратно надолу, докато чете стари съобщения.
function initMessagesScrollTracking() {
  const c = document.getElementById("messages");
  if (!c || c.dataset.scrollBound) return;
  c.dataset.scrollBound = "1";
  c.addEventListener("scroll", () => {
    const distanceFromBottom = c.scrollHeight - c.scrollTop - c.clientHeight;
    stickToBottom = distanceFromBottom < 120;
  });
}

// Мобилна клавиатура / промяна на viewport-а — задръж дъното, ако сме там.
window.addEventListener("resize", () => scrollToBottomRobust());
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () =>
    scrollToBottomRobust(),
  );
}

// ── Auth ──────────────────────────────────────────────────────
window.handleLogout = async function () {
  if (mediaRecorder) window.cancelVoiceRecording();
  const { error } = await logout();
  if (error) {
    showToast("error", "Грешка", "Не можах да те изпиша");
    return;
  }
  window.location.href = "../auth/auth.html";
};

// ── Mobile sidebar ────────────────────────────────────────────
window.openSidebar = function () {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebarOverlay").classList.add("visible");
};
window.closeSidebar = function () {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarOverlay").classList.remove("visible");
};

// ═══════════════════════════════════════════════════════════
// ── НОВИ ФУНКЦИИ ЗА МЕНЮ И ИЗТРИВАНЕ ──────────────────────
// ═══════════════════════════════════════════════════════════

let activeDropdown = null;

window.toggleMessageMenu = function (event, messageId) {
  event.stopPropagation();

  if (activeDropdown) {
    activeDropdown.classList.remove("open");
    activeDropdown.remove();
    activeDropdown = null;
  }

  const row = event.target.closest(".msg-row");
  if (!row) return;

  const dropdown = document.createElement("div");
  dropdown.className = "msg-dropdown open";
  dropdown.innerHTML = `
    <button class="msg-dropdown-item danger" onclick="confirmDeleteMessage('${messageId}')">
      🗑️ Изтрий
    </button>
  `;

  const btn = event.target;
  const rect = btn.getBoundingClientRect();
  dropdown.style.left = `${rect.left - 100}px`;
  dropdown.style.top = `${rect.bottom + 6}px`;
  document.body.appendChild(dropdown);
  activeDropdown = dropdown;

  setTimeout(() => {
    document.addEventListener("click", closeDropdown, { once: true });
  }, 10);
};

function closeDropdown() {
  if (activeDropdown) {
    activeDropdown.classList.remove("open");
    setTimeout(() => {
      if (activeDropdown) {
        activeDropdown.remove();
        activeDropdown = null;
      }
    }, 150);
  }
}

window.confirmDeleteMessage = async function (messageId) {
  closeDropdown();

  const confirmed = confirm(
    "Сигурен ли си, че искаш да изтриеш това съобщение?",
  );
  if (!confirmed) return;

  try {
    const { data, error } = await deleteMessage(
      messageId,
      state.currentUser.id,
    );
    if (error) {
      showToast("error", "Грешка", "Не можах да изтрия съобщението");
      return;
    }

    state.messages = state.messages.filter((m) => m.id !== messageId);
    renderMessages();
    showToast("success", "Изтрито", "Съобщението беше изтрито");
  } catch (err) {
    console.error("Delete error:", err);
    showToast("error", "Грешка", "Възникна проблем при изтриването");
  }
};

// ── Long press за мобилни ─────────────────────────────────────
let longPressTimer = null;
let longPressTriggered = false;

function setupLongPress() {
  const container = document.getElementById("messages");
  if (!container) return;

  container.addEventListener("touchstart", (e) => {
    const row = e.target.closest(".msg-row");
    if (!row) return;
    const msgId = row.dataset.msgId;
    if (!msgId) return;

    const msg = state.messages.find((m) => m.id === msgId);
    if (!msg || msg.sender_id !== state.currentUser.id) return;

    longPressTriggered = false;
    longPressTimer = setTimeout(() => {
      longPressTriggered = true;
      const btn = row.querySelector(".msg-menu-btn");
      if (btn) {
        btn.click();
      } else {
        confirmDeleteMessage(msgId);
      }
    }, 600);
  });

  container.addEventListener("touchend", () => {
    clearTimeout(longPressTimer);
  });
  container.addEventListener("touchmove", () => {
    clearTimeout(longPressTimer);
  });
}
