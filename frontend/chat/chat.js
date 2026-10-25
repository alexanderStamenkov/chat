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
  unsubscribe,
  updateProfile,
  uploadAvatar,
  dismissOnboarding,
  getContactNames,
  setContactName,
  deleteContactName,
  createOnlineChannel,
  deleteMessage,
  editMessage,
  markMessagesDelivered,
  setReaction,
  removeReaction,
  getReactionsForMessages,
  subscribeToReactions,
  subscribeToAllIncomingMessages,
  createGroup,
  addGroupMember,
  getMyGroups,
  getGroupMembers,
  leaveGroup,
  removeGroupMember,
  renameGroup,
  getGroupMessages,
  sendGroupMessage,
  sendGroupImageMessage,
  sendGroupVoiceMessage,
  subscribeToAllIncomingGroupMessages,
  deleteGroup,
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

// ── Мобилна височина на екрана ────────────────────────────────
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

// ── Прикачени файлове ─────────────────────────────────────────
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

// ── Съобщения за грешки ───────────────────────────────────────
function friendlyError(error, fallbackTitle, fallbackMsg) {
  if (error?.message && /лимит|Твърде/i.test(error.message)) {
    return {
      title: "Твърде бързо",
      msg: error.message,
    };
  }

  return {
    title: fallbackTitle,
    msg: fallbackMsg,
  };
}

// ── Кешове ───────────────────────────────────────────────────
let contactNames = {};
let friendProfiles = {};
let unreadByUser = {};
let reactionsByMessage = {};

let myGroups = {};
let groupMemberProfiles = {};
let unreadByGroup = {};
let incomingGroupChannel = null;

function getDisplayName(profile) {
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

// ── Жизнен цикъл на отворения разговор ─────────────────────────
let activeConversation = null;
let activeChannel = null;
let conversationSequence = 0;

const conversationDrafts = new Map();
const conversationDeletions = new Map();

function conversationKey(target) {
  return `${target.senderId}:${target.groupId ? "group" : "direct"}:${target.groupId || target.receiverId}`;
}

function getConversationDeletions(target) {
  const key = conversationKey(target);

  if (!conversationDeletions.has(key)) {
    conversationDeletions.set(key, new Set());
  }

  return conversationDeletions.get(key);
}

function isCurrentConversation(view) {
  return (
    !!view && activeConversation === view && isMediaTargetActive(view.target)
  );
}

function messageBelongsToConversation(message, target) {
  if (!message?.id) return false;

  if (target.groupId) {
    return message.group_id === target.groupId;
  }

  return (
    !message.group_id &&
    ((message.sender_id === target.senderId &&
      message.receiver_id === target.receiverId) ||
      (message.sender_id === target.receiverId &&
        message.receiver_id === target.senderId))
  );
}

function getConversationDraft(target) {
  return (
    conversationDrafts.get(conversationKey(target)) || {
      value: "",
      revision: 0,
    }
  );
}

function setConversationDraft(target, value) {
  const previous = getConversationDraft(target);

  if (previous.value === value) return previous;

  const draft = {
    value,
    revision: previous.revision + 1,
  };

  conversationDrafts.set(conversationKey(target), draft);

  return draft;
}

function rememberCurrentDraft() {
  const target = captureMediaTarget();
  const input = document.getElementById("msgInput");

  if (target && input) {
    setConversationDraft(target, input.value);
  }
}

function disposeConversation() {
  // Обезсилваме чакащите callbacks преди останалото почистване.
  activeConversation = null;

  window.cancelVoiceRecording();

  trackTyping(false);
  clearTimeout(typingTimeout);
  typingTimeout = null;

  unsubscribe(activeChannel);
  activeChannel = null;

  unsubscribe(typingChannel);
  typingChannel = null;
}

function beginConversation(target) {
  rememberCurrentDraft();
  disposeConversation();

  const view = {
    target,
    sequence: ++conversationSequence,
    syncing: false,
    syncAgain: false,
    changes: new Map(),
    reactionChanges: new Map(),
    deletedIds: getConversationDeletions(target),
    readPending: false,
  };

  activeConversation = view;

  state.selectedUser = target.receiverId;
  state.selectedGroup = target.groupId;
  state.currentFriendProfile = null;
  state.messages = [];

  reactionsByMessage = {};
  stickToBottom = true;

  document.getElementById("msgInput").value =
    getConversationDraft(target).value;

  document.getElementById("messages").innerHTML =
    '<div class="no-friends">Зареждане на разговора…</div>';

  document.getElementById("messages").setAttribute("aria-busy", "true");
  document.getElementById("emptyState").style.display = "none";
  document.getElementById("activeChat").style.display = "flex";
  document.getElementById("typingIndicator").style.display = "none";
  document.getElementById("chatHeaderSub").textContent = "";

  closeSidebar();
  togglePicker(false);
  closeAttachMenu();
  closeDropdown();
  closeGroupInfo();
  closeRenameContact();
  closeCreateGroupModal();

  document.querySelectorAll(".user").forEach((el) => {
    el.classList.remove("active");
  });

  const elementId = target.groupId
    ? `group-${target.groupId}`
    : `user-${target.receiverId}`;

  document.getElementById(elementId)?.classList.add("active");

  return view;
}

function mergeMessageRows(previous, next) {
  if (!previous) return next;

  const merged = {
    ...previous,
    ...next,
  };

  // Късен INSERT/SELECT не връща назад вече получена редакция.
  if (
    previous.edited_at &&
    (!next.edited_at || previous.edited_at > next.edited_at)
  ) {
    merged.content = previous.content;
    merged.edited_at = previous.edited_at;
  }

  merged.delivered_at = next.delivered_at || previous.delivered_at || null;

  merged.read_at = next.read_at || previous.read_at || null;

  merged.deleted_at = next.deleted_at || previous.deleted_at || null;

  return merged;
}

function sortConversationMessages(messages) {
  return messages.sort((a, b) => {
    return (
      String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
      String(a.id).localeCompare(String(b.id))
    );
  });
}

function acceptConversationMessage(view, row, kind = "insert", render = true) {
  if (
    !isCurrentConversation(view) ||
    !messageBelongsToConversation(row, view.target)
  ) {
    return false;
  }

  const index = state.messages.findIndex((m) => m.id === row.id);
  const previous = index === -1 ? null : state.messages[index];

  if (view.deletedIds.has(row.id) && !row.deleted_at) {
    return false;
  }

  if (kind === "insert" && previous) {
    return false;
  }

  const message = mergeMessageRows(previous, row);

  if (view.syncing) {
    view.changes.set(message.id, message);
  }

  if (message.deleted_at) {
    view.deletedIds.add(message.id);

    if (index !== -1) {
      state.messages.splice(index, 1);
    }

    delete reactionsByMessage[message.id];
  } else if (index === -1) {
    state.messages.push(message);
    sortConversationMessages(state.messages);
  } else {
    state.messages[index] = message;
  }

  if (render) {
    renderMessages();
  }

  return true;
}

async function syncConversationMessages(view) {
  if (!isCurrentConversation(view)) return;

  if (view.syncing) {
    view.syncAgain = true;
    return;
  }

  view.syncing = true;
  view.changes = new Map();
  view.reactionChanges = new Map();

  const previouslyVisibleIds = state.messages.map((m) => m.id);

  try {
    const target = view.target;

    const { data, error } = target.groupId
      ? await getGroupMessages(target.groupId)
      : await getMessages(target.senderId, target.receiverId);

    if (!isCurrentConversation(view)) return;
    if (error) throw error;

    const messages = new Map();

    for (const row of data || []) {
      if (messageBelongsToConversation(row, target)) {
        messages.set(row.id, row);
      }
    }

    // Ограничен SELECT не означава, че липсващите видими редове
    // са изтрити. Проверяваме известните ID отделно.
    const missingIds = previouslyVisibleIds.filter((id) => {
      return !messages.has(id) && !view.deletedIds.has(id);
    });

    for (let offset = 0; offset < missingIds.length; offset += 100) {
      let query = sb
        .from("messages")
        .select("*")
        .in("id", missingIds.slice(offset, offset + 100));

      query = target.groupId
        ? query.eq("group_id", target.groupId)
        : query
            .is("group_id", null)
            .or(
              `and(sender_id.eq.${target.senderId},receiver_id.eq.${target.receiverId}),and(sender_id.eq.${target.receiverId},receiver_id.eq.${target.senderId})`,
            );

      const { data: retained, error: retainedError } = await query;

      if (!isCurrentConversation(view)) return;
      if (retainedError) throw retainedError;

      for (const row of retained || []) {
        if (messageBelongsToConversation(row, target)) {
          messages.set(row.id, row);

          if (row.deleted_at) {
            view.deletedIds.add(row.id);
          }
        }
      }
    }

    // Промените, получени докато SELECT е чакал, имат приоритет.
    for (const [id, row] of view.changes) {
      messages.set(id, mergeMessageRows(messages.get(id), row));
    }

    state.messages = sortConversationMessages(
      [...messages.values()].filter((m) => {
        return !m.deleted_at && !view.deletedIds.has(m.id);
      }),
    );

    renderMessages();
    scrollToBottomRobust();

    if (!target.groupId) {
      markOpenConversationRead();
    }

    const { data: reactions, error: reactionError } =
      await getReactionsForMessages(state.messages.map((m) => m.id));

    if (!isCurrentConversation(view)) return;

    if (!reactionError) {
      const visibleIds = new Set(state.messages.map((m) => m.id));

      const rows = new Map(
        (reactions || []).map((r) => [`${r.message_id}:${r.user_id}`, r]),
      );

      for (const [key, row] of view.reactionChanges) {
        if (row) {
          rows.set(key, row);
        } else {
          rows.delete(key);
        }
      }

      reactionsByMessage = {};

      for (const row of rows.values()) {
        if (visibleIds.has(row.message_id)) {
          (reactionsByMessage[row.message_id] ||= []).push(row);
        }
      }

      renderMessages();
    }
  } catch (error) {
    if (isCurrentConversation(view)) {
      if (!state.messages.length) {
        document.getElementById("messages").innerHTML =
          '<div class="no-friends">Разговорът не се зареди. Избери го отново, за да опиташ пак.</div>';
      }

      showToast(
        "error",
        "Грешка",
        "Не можах да заредя разговора. Отвори го отново.",
      );
    }
  } finally {
    view.syncing = false;

    if (isCurrentConversation(view)) {
      document.getElementById("messages").setAttribute("aria-busy", "false");

      if (view.syncAgain) {
        view.syncAgain = false;
        void syncConversationMessages(view);
      }
    }
  }
}

function subscribeToCurrentConversation(view) {
  const target = view.target;

  const channel = sb.channel(
    `chat:${conversationKey(target)}:${view.sequence}`,
  );

  const filters = target.groupId
    ? [`group_id=eq.${target.groupId}`]
    : [`sender_id=eq.${target.senderId}`, `sender_id=eq.${target.receiverId}`];

  for (const filter of filters) {
    for (const event of ["INSERT", "UPDATE"]) {
      channel.on(
        "postgres_changes",
        {
          event,
          schema: "public",
          table: "messages",
          filter,
        },
        (payload) => {
          const accepted = acceptConversationMessage(
            view,
            payload.new,
            event === "INSERT" ? "insert" : "update",
          );

          if (!accepted) return;

          scrollToBottomRobust();

          if (!target.groupId) {
            markOpenConversationRead();
          }
        },
      );
    }
  }

  // Сверяване след потвърдено свързване и при reconnect.
  channel.on("system", "*", (payload) => {
    if (
      payload.extension === "postgres_changes" &&
      payload.status === "ok" &&
      isCurrentConversation(view)
    ) {
      void syncConversationMessages(view);
    }
  });

  activeChannel = channel;

  channel.subscribe((status, error) => {
    if (!isCurrentConversation(view)) return;

    if (status === "SUBSCRIBED") {
      void syncConversationMessages(view);
    }

    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.warn("Conversation realtime:", status, error);
    }
  });
}

