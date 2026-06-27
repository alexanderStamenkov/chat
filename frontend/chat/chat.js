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
  subscribeToConversation,
  unsubscribe,
  updateProfile,
  uploadAvatar,
  getContactNames,
  setContactName,
  deleteContactName,
  createOnlineChannel,
} from "../shared/api.js";
import { createPicker } from "picmo";

// ── Contact names cache ───────────────────────────────────────
let contactNames = {}; // { contactId: customName }

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

  // Покажи модал при първо влизане (няма display_name)
  if (!state.currentProfile.display_name && !state.currentProfile.avatar_url) {
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

  initEmojiPicker();
  loadFriends();
  loadPendingInvites();
  subscribeToFriendRequests(state.currentUser.id, onNewFriendRequest);

  createOnlineChannel(state.currentUser.id, (onlineIds) => {
    state.onlineUsers = onlineIds;
    updateOnlineStatus(onlineIds);
  });
});

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
      const name = getDisplayName(friend);
      return `
      <div class="user" id="user-${friend.id}" onclick="selectUser('${friend.id}')">
        ${renderAvatar(friend, 34)}
        <div class="user-info">
          <div class="user-name">${escapeHtml(name)}</div>
          <div class="user-hint">Натисни за чат</div>
        </div>
      </div>
    `;
    })
    .join("");
  if (state.onlineUsers) updateOnlineStatus(state.onlineUsers);
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
  unsubscribe(activeChannel);
  activeChannel = null;

  state.selectedUser = id;
  closeSidebar();
  togglePicker(false);

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
  renderMessages();
  requestAnimationFrame(() => scrollToBottom());

  activeChannel = subscribeToConversation(state.currentUser.id, id, (msg) => {
    if (state.messages.some((m) => m.id === msg.id)) return;
    state.messages.push(msg);
    renderMessages();
    requestAnimationFrame(() => scrollToBottom());
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
  scrollToBottom();
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
  scrollToBottom();
};

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
        : escapeHtml(m.content || "");

      return `
      <div class="msg-row ${isMine ? "mine" : ""}">
        ${avatarHtml}
        <div>
          <div class="msg-bubble ${m.image_url ? "image-bubble" : ""}">${bubbleContent}</div>
          <div class="msg-time">${timeStr(m.created_at)}</div>
        </div>
      </div>
    `;
    })
    .join("");
}

window.openImage = (url) => window.open(url, "_blank");

function scrollToBottom() {
  const c = document.getElementById("messages");
  if (c) c.scrollTop = c.scrollHeight;
}

// ── Auth ──────────────────────────────────────────────────────
window.handleLogout = async function () {
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