// ── Emoji picker ──────────────────────────────────────────────
let pickerVisible = false;

function initEmojiPicker() {
  const container = document.getElementById("picker-container");
  const trigger = document.getElementById("emoji-btn");

  const picker = createPicker({
    rootElement: container,
  });

  picker.addEventListener("emoji:select", (e) => {
    const input = document.getElementById("msgInput");

    input.value += e.emoji;
    rememberCurrentDraft();

    if (window.innerWidth > 640) {
      input.focus();
    }
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

function initTypingIndicator(me, other, view = activeConversation) {
  unsubscribe(typingChannel);

  const id = [me, other].sort().join("-");

  typingChannel = sb.channel(`typing:${id}`, {
    config: {
      broadcast: {
        self: false,
      },
    },
  });

  typingChannel
    .on("broadcast", { event: "typing" }, (payload) => {
      if (!isCurrentConversation(view)) return;
      if (payload.payload.userId !== other) return;

      const isTyping = payload.payload.typing === true;

      document.getElementById("typingIndicator").style.display = isTyping
        ? "flex"
        : "none";

      if (isTyping) {
        scrollToBottom();
      }
    })
    .subscribe();
}

function trackTyping(typing) {
  if (!typingChannel || !state.currentUser) return;

  typingChannel.send({
    type: "broadcast",
    event: "typing",
    payload: {
      userId: state.currentUser.id,
      typing,
    },
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

  if (
    !state.currentProfile.onboarding_dismissed &&
    !state.currentProfile.display_name &&
    !state.currentProfile.avatar_url
  ) {
    setTimeout(() => openProfileSettings(true), 600);
  }

  const { data: cn } = await getContactNames(state.currentUser.id);

  if (cn) {
    cn.forEach((c) => {
      contactNames[c.contact_id] = c.custom_name;
    });
  }

  const msgInput = document.getElementById("msgInput");

  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      window.sendMessage();
    }
  });

  msgInput.addEventListener("input", () => {
    rememberCurrentDraft();

    const view = activeConversation;

    trackTyping(true);
    clearTimeout(typingTimeout);

    typingTimeout = setTimeout(() => {
      if (isCurrentConversation(view)) {
        trackTyping(false);
      }
    }, 1500);
  });

  msgInput.addEventListener("focus", () => {
    const view = activeConversation;

    setTimeout(() => scrollToBottomRobust(view), 250);
    setTimeout(() => scrollToBottomRobust(view), 500);
  });

  initMessagesScrollTracking();
  initEmojiPicker();

  loadFriends();
  loadPendingInvites();

  subscribeToFriendRequests(state.currentUser.id, onNewFriendRequest);

  loadGroups();

  createOnlineChannel(state.currentUser.id, (onlineIds) => {
    state.onlineUsers = onlineIds;
    updateOnlineStatus(onlineIds);
  });

  setupLongPress();
  requestNotificationPermission();

  subscribeToAllIncomingMessages(state.currentUser.id, (msg) => {
    handleIncomingMessage(msg);
  });

  subscribeToReactions(handleReactionChange);

  document.addEventListener("visibilitychange", () => {
    if (isTabActive()) {
      onTabBecameActive();
    }
  });

  window.addEventListener("focus", onTabBecameActive);
});

// ── Входящи лични съобщения и известия ─────────────────────────
function handleIncomingMessage(msg) {
  if (!state.currentUser) return;

  const isOpenConversation = state.selectedUser === msg.sender_id;

  const tabActive = isTabActive();

  markMessagesDelivered(state.currentUser.id, [msg.id]);

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
    showToast("info", senderName, preview || "Ново съобщение");
  }

  if (!isOpenConversation) {
    markUnread(msg.sender_id);
  }
}

// ── Реакции: realtime синхронизация ────────────────────────────
function handleReactionChange(payload) {
  const row = payload.new?.id ? payload.new : payload.old;

  if (!row) return;

  const messageId = row.message_id;
  const view = activeConversation;

  if (!isCurrentConversation(view)) return;

  if (view.syncing) {
    view.reactionChanges.set(
      `${messageId}:${row.user_id}`,
      payload.eventType === "DELETE" ? null : row,
    );
  }

  if (!state.messages.some((m) => m.id === messageId)) {
    return;
  }

  const list = (reactionsByMessage[messageId] || []).filter(
    (r) => r.user_id !== row.user_id,
  );

  if (payload.eventType !== "DELETE") {
    list.push({
      message_id: messageId,
      user_id: row.user_id,
      emoji: row.emoji,
    });
  }

  reactionsByMessage[messageId] = list;
  renderMessages();
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

window.toggleReactionPicker = function (event, messageId) {
  event.stopPropagation();
  closeDropdown();

  const picker = document.createElement("div");
  picker.className = "reaction-picker open";

  picker.innerHTML = QUICK_REACTIONS.map(
    (e) =>
      `<button onclick="toggleReaction('${messageId}', '${e}')">${e}</button>`,
  ).join("");

  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();

  picker.style.left = `${Math.max(8, rect.left - 90)}px`;
  picker.style.top = `${rect.bottom + 6}px`;

  document.body.appendChild(picker);
  activeDropdown = picker;

  setTimeout(() => {
    document.addEventListener("click", closeDropdown, { once: true });
  }, 10);
};

window.toggleReaction = async function (messageId, emoji) {
  closeDropdown();

  const view = activeConversation;

  if (
    !isCurrentConversation(view) ||
    !state.messages.some((m) => m.id === messageId)
  ) {
    return;
  }

  const userId = view.target.senderId;

  const previousList = [...(reactionsByMessage[messageId] || [])];
  const mine = previousList.find((r) => r.user_id === userId);

  // Пази и старото pending състояние, ако в момента върви sync.
  const reactionKey = `${messageId}:${userId}`;
  const hadPendingChange = view.reactionChanges.has(reactionKey);
  const previousPendingChange = hadPendingChange
    ? view.reactionChanges.get(reactionKey)
    : undefined;

  try {
    // Ако цъкнем същата реакция -> махаме я.
    if (mine && mine.emoji === emoji) {
      reactionsByMessage[messageId] = previousList.filter(
        (r) => r.user_id !== userId,
      );

      if (view.syncing) {
        view.reactionChanges.set(reactionKey, null);
      }

      renderMessages();

      const { error } = await removeReaction(messageId, userId);

      if (error) {
        throw error;
      }

      return;
    }

    // Добавяне или смяна на реакция.
    const reaction = {
      message_id: messageId,
      user_id: userId,
      emoji,
    };

    reactionsByMessage[messageId] = [
      ...previousList.filter((r) => r.user_id !== userId),
      reaction,
    ];

    if (view.syncing) {
      view.reactionChanges.set(reactionKey, reaction);
    }

    renderMessages();

    const { error } = await setReaction(messageId, userId, emoji);

    if (error) {
      throw error;
    }
  } catch (error) {
    // Ако междувременно сме сменили разговора,
    // не пипаме UI на новия чат.
    if (!isCurrentConversation(view)) {
      return;
    }

    // Връщаме optimistic промяната назад.
    reactionsByMessage[messageId] = previousList;

    if (view.syncing) {
      if (hadPendingChange) {
        view.reactionChanges.set(reactionKey, previousPendingChange);
      } else {
        view.reactionChanges.delete(reactionKey);
      }
    }

    renderMessages();

    console.error("Reaction error:", error);

    showToast(
      "error",
      "Грешка",
      error?.message || "Не можах да запазя реакцията",
    );
  }
};

function renderReactionPills(messageId, reactions) {
  if (!reactions.length) return "";

  const counts = {};
  let myEmoji = null;

  reactions.forEach((r) => {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;

    if (r.user_id === state.currentUser.id) {
      myEmoji = r.emoji;
    }
  });

  return `
    <div class="msg-reactions">
      ${Object.entries(counts)
        .map(
          ([emoji, count]) => `
        <button class="reaction-pill ${emoji === myEmoji ? "mine" : ""}" onclick="toggleReaction('${messageId}', '${emoji}')">
          ${emoji}${count > 1 ? ` ${count}` : ""}
        </button>
      `,
        )
        .join("")}
    </div>
  `;
}

function onTabBecameActive() {
  clearTitleFlash();

  if (state.selectedUser) {
    clearUnreadFor(state.selectedUser);
    markOpenConversationRead();
  }

  if (state.selectedGroup) {
    clearGroupUnreadFor(state.selectedGroup);
  }
}

// ── Прочетени съобщения ───────────────────────────────────────
async function markOpenConversationRead() {
  const view = activeConversation;

  if (
    !isCurrentConversation(view) ||
    view.target.groupId ||
    !isTabActive() ||
    view.readPending
  ) {
    return;
  }

  const target = view.target;

  const ids = state.messages
    .filter((m) => {
      return (
        messageBelongsToConversation(m, target) &&
        m.receiver_id === target.senderId &&
        !m.read_at
      );
    })
    .map((m) => m.id);

  if (!ids.length) return;

  view.readPending = true;
  let succeeded = false;

  try {
    // Маркираме конкретните заредени ID.
    const { data, error } = await sb
      .from("messages")
      .update({
        read_at: new Date().toISOString(),
      })
      .in("id", ids)
      .eq("sender_id", target.receiverId)
      .eq("receiver_id", target.senderId)
      .is("group_id", null)
      .is("read_at", null)
      .select("id, read_at");

    if (error || !isCurrentConversation(view)) return;

    succeeded = true;
    let changed = false;

    for (const row of data || []) {
      const current = state.messages.find((m) => m.id === row.id);

      if (current && !current.read_at && row.read_at) {
        changed =
          acceptConversationMessage(
            view,
            {
              ...current,
              read_at: row.read_at,
            },
            "update",
            false,
          ) || changed;
      }
    }

    if (changed) {
      renderMessages();
    }
  } catch (error) {
    console.warn("Read receipt:", error);
  } finally {
    view.readPending = false;

    if (
      succeeded &&
      isCurrentConversation(view) &&
      isTabActive() &&
      state.messages.some((m) => {
        return (
          m.receiver_id === target.senderId && !m.read_at && !ids.includes(m.id)
        );
      })
    ) {
      void markOpenConversationRead();
    }
  }
}

// ── Профил и онлайн статус ────────────────────────────────────
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

  if (state.selectedUser) {
    const sub = document.getElementById("chatHeaderSub");

    if (sub) {
      sub.textContent = onlineIds.includes(state.selectedUser)
        ? "онлайн"
        : "офлайн";
    }
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

window.handleProfileOverlayClick = function (event) {
  const modal = document.getElementById("profileModal");

  if (event.target !== modal) return;

  if (!state.isFirstLogin) {
    window.closeProfileSettings();
  }
};

window.closeProfileSettings = function () {
  if (state.isFirstLogin) {
    state.currentProfile.onboarding_dismissed = true;

    dismissOnboarding(state.currentUser.id).catch((err) => {
      console.error("dismissOnboarding error:", err);
    });
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

// ── Преименуване на контакт ───────────────────────────────────
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
  const target = captureMediaTarget();
  const view = activeConversation;

  if (!target || target.groupId) return;

  const name = document.getElementById("renameInput").value.trim();

  try {
    const { error } = name
      ? await setContactName(target.senderId, target.receiverId, name)
      : await deleteContactName(target.senderId, target.receiverId);

    if (error) throw error;
    if (state.currentUser?.id !== target.senderId) return;

    if (name) {
      contactNames[target.receiverId] = name;
    } else {
      delete contactNames[target.receiverId];
    }

    if (isMediaTargetActive(target)) {
      document.getElementById("chatName").textContent =
        name ||
        state.currentFriendProfile?.display_name ||
        state.currentFriendProfile?.email ||
        "Разговор";

      renderMessages();
    }

    if (isCurrentConversation(view)) {
      closeRenameContact();
    }

    void loadFriends();

    showToast("success", "Името е запазено!", "");
  } catch (error) {
    if (state.currentUser?.id === target.senderId) {
      showToast("error", "Грешка", "Не можах да запазя името");
    }
  }
};

// ── Приятели ──────────────────────────────────────────────────
async function loadFriends() {
  const userId = state.currentUser?.id;
  if (!userId) return;

  const { data, error } = await getFriends(userId);

  if (state.currentUser?.id !== userId) return;

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

  if (state.onlineUsers) {
    updateOnlineStatus(state.onlineUsers);
  }
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

// ── Групи ────────────────────────────────────────────────────
async function loadGroups() {
  const userId = state.currentUser?.id;
  if (!userId) return;

  const { data, error } = await getMyGroups(userId);

  if (state.currentUser?.id !== userId) return;

  const container = document.getElementById("groupsList");

  if (error || !data) {
    container.innerHTML = `<div class="no-friends">Няма групи още</div>`;
    return;
  }

  myGroups = {};

  data.forEach((row) => {
    if (row.groups) {
      myGroups[row.groups.id] = {
        ...row.groups,
        role: row.role,
      };
    }
  });

  const groupList = Object.values(myGroups);

  if (!groupList.length) {
    container.innerHTML = `<div class="no-friends">Няма групи още.<br/>Направи една с бутона +</div>`;
  } else {
    container.innerHTML = groupList
      .map((g) => {
        const unread = unreadByGroup[g.id] || 0;

        const badge = unread
          ? `<span class="unread-badge">${unread > 9 ? "9+" : unread}</span>`
          : "";

        return `
        <div class="user" id="group-${g.id}" onclick="selectGroup('${g.id}')">
          <div class="group-avatar-icon">👥</div>
          <div class="user-info">
            <div class="user-name">${escapeHtml(g.name)}</div>
            <div class="user-hint">Групов чат</div>
          </div>
          ${badge}
        </div>
      `;
      })
      .join("");
  }

  if (incomingGroupChannel) {
    unsubscribe(incomingGroupChannel);
  }

  const groupIds = Object.keys(myGroups);

  incomingGroupChannel = subscribeToAllIncomingGroupMessages(
    groupIds,
    handleIncomingGroupMessage,
  );
}

function setGroupUnreadBadge(groupId, count) {
  const el = document.querySelector(`#group-${groupId} .unread-badge`);

  if (count <= 0) {
    if (el) el.remove();
    return;
  }

  const text = count > 9 ? "9+" : String(count);

  if (el) {
    el.textContent = text;
  } else {
    const groupEl = document.getElementById(`group-${groupId}`);

    if (groupEl) {
      const span = document.createElement("span");
      span.className = "unread-badge";
      span.textContent = text;
      groupEl.appendChild(span);
    }
  }
}

function markGroupUnread(groupId) {
  unreadByGroup[groupId] = (unreadByGroup[groupId] || 0) + 1;

  setGroupUnreadBadge(groupId, unreadByGroup[groupId]);
}

function clearGroupUnreadFor(groupId) {
  if (!unreadByGroup[groupId]) return;

  delete unreadByGroup[groupId];
  setGroupUnreadBadge(groupId, 0);
}

// ── Създаване на група ────────────────────────────────────────
let createGroupRequest = 0;

window.openCreateGroupModal = async function () {
  const userId = state.currentUser?.id;
  if (!userId) return;

  const request = ++createGroupRequest;

  document.getElementById("groupNameInput").value = "";
  document.getElementById("createGroupModal").style.display = "flex";

  const { data } = await getFriends(userId);

  if (state.currentUser?.id !== userId || request !== createGroupRequest) {
    return;
  }

  const checklist = document.getElementById("groupMemberChecklist");

  if (!data || !data.length) {
    checklist.innerHTML = `<div class="group-member-checklist-empty">Нямаш приятели за добавяне още</div>`;
    return;
  }

  checklist.innerHTML = data
    .map((f) => {
      const friend = f.sender_id === userId ? f.receiver : f.sender;

      const name = getDisplayName(friend);

      return `
      <label class="group-member-checklist-item">
        <input type="checkbox" value="${friend.id}" />
        ${renderAvatar(friend, 26)}
        <span class="group-member-checklist-name">${escapeHtml(name)}</span>
      </label>
    `;
    })
    .join("");
};

window.closeCreateGroupModal = function () {
  createGroupRequest++;
  document.getElementById("createGroupModal").style.display = "none";
};

window.submitCreateGroup = async function () {
  const userId = state.currentUser?.id;

  if (!userId) return;

  const name = document.getElementById("groupNameInput").value.trim();

  if (!name) {
    showToast("error", "Грешка", "Въведи име на групата");
    return;
  }

  const selectedIds = Array.from(
    document.querySelectorAll("#groupMemberChecklist input:checked"),
  ).map((el) => el.value);

  const btn = document.getElementById("createGroupBtn");

  // Предпазва от двойно натискане.
  if (btn.disabled) return;

  btn.disabled = true;
  btn.classList.add("loading");

  try {
    // Цялото създаване вече става в една DB транзакция:
    // group + creator admin + избрани members.
    const { data: group, error } = await createGroup(name, selectedIds);

    // Потребителят може да се е logout-нал,
    // докато заявката е чакала.
    if (state.currentUser?.id !== userId) {
      return;
    }

    if (error || !group) {
      throw error || new Error("Групата не беше създадена");
    }

    showToast("success", "Групата е създадена!", "");

    closeCreateGroupModal();

    await loadGroups();

    // Проверка отново след async операцията.
    if (state.currentUser?.id !== userId) {
      return;
    }

    window.selectGroup(group.id);
  } catch (error) {
    if (state.currentUser?.id !== userId) {
      return;
    }

    console.error("create_group_with_members error:", error);

    const message = error?.message || "Не можах да създам групата";

    showToast("error", "Грешка", message);
  } finally {
    btn.disabled = false;
    btn.classList.remove("loading");
  }
};

// ── Отваряне на групов чат ────────────────────────────────────
window.selectGroup = async function (groupId) {
  if (!groupId || !state.currentUser) return;

  const view = beginConversation({
    senderId: state.currentUser.id,
    groupId,
    receiverId: null,
  });

  clearGroupUnreadFor(groupId);

  const group = myGroups[groupId];

  document.getElementById("chatName").textContent = group?.name || "Група";

  document.getElementById("chatHeaderAvatar").innerHTML =
    '<div class="group-avatar-icon">👥</div>';

  groupMemberProfiles[groupId] ||= {};

  subscribeToCurrentConversation(view);

  const history = syncConversationMessages(view);

  try {
    const { data: members, error } = await getGroupMembers(groupId);

    if (!isCurrentConversation(view)) return;
    if (error) throw error;

    groupMemberProfiles[groupId] = {};

    for (const member of members || []) {
      if (member.profiles) {
        groupMemberProfiles[groupId][member.user_id] = member.profiles;
      }
    }

    document.getElementById("chatHeaderSub").textContent =
      `${members?.length || 0} членове`;

    if (state.messages.length) {
      renderMessages();
    }
  } catch (error) {
    if (isCurrentConversation(view)) {
      showToast("error", "Грешка", "Не можах да заредя участниците");
    }
  }

  await history;
};

// ── Входящи групови съобщения ─────────────────────────────────
function handleIncomingGroupMessage(msg) {
  if (!state.currentUser) return;

  const isOpenGroup = state.selectedGroup === msg.group_id;

  const tabActive = isTabActive();

  if (isOpenGroup && tabActive) return;
  if (msg.sender_id === state.currentUser.id) return;

  const group = myGroups[msg.group_id];
  const groupName = group?.name || "Групов чат";

  const senderProfile = groupMemberProfiles[msg.group_id]?.[msg.sender_id];

  const senderName = senderProfile ? getDisplayName(senderProfile) : "";

  const preview = msg.image_url
    ? "📷 Снимка"
    : msg.audio_url
      ? "🎙️ Гласово съобщение"
      : msg.content || "";

  const body = senderName ? `${senderName}: ${preview}` : preview;

  if (!tabActive) {
    showBrowserNotification({
      title: groupName,
      body,
      icon: group?.avatar_url,
      onClick: () => window.selectGroup(msg.group_id),
    });

    playNotifySound();
    flashTitle(groupName);
  } else {
    showToast("info", groupName, body || "Ново съобщение");
  }

  if (!isOpenGroup) {
    markGroupUnread(msg.group_id);
  }
}

// ── Информация и членове на група ─────────────────────────────
let groupInfoRequest = 0;

window.openGroupInfo = async function () {
  const view = activeConversation;

  if (!isCurrentConversation(view) || !view.target.groupId) {
    return;
  }

  const { groupId, senderId } = view.target;

  const request = ++groupInfoRequest;

  const stillOpen = () => {
    return isCurrentConversation(view) && request === groupInfoRequest;
  };

  const group = myGroups[groupId];

  document.getElementById("groupInfoName").textContent = group?.name || "Група";

  document.getElementById("groupRenameInput").value = group?.name || "";

  try {
    const { data: members, error } = await getGroupMembers(groupId);

    if (!stillOpen()) return;
    if (error) throw error;

    const myRole = members?.find((m) => m.user_id === senderId)?.role;

    const isAdmin = myRole === "admin";
    const isCreator = group?.created_by === senderId;

    const leaveBtn = document.getElementById("leaveGroupBtn");

    const deleteBtn = document.getElementById("deleteGroupBtn");

    if (leaveBtn) {
      leaveBtn.style.display = isCreator ? "none" : "inline-flex";
    }

    if (deleteBtn) {
      deleteBtn.style.display = isCreator ? "inline-flex" : "none";
    }

    document.getElementById("groupRenameField").style.display = isAdmin
      ? "flex"
      : "none";

    document.getElementById("groupAddFriendField").style.display = isAdmin
      ? "flex"
      : "none";

    const membersListEl = document.getElementById("groupMembersList");

    membersListEl.innerHTML = (members || [])
      .map((m) => {
        const profile = m.profiles || {
          id: m.user_id,
          email: "",
        };

        const name = getDisplayName(profile);

        const canRemove =
          isAdmin && m.user_id !== senderId && m.user_id !== group?.created_by;

        return `
          <div class="group-member-row">
            ${renderAvatar(profile, 28)}

            <div class="group-member-row-name">
              ${escapeHtml(name)}
            </div>

            <div class="group-member-role">
              ${
                m.user_id === group?.created_by
                  ? "създател"
                  : m.role === "admin"
                    ? "админ"
                    : ""
              }
            </div>

            ${
              canRemove
                ? `
                  <button
                    class="group-member-remove"
                    onclick="handleRemoveGroupMember('${groupId}', '${m.user_id}')"
                  >
                    ✕
                  </button>
                `
                : ""
            }
          </div>
        `;
      })
      .join("");

    if (isAdmin) {
      const memberIds = new Set((members || []).map((m) => m.user_id));

      const { data: friendsData, error: friendsError } =
        await getFriends(senderId);

      if (!stillOpen()) return;
      if (friendsError) throw friendsError;

      const addable = (friendsData || [])
        .map((f) => {
          return f.sender_id === senderId ? f.receiver : f.sender;
        })
        .filter((f) => !memberIds.has(f.id));

      const addChecklist = document.getElementById("groupAddFriendChecklist");

      if (!addable.length) {
        addChecklist.innerHTML = `
          <div class="group-member-checklist-empty">
            Всичките ти приятели вече са в групата
          </div>
        `;
      } else {
        addChecklist.innerHTML = addable
          .map(
            (f) => `
              <label class="group-member-checklist-item">
                <input
                  type="checkbox"
                  value="${f.id}"
                />

                ${renderAvatar(f, 26)}

                <span class="group-member-checklist-name">
                  ${escapeHtml(getDisplayName(f))}
                </span>
              </label>
            `,
          )
          .join("");
      }
    }

    document.getElementById("groupInfoModal").style.display = "flex";
  } catch (error) {
    if (stillOpen()) {
      console.error("openGroupInfo error:", error);

      showToast(
        "error",
        "Грешка",
        "Не можах да заредя информацията за групата",
      );
    }
  }
};

window.handleDeleteGroup = async function () {
  const target = captureMediaTarget();

  if (!target?.groupId) return;

  const group = myGroups[target.groupId];

  if (!group) return;

  if (group.created_by !== target.senderId) {
    showToast(
      "error",
      "Не е позволено",
      "Само създателят може да изтрие групата",
    );

    return;
  }

  const confirmed = confirm(
    `Сигурен ли си, че искаш да изтриеш групата "${group.name}"?\n\nВсички съобщения в нея ще бъдат изтрити окончателно.`,
  );

  if (!confirmed) return;

  const secondConfirmed = confirm(
    "Това действие не може да бъде отменено. Наистина ли да изтрия групата?",
  );

  if (!secondConfirmed) return;

  window.cancelVoiceRecording();

  const { error } = await deleteGroup(target.groupId);

  if (state.currentUser?.id !== target.senderId) {
    return;
  }

  if (error) {
    console.error("deleteGroup error:", error);

    showToast(
      "error",
      "Грешка",
      error?.message || "Не можах да изтрия групата",
    );

    return;
  }

  conversationDrafts.delete(conversationKey(target));

  if (isMediaTargetActive(target)) {
    closeGroupInfo();
    disposeConversation();

    state.selectedGroup = null;
    state.selectedUser = null;
    state.currentFriendProfile = null;
    state.messages = [];

    reactionsByMessage = {};

    document.getElementById("msgInput").value = "";

    document.getElementById("messages").innerHTML = "";

    document.getElementById("activeChat").style.display = "none";

    document.getElementById("emptyState").style.display = "flex";
  }

  delete myGroups[target.groupId];
  delete unreadByGroup[target.groupId];
  delete groupMemberProfiles[target.groupId];

  showToast("success", "Групата е изтрита", "");

  await loadGroups();
};

window.handleChatHeaderAction = function () {
  if (state.selectedGroup) {
    window.openGroupInfo();
    return;
  }

  if (state.selectedUser) {
    window.openRenameContact();
  }
};

window.closeGroupInfo = function () {
  groupInfoRequest++;

  document.getElementById("groupInfoModal").style.display = "none";
};

window.saveGroupInfo = async function () {
  const view = activeConversation;

  if (!isCurrentConversation(view) || !view.target.groupId) {
    return;
  }

  const { groupId, senderId } = view.target;

  const request = groupInfoRequest;

  const btn = document.getElementById("groupInfoSaveBtn");

  if (btn.disabled) return;

  const newName = document.getElementById("groupRenameInput").value.trim();

  const selectedIds = Array.from(
    document.querySelectorAll("#groupAddFriendChecklist input:checked"),
  ).map((el) => el.value);

  btn.disabled = true;
  btn.classList.add("loading");

  try {
    if (newName && newName !== myGroups[groupId]?.name) {
      const { error } = await renameGroup(groupId, newName);

      if (error) throw error;

      if (state.currentUser?.id !== senderId) {
        return;
      }

      if (myGroups[groupId]) {
        myGroups[groupId].name = newName;
      }

      if (isMediaTargetActive(view.target)) {
        document.getElementById("chatName").textContent = newName;
      }
    }

    let failedInvites = false;

    for (const friendId of selectedIds) {
      if (state.currentUser?.id !== senderId) {
        return;
      }

      const { error: memberError } = await addGroupMember(
        groupId,
        friendId,
        "member",
      );

      if (memberError) {
        failedInvites = true;

        console.error("addGroupMember error:", memberError);

        showToast(
          "error",
          "Част от поканите не минаха",
          memberError.message || "Провери конзолата за детайли",
        );
      }
    }

    if (state.currentUser?.id !== senderId) {
      return;
    }

    if (!failedInvites) {
      showToast("success", "Готово!", "Промените са запазени");
    }

    const shouldRefresh =
      isCurrentConversation(view) && request === groupInfoRequest;

    if (shouldRefresh) {
      closeGroupInfo();
    }

    const closedRequest = groupInfoRequest;

    await loadGroups();

    if (
      shouldRefresh &&
      isCurrentConversation(view) &&
      closedRequest === groupInfoRequest
    ) {
      void window.selectGroup(groupId);
    }
  } catch (error) {
    if (state.currentUser?.id === senderId) {
      console.error("saveGroupInfo error:", error);

      showToast("error", "Грешка", "Част от промените не бяха запазени");
    }
  } finally {
    btn.disabled = false;
    btn.classList.remove("loading");
  }
};

window.handleRemoveGroupMember = async function (groupId, userId) {
  const view = activeConversation;

  if (!isCurrentConversation(view) || view.target.groupId !== groupId) {
    return;
  }

  const group = myGroups[groupId];

  // Допълнителна frontend защита.
  // Истинската защита остава в DB trigger-а.
  if (userId === group?.created_by) {
    showToast(
      "error",
      "Не е позволено",
      "Създателят не може да бъде премахнат от групата",
    );

    return;
  }

  const request = groupInfoRequest;

  const confirmed = confirm("Сигурен ли си, че искаш да махнеш този човек?");

  if (!confirmed) return;

  const { error } = await removeGroupMember(groupId, userId);

  if (error) {
    console.error("removeGroupMember error:", error);

    showToast("error", "Грешка", error?.message || "Не можах да махна члена");

    return;
  }

  showToast("success", "Готово", "Членът беше премахнат");

  if (isCurrentConversation(view) && request === groupInfoRequest) {
    void openGroupInfo();
  }
};

window.handleLeaveGroup = async function () {
  const target = captureMediaTarget();

  if (!target?.groupId) return;

  const group = myGroups[target.groupId];

  // Frontend защита.
  // DB trigger-ът също блокира това.
  if (group?.created_by === target.senderId) {
    showToast(
      "error",
      "Не можеш да напуснеш",
      "Създателят на групата не може да напусне групата",
    );

    return;
  }

  const confirmed = confirm("Сигурен ли си, че искаш да напуснеш групата?");

  if (!confirmed) return;

  window.cancelVoiceRecording();

  const { error } = await leaveGroup(target.groupId, target.senderId);

  if (state.currentUser?.id !== target.senderId) {
    return;
  }

  if (error) {
    console.error("leaveGroup error:", error);

    showToast(
      "error",
      "Грешка",
      error?.message || "Не можах да напусна групата",
    );

    return;
  }

  conversationDrafts.delete(conversationKey(target));

  if (isMediaTargetActive(target)) {
    closeGroupInfo();
    disposeConversation();

    state.selectedGroup = null;
    state.selectedUser = null;
    state.currentFriendProfile = null;
    state.messages = [];

    reactionsByMessage = {};

    document.getElementById("msgInput").value = "";

    document.getElementById("messages").innerHTML = "";

    document.getElementById("activeChat").style.display = "none";

    document.getElementById("emptyState").style.display = "flex";
  }

  showToast("info", "Напусна групата", "");

  await loadGroups();
};

// ── Покани за приятелство ─────────────────────────────────────
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

// ── Добавяне на приятел ───────────────────────────────────────
let searchTimeout = null;

window.toggleAddFriend = function () {
  const panel = document.getElementById("addFriendPanel");
  const isOpen = panel.style.display !== "none";

  panel.style.display = isOpen ? "none" : "block";
  document.getElementById("invitePanel").style.display = "none";

  if (!isOpen) {
    document.getElementById("friendSearch").focus();
  }
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
    const t = friendlyError(error, "Грешка", "Не можах да изпратя покана");

    showToast("error", t.title, t.msg);
    return;
  }

  showToast("success", "Поканата е изпратена!", "");

  document.getElementById("addFriendPanel").style.display = "none";
  document.getElementById("friendSearch").value = "";
  document.getElementById("searchResults").innerHTML = "";
};

// ── Отваряне на личен разговор ────────────────────────────────
window.selectUser = async function (id) {
  if (!id || !state.currentUser) return;

  const view = beginConversation({
    senderId: state.currentUser.id,
    groupId: null,
    receiverId: id,
  });

  clearUnreadFor(id);

  const cached = friendProfiles[id] || {
    id,
    email: "",
  };

  state.currentFriendProfile = cached;

  document.getElementById("chatName").textContent =
    getDisplayName(cached) || "Зареждане…";

  document.getElementById("chatHeaderAvatar").innerHTML = renderAvatar(
    cached,
    34,
  );

  document.getElementById("chatHeaderSub").textContent =
    state.onlineUsers?.includes(id) ? "онлайн" : "офлайн";

  initTypingIndicator(view.target.senderId, id, view);

  subscribeToCurrentConversation(view);

  const history = syncConversationMessages(view);

  try {
    const { data: friends, error } = await getFriends(view.target.senderId);

    if (!isCurrentConversation(view)) return;
    if (error) throw error;

    const friendship = friends?.find((f) => {
      return f.sender_id === id || f.receiver_id === id;
    });

    const profile = friendship
      ? friendship.sender_id === view.target.senderId
        ? friendship.receiver
        : friendship.sender
      : cached;

    state.currentFriendProfile = profile;
    friendProfiles[id] = profile;

    document.getElementById("chatName").textContent =
      getDisplayName(profile) || "Разговор";

    document.getElementById("chatHeaderAvatar").innerHTML = renderAvatar(
      profile,
      34,
    );

    if (state.messages.length) {
      renderMessages();
    }
  } catch (error) {
    if (isCurrentConversation(view)) {
      showToast("error", "Грешка", "Не можах да заредя профила на събеседника");
    }
  }

  await history;
};

// ── Изпращане на текстово съобщение ───────────────────────────
window.sendMessage = async function () {
  const input = document.getElementById("msgInput");
  const originalText = input.value;
  const content = originalText.trim();
  const target = captureMediaTarget();

  if (!content || !target) return;

  rememberCurrentDraft();

  input.value = "";

  const clearedDraft = setConversationDraft(target, "");

  trackTyping(false);
  clearTimeout(typingTimeout);

  try {
    const { data, error } = target.groupId
      ? await sendGroupMessage(target.senderId, target.groupId, content)
      : await sendMessage(target.senderId, target.receiverId, content);

    if (error || !data) {
      throw error || new Error("Липсва записано съобщение");
    }

    appendMediaMessage(target, data);
  } catch (error) {
    if (state.currentUser?.id !== target.senderId) return;

    const currentDraft = getConversationDraft(target);

    // Възстановяваме само ако няма по-нова чернова.
    if (
      currentDraft.revision === clearedDraft.revision &&
      currentDraft.value === ""
    ) {
      if (!isMediaTargetActive(target) || input.value === "") {
        setConversationDraft(target, originalText);

        if (isMediaTargetActive(target)) {
          input.value = originalText;
        }
      }
    }

    const t = friendlyError(error, "Грешка", "Съобщението не беше изпратено");

    showToast("error", t.title, t.msg);
  }
};

// ── Фиксиран получател преди асинхронна работа ─────────────────
function captureMediaTarget() {
  const senderId = state.currentUser?.id;
  const groupId = state.selectedGroup || null;

  const receiverId = groupId ? null : state.selectedUser || null;

  if (!senderId || (!groupId && !receiverId)) {
    return null;
  }

  return {
    senderId,
    groupId,
    receiverId,
  };
}

function isMediaTargetActive(target) {
  if (!target || state.currentUser?.id !== target.senderId) {
    return false;
  }

  return target.groupId
    ? state.selectedGroup === target.groupId
    : !state.selectedGroup && state.selectedUser === target.receiverId;
}

function appendMediaMessage(target, message) {
  if (!message || !isMediaTargetActive(target)) {
    return;
  }

  if (!acceptConversationMessage(activeConversation, message)) {
    return;
  }

  stickToBottom = true;
  scrollToBottomRobust();
}

// ── Качване на снимка ─────────────────────────────────────────
window.handleImageUpload = async function (event) {
  const file = event.target.files[0];
  const target = captureMediaTarget();

  if (!file || !target) return;

  event.target.value = "";

  if (file.size > 5 * 1024 * 1024) {
    showToast("error", "Файлът е твърде голям", "Максимум 5MB");
    return;
  }

  const imgBtn = document.getElementById("cameraBtn");
  imgBtn?.classList.add("loading");

  try {
    const { url, error: uploadError } = await uploadImage(
      target.senderId,
      file,
    );

    if (uploadError || !url) {
      showToast("error", "Грешка при качване", "Снимката не беше качена");
      return;
    }

    if (state.currentUser?.id !== target.senderId) return;

    const { data, error } = target.groupId
      ? await sendGroupImageMessage(target.senderId, target.groupId, url)
      : await sendImageMessage(target.senderId, target.receiverId, url);

    if (error || !data) {
      const t = friendlyError(error, "Грешка", "Съобщението не беше записано");

      showToast("error", t.title, t.msg);
      return;
    }

    appendMediaMessage(target, data);
  } catch (error) {
    const t = friendlyError(error, "Грешка", "Снимката не беше изпратена");

    showToast("error", t.title, t.msg);
  } finally {
    imgBtn?.classList.remove("loading");
  }
};

// ── Гласови съобщения: запис ───────────────────────────────────
let activeRecording = null;
let pendingRecordingRequest = null;

const MAX_RECORDING_SECONDS = 180;

function pickSupportedAudioMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

  for (const type of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(type)) {
      return type;
    }
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
  const target = captureMediaTarget();

  if (!target || activeRecording || pendingRecordingRequest) {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast("error", "Не се поддържа", "Браузърът не поддържа запис на глас");
    return;
  }

  const request = {};
  pendingRecordingRequest = request;

  let stream;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
  } catch (err) {
    if (pendingRecordingRequest !== request) return;

    pendingRecordingRequest = null;

    showToast(
      "error",
      "Няма достъп до микрофона",
      "Разреши достъп в настройките на браузъра",
    );
    return;
  }

  // Разрешението може да пристигне след смяна на разговора.
  if (pendingRecordingRequest !== request || !isMediaTargetActive(target)) {
    stream.getTracks().forEach((track) => {
      track.stop();
    });

    if (pendingRecordingRequest === request) {
      pendingRecordingRequest = null;
    }

    return;
  }

  pendingRecordingRequest = null;

  const recording = {
    target,
    stream,
    chunks: [],
    recorder: null,
    startedAt: null,
    timer: null,
  };

  try {
    const mimeType = pickSupportedAudioMimeType();

    recording.recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );

    recording.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recording.chunks.push(e.data);
      }
    };

    recording.recorder.start();
  } catch (err) {
    stream.getTracks().forEach((track) => {
      track.stop();
    });

    showToast("error", "Грешка при запис", "Гласовият запис не беше стартиран");
    return;
  }

  recording.startedAt = Date.now();
  activeRecording = recording;

  document.getElementById("inputBar").classList.add("recording");

  updateRecordingTime();

  recording.timer = setInterval(updateRecordingTime, 250);
};

function updateRecordingTime() {
  const recording = activeRecording;
  const el = document.getElementById("recordingTime");

  if (!el || !recording) return;

  const elapsed = (Date.now() - recording.startedAt) / 1000;

  el.textContent = formatDuration(elapsed);

  if (elapsed >= MAX_RECORDING_SECONDS) {
    window.stopAndSendVoiceRecording();
  }
}

function stopRecordingInternal(recording) {
  clearInterval(recording.timer);
  recording.timer = null;

  recording.stream.getTracks().forEach((track) => {
    track.stop();
  });

  if (activeRecording === recording) {
    activeRecording = null;

    document.getElementById("inputBar")?.classList.remove("recording");
  }
}

window.cancelVoiceRecording = function () {
  pendingRecordingRequest = null;

  const recording = activeRecording;
  if (!recording) return;

  recording.recorder.onstop = null;
  recording.recorder.ondataavailable = null;

  if (recording.recorder.state !== "inactive") {
    recording.recorder.stop();
  }

  recording.chunks.length = 0;
  stopRecordingInternal(recording);
};

window.stopAndSendVoiceRecording = function () {
  const recording = activeRecording;

  if (!recording || recording.recorder.state === "inactive") {
    return;
  }

  const durationSeconds = Math.round((Date.now() - recording.startedAt) / 1000);

  const recorder = recording.recorder;

  recorder.onstop = async () => {
    if (!recording.chunks.length || durationSeconds < 1) {
      recording.chunks.length = 0;

      showToast("info", "Записът е твърде кратък", "");
      return;
    }

    const blob = new Blob(recording.chunks, {
      type: recorder.mimeType || "audio/webm",
    });

    recording.chunks.length = 0;

    await sendVoiceBlob(blob, durationSeconds, recording.target);
  };

  recorder.stop();

  // Старият onstop не управлява нов запис в друг разговор.
  stopRecordingInternal(recording);
};

async function sendVoiceBlob(blob, durationSeconds, target) {
  if (!target || state.currentUser?.id !== target.senderId) {
    return;
  }

  const micBtn = document.getElementById("micBtn");
  micBtn?.classList.add("loading");

  try {
    const { url, error: uploadError } = await uploadVoice(
      target.senderId,
      blob,
    );

    if (uploadError || !url) {
      showToast(
        "error",
        "Грешка при качване",
        "Гласовото съобщение не беше качено",
      );
      return;
    }

    if (state.currentUser?.id !== target.senderId) return;

    const { data, error } = target.groupId
      ? await sendGroupVoiceMessage(
          target.senderId,
          target.groupId,
          url,
          durationSeconds,
        )
      : await sendVoiceMessage(
          target.senderId,
          target.receiverId,
          url,
          durationSeconds,
        );

    if (error || !data) {
      const t = friendlyError(error, "Грешка", "Съобщението не беше записано");

      showToast("error", t.title, t.msg);
      return;
    }

    appendMediaMessage(target, data);
  } catch (error) {
    const t = friendlyError(
      error,
      "Грешка",
      "Гласовото съобщение не беше изпратено",
    );

    showToast("error", t.title, t.msg);
  } finally {
    micBtn?.classList.remove("loading");
  }
}

// ── Гласови съобщения: възпроизвеждане ─────────────────────────
let activeVoiceAudio = null;
let activeVoiceUrl = null;

function resetVoiceButton(btn) {
  if (!btn) return;

  const playIcon = btn.querySelector(".icon-play");
  const pauseIcon = btn.querySelector(".icon-pause");

  if (playIcon) playIcon.style.display = "block";
  if (pauseIcon) pauseIcon.style.display = "none";
}

function syncVoicePlaybackUI() {
  if (!activeVoiceAudio || activeVoiceAudio.paused) {
    return;
  }

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

// ── Изобразяване на съобщенията ───────────────────────────────
function renderMessages() {
  const container = document.getElementById("messages");
  const me = state.currentProfile;
  const friend = state.currentFriendProfile;
  const isGroupChat = !!state.selectedGroup;

  container.innerHTML = state.messages
    .map((m) => {
      const isMine = m.sender_id === state.currentUser.id;

      const groupSenderProfile = isGroupChat
        ? groupMemberProfiles[m.group_id]?.[m.sender_id]
        : null;

      const profile = isMine ? me : isGroupChat ? groupSenderProfile : friend;

      const color = isMine ? "var(--accent)" : getColor(m.sender_id);

      const name = isMine
        ? me.display_name || me.email
        : isGroupChat
          ? getDisplayName(
              groupSenderProfile || {
                id: m.sender_id,
                email: "",
              },
            )
          : getDisplayName(
              friend || {
                id: m.sender_id,
                email: "",
              },
            );

      const avatarHtml = profile?.avatar_url
        ? `<img src="${profile.avatar_url}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;flex-shrink:0;opacity:0.8;align-self:flex-end" />`
        : `<div class="msg-avatar" style="background:${color}22;color:${color}">${initials(name)}</div>`;

      const senderLabel =
        isGroupChat && !isMine
          ? `<div class="msg-sender-name" style="color:${color}">${escapeHtml(name)}</div>`
          : "";

      const bubbleContent = m.image_url
        ? `<img src="${m.image_url}" class="msg-image" onclick="openImage('${m.image_url}')" />`
        : m.audio_url
          ? renderVoiceBubble(m)
          : escapeHtml(m.content || "");

      const menuButton = isMine
        ? `<button class="msg-menu-btn" data-msg-id="${m.id}" onclick="event.stopPropagation(); toggleMessageMenu(event, '${m.id}')">⋮</button>`
        : "";

      const reactBtn = `<button class="msg-react-btn" data-msg-id="${m.id}" onclick="event.stopPropagation(); toggleReactionPicker(event, '${m.id}')">😊</button>`;

      const reactionsHtml = renderReactionPills(
        m.id,
        reactionsByMessage[m.id] || [],
      );

      const editedBadge = m.edited_at
        ? `<span class="msg-edited">· редактирано</span>`
        : "";

      const ticksHtml = isMine && !m.group_id ? renderStatusTicks(m) : "";

      return `
      <div class="msg-row ${isMine ? "mine" : ""}" data-msg-id="${m.id}">
        ${avatarHtml}
        <div class="msg-content-wrapper">
          ${senderLabel}
          <div class="msg-bubble ${m.image_url ? "image-bubble" : ""} ${m.audio_url ? "voice-bubble" : ""}">
            ${bubbleContent}
          </div>
          ${reactionsHtml}
          <div class="msg-time">
            ${timeStr(m.created_at)}
            ${editedBadge}
            ${ticksHtml}
          </div>
        </div>
        ${reactBtn}
        ${menuButton}
      </div>
    `;
    })
    .join("");

  syncVoicePlaybackUI();
}

function renderStatusTicks(m) {
  const status = m.read_at ? "read" : m.delivered_at ? "delivered" : "sent";

  return `
    <svg class="msg-ticks ${status}" viewBox="0 0 16 11" width="14" height="10" fill="none">
      <path class="tick tick1" d="M1 5.5L4.5 9L10 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      <path class="tick tick2" d="M6 5.5L9.5 9L15 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

window.openImage = (url) => window.open(url, "_blank");

// ── Скрол до последното съобщение ─────────────────────────────
let stickToBottom = true;

function scrollToBottom() {
  const c = document.getElementById("messages");

  if (c) {
    c.scrollTop = c.scrollHeight;
  }
}

function scrollToBottomRobust(view = activeConversation) {
  if (!isCurrentConversation(view) || !stickToBottom) {
    return;
  }

  const scrollCurrent = () => {
    if (isCurrentConversation(view) && stickToBottom) {
      scrollToBottom();
    }
  };

  scrollCurrent();
  requestAnimationFrame(scrollCurrent);
  waitForImagesThenScroll(view);

  setTimeout(scrollCurrent, 60);
  setTimeout(scrollCurrent, 300);
}

function waitForImagesThenScroll(view) {
  const container = document.getElementById("messages");
  if (!container) return;

  container.querySelectorAll("img").forEach((img) => {
    if (img.complete) return;

    const onDone = () => {
      if (isCurrentConversation(view) && stickToBottom) {
        scrollToBottom();
      }
    };

    img.addEventListener("load", onDone, { once: true });

    img.addEventListener("error", onDone, { once: true });
  });
}

function initMessagesScrollTracking() {
  const c = document.getElementById("messages");

  if (!c || c.dataset.scrollBound) return;

  c.dataset.scrollBound = "1";

  c.addEventListener("scroll", () => {
    const distanceFromBottom = c.scrollHeight - c.scrollTop - c.clientHeight;

    stickToBottom = distanceFromBottom < 120;
  });
}

window.addEventListener("resize", () => {
  scrollToBottomRobust();
});

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    scrollToBottomRobust();
  });
}

// ── Изход от акаунта ──────────────────────────────────────────
window.handleLogout = async function () {
  window.cancelVoiceRecording();

  const { error } = await logout();

  if (error) {
    showToast("error", "Грешка", "Не можах да те изпиша");
    return;
  }

  disposeConversation();

  closeGroupInfo();
  closeRenameContact();
  closeCreateGroupModal();

  state.currentUser = null;
  state.selectedUser = null;
  state.selectedGroup = null;
  state.currentFriendProfile = null;
  state.messages = [];

  reactionsByMessage = {};

  conversationDrafts.clear();
  conversationDeletions.clear();

  window.location.href = "../auth/auth.html";
};

// ── Мобилно странично меню ────────────────────────────────────
window.openSidebar = function () {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebarOverlay").classList.add("visible");
};

window.closeSidebar = function () {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarOverlay").classList.remove("visible");
};

// ── Меню на съобщение ─────────────────────────────────────────
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

  const msg = state.messages.find((m) => m.id === messageId);

  const canEdit = msg && !msg.image_url && !msg.audio_url;

  const dropdown = document.createElement("div");
  dropdown.className = "msg-dropdown open";

  dropdown.innerHTML = `
    ${
      canEdit
        ? `<button class="msg-dropdown-item" onclick="startEditMessage('${messageId}')">✏️ Редактирай</button>`
        : ""
    }
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
    const dropdown = activeDropdown;

    activeDropdown = null;
    dropdown.classList.remove("open");

    setTimeout(() => dropdown.remove(), 150);
  }
}

// ── Редакция на съобщение ─────────────────────────────────────
window.startEditMessage = function (messageId) {
  closeDropdown();

  const msg = state.messages.find((m) => m.id === messageId);

  if (!msg || msg.sender_id !== state.currentUser.id) {
    return;
  }

  if (msg.image_url || msg.audio_url) return;

  const newContent = prompt("Редактирай съобщението:", msg.content || "");

  if (newContent === null) return;

  const trimmed = newContent.trim();

  if (!trimmed || trimmed === msg.content) {
    return;
  }

  editMessageRequest(messageId, trimmed);
};

async function editMessageRequest(messageId, content) {
  const target = captureMediaTarget();
  if (!target) return;

  try {
    const { data, error } = await editMessage(
      messageId,
      target.senderId,
      content,
    );

    if (error || !data) {
      throw error || new Error("Липсва записано съобщение");
    }

    if (isMediaTargetActive(target)) {
      acceptConversationMessage(activeConversation, data, "update");
    }
  } catch (error) {
    if (state.currentUser?.id !== target.senderId) return;

    const t = friendlyError(
      error,
      "Грешка",
      "Не можах да редактирам съобщението",
    );

    showToast("error", t.title, t.msg);
  }
}

// ── Изтриване на съобщение ────────────────────────────────────
window.confirmDeleteMessage = async function (messageId) {
  closeDropdown();

  const target = captureMediaTarget();

  const message = state.messages.find((m) => m.id === messageId);

  if (!target || !message || message.sender_id !== target.senderId) {
    return;
  }

  const confirmed = confirm(
    "Сигурен ли си, че искаш да изтриеш това съобщение?",
  );

  if (!confirmed) return;

  try {
    const { data, error } = await deleteMessage(messageId, target.senderId);

    if (error) {
      showToast("error", "Грешка", "Не можах да изтрия съобщението");
      return;
    }

    if (state.currentUser?.id !== target.senderId) return;

    getConversationDeletions(target).add(messageId);

    if (isMediaTargetActive(target)) {
      acceptConversationMessage(
        activeConversation,
        data || {
          ...message,
          deleted_at: new Date().toISOString(),
        },
        "update",
      );
    }

    if (state.currentUser?.id !== target.senderId) return;

    showToast("success", "Изтрито", "Съобщението беше изтрито");
  } catch (err) {
    console.error("Delete error:", err);

    showToast("error", "Грешка", "Възникна проблем при изтриването");
  }
};

// ── Дълго натискане на мобилно устройство ──────────────────────
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

    if (!msg || msg.sender_id !== state.currentUser.id) {
      return;
    }

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
