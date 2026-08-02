import { sb } from "./supabase.js";

// ── Profiles ──────────────────────────────────────────────────
export async function getProfiles() {
  return sb.from("profiles").select("*");
}

export async function upsertProfile(id, email) {
  return sb.from("profiles").upsert({ id, email }, { onConflict: "id" });
}

export async function updateProfile(
  userId,
  { displayName, avatarUrl, onboardingDismissed } = {},
) {
  const updates = {};
  if (displayName !== undefined) updates.display_name = displayName;
  if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;
  if (onboardingDismissed !== undefined)
    updates.onboarding_dismissed = onboardingDismissed;
  return sb.from("profiles").update(updates).eq("id", userId).select().single();
}

// Извиква се, когато потребителят натисне "Пропусни"/Х на модала при
// първо влизане — за да не му изскача повече от този акаунт.
export async function dismissOnboarding(userId) {
  return sb
    .from("profiles")
    .update({ onboarding_dismissed: true })
    .eq("id", userId)
    .select()
    .single();
}

export async function uploadAvatar(userId, file) {
  const ext = file.name.split(".").pop();
  const path = `${userId}/avatar.${ext}`;

  // Изтрий стария аватар ако съществува
  await sb.storage.from("avatars").remove([path]);

  const { error } = await sb.storage
    .from("avatars")
    .upload(path, file, { contentType: file.type, upsert: true });

  if (error) return { url: null, error };

  const { data } = sb.storage.from("avatars").getPublicUrl(path);
  // Добави cache-bust за да не се показва стария аватар
  return { url: `${data.publicUrl}?t=${Date.now()}`, error: null };
}

// ── Contact names ─────────────────────────────────────────────
export async function getContactNames(ownerId) {
  return sb.from("contact_names").select("*").eq("owner_id", ownerId);
}

export async function setContactName(ownerId, contactId, customName) {
  return sb
    .from("contact_names")
    .upsert(
      { owner_id: ownerId, contact_id: contactId, custom_name: customName },
      { onConflict: "owner_id,contact_id" },
    )
    .select()
    .single();
}

export async function deleteContactName(ownerId, contactId) {
  return sb
    .from("contact_names")
    .delete()
    .eq("owner_id", ownerId)
    .eq("contact_id", contactId);
}

// ── Messages ──────────────────────────────────────────────────
export async function getMessages(me, other) {
  return sb
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${me},receiver_id.eq.${other}),and(sender_id.eq.${other},receiver_id.eq.${me})`,
    )
    .is("deleted_at", null)
    .order("created_at");
}

export async function sendMessage(senderId, receiverId, content) {
  return sb
    .from("messages")
    .insert({ sender_id: senderId, receiver_id: receiverId, content })
    .select()
    .single();
}

export async function sendImageMessage(senderId, receiverId, imageUrl) {
  return sb
    .from("messages")
    .insert({
      sender_id: senderId,
      receiver_id: receiverId,
      content: null,
      image_url: imageUrl,
    })
    .select()
    .single();
}

// ── Гласови съобщения ────────────────────────────────────────
export async function uploadVoice(userId, blob) {
  const ext = (blob.type || "").includes("mp4") ? "m4a" : "webm";
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error } = await sb.storage
    .from("voice-messages")
    .upload(path, blob, { contentType: blob.type || "audio/webm" });

  if (error) return { url: null, error };

  const { data } = sb.storage.from("voice-messages").getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

export async function sendVoiceMessage(
  senderId,
  receiverId,
  audioUrl,
  durationSeconds,
) {
  return sb
    .from("messages")
    .insert({
      sender_id: senderId,
      receiver_id: receiverId,
      content: null,
      audio_url: audioUrl,
      audio_duration: durationSeconds,
    })
    .select()
    .single();
}

// ── Delete message (меко изтриване) ───────────────────────────
export async function deleteMessage(messageId, userId) {
  return sb
    .from("messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("sender_id", userId) // само авторът
    .select()
    .single();
}

// ── Редакция на съобщение ────────────────────────────────────
export async function editMessage(messageId, userId, newContent) {
  return sb
    .from("messages")
    .update({ content: newContent, edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("sender_id", userId)
    .select()
    .single();
}

// ── "Доставено" / "Прочетено" ────────────────────────────────
export async function markMessagesDelivered(userId, messageIds) {
  if (!messageIds?.length) return { data: null, error: null };
  return sb
    .from("messages")
    .update({ delivered_at: new Date().toISOString() })
    .in("id", messageIds)
    .eq("receiver_id", userId)
    .is("delivered_at", null);
}

export async function markConversationRead(userId, otherUserId) {
  return sb
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("receiver_id", userId)
    .eq("sender_id", otherUserId)
    .is("read_at", null);
}

// ── Реакции с емоджита ────────────────────────────────────────
export async function setReaction(messageId, userId, emoji) {
  return sb
    .from("message_reactions")
    .upsert(
      { message_id: messageId, user_id: userId, emoji },
      { onConflict: "message_id,user_id" },
    )
    .select()
    .single();
}

export async function removeReaction(messageId, userId) {
  return sb
    .from("message_reactions")
    .delete()
    .eq("message_id", messageId)
    .eq("user_id", userId);
}

export async function getReactionsForMessages(messageIds) {
  if (!messageIds?.length) return { data: [], error: null };
  return sb.from("message_reactions").select("*").in("message_id", messageIds);
}

export function subscribeToReactions(onChange) {
  return sb
    .channel("message-reactions")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "message_reactions" },
      onChange,
    )
    .subscribe();
}

// ── Storage ───────────────────────────────────────────────────
export async function uploadImage(userId, file) {
  const ext = file.name.split(".").pop();
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error } = await sb.storage
    .from("chat-images")
    .upload(path, file, { contentType: file.type });

  if (error) return { url: null, error };

  const { data } = sb.storage.from("chat-images").getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

// ── Auth ──────────────────────────────────────────────────────
export async function login(email, password) {
  return sb.auth.signInWithPassword({ email, password });
}

export async function register(email, password) {
  return sb.auth.signUp({ email, password });
}

export async function loginWithGoogle(redirectTo) {
  return sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
}

export async function logout() {
  return sb.auth.signOut();
}

export async function getSession() {
  return sb.auth.getSession();
}

export async function getUser() {
  return sb.auth.getUser();
}

// ── Realtime messages ─────────────────────────────────────────
export function subscribeToConversation(me, other, onInsert, onUpdate) {
  const channel = sb.channel(`conversation:${[me, other].sort().join("-")}`);

  channel.on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `sender_id=eq.${other}`,
    },
    (payload) => {
      const msg = payload.new;
      const isRelevant =
        (msg.sender_id === me && msg.receiver_id === other) ||
        (msg.sender_id === other && msg.receiver_id === me);
      if (isRelevant) onInsert(msg);
    },
  );

  // Промени по вече съществуващи съобщения в този разговор:
  // редакция/изтриване (от другия) или доставено/прочетено (от мен ↔ него)
  channel.on(
    "postgres_changes",
    {
      event: "UPDATE",
      schema: "public",
      table: "messages",
      filter: `sender_id=eq.${other}`,
    },
    (payload) => onUpdate?.(payload.new),
  );
  channel.on(
    "postgres_changes",
    {
      event: "UPDATE",
      schema: "public",
      table: "messages",
      filter: `sender_id=eq.${me}`,
    },
    (payload) => onUpdate?.(payload.new),
  );

  return channel.subscribe();
}

export function unsubscribe(channel) {
  if (channel) sb.removeChannel(channel);
}

// ── Global incoming messages (за известия, независимо от отворения чат) ──
export function subscribeToAllIncomingMessages(userId, onMessage) {
  return sb
    .channel(`incoming-messages:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `receiver_id=eq.${userId}`,
      },
      (payload) => onMessage(payload.new),
    )
    .subscribe();
}

// ── Friendships ───────────────────────────────────────────────
export async function getFriends(userId) {
  return sb
    .from("friendships")
    .select(
      `
      *,
      sender:profiles!friendships_sender_id_fkey(id, email, display_name, avatar_url),
      receiver:profiles!friendships_receiver_id_fkey(id, email, display_name, avatar_url)
    `,
    )
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .eq("status", "accepted");
}

export async function getPendingInvites(userId) {
  return sb
    .from("friendships")
    .select(
      `
      *,
      sender:profiles!friendships_sender_id_fkey(id, email, display_name, avatar_url)
    `,
    )
    .eq("receiver_id", userId)
    .eq("status", "pending");
}

export async function sendFriendRequest(senderId, receiverId) {
  return sb
    .from("friendships")
    .insert({ sender_id: senderId, receiver_id: receiverId })
    .select()
    .single();
}

export async function respondToFriendRequest(friendshipId, status) {
  return sb
    .from("friendships")
    .update({ status })
    .eq("id", friendshipId)
    .select()
    .single();
}

export async function searchProfiles(email, currentUserId) {
  return sb
    .from("profiles")
    .select("*")
    .ilike("email", `%${email}%`)
    .neq("id", currentUserId)
    .limit(5);
}

export function subscribeToFriendRequests(userId, onRequest) {
  return sb
    .channel(`friend-requests:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "friendships",
        filter: `receiver_id=eq.${userId}`,
      },
      (payload) => onRequest(payload.new),
    )
    .subscribe();
}

export function createOnlineChannel(userId, onStatusChange) {
  const channel = sb.channel("online-users", {
    config: { presence: { key: userId } },
  });

  channel
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const onlineIds = Object.keys(state);
      onStatusChange(onlineIds);
    })
    .subscribe(async () => {
      await channel.track({ userId, online: true });
    });

  return channel;
}

// ── Групи ═══════════════════════════════════════════════════════
export async function createGroup(name, creatorId) {
  return sb
    .from("groups")
    .insert({ name, created_by: creatorId })
    .select()
    .single();
}

export async function addGroupMember(groupId, userId, role = "member") {
  return sb
    .from("group_members")
    .insert({ group_id: groupId, user_id: userId, role });
}

export async function getMyGroups(userId) {
  return sb
    .from("group_members")
    .select(
      "group_id, role, groups(id, name, avatar_url, created_by, created_at)",
    )
    .eq("user_id", userId);
}

export async function getGroupMembers(groupId) {
  return sb
    .from("group_members")
    .select(
      "user_id, role, joined_at, profiles(id, email, display_name, avatar_url)",
    )
    .eq("group_id", groupId);
}

export async function leaveGroup(groupId, userId) {
  return sb
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);
}

export async function removeGroupMember(groupId, userId) {
  return sb
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);
}

export async function renameGroup(groupId, name) {
  return sb.from("groups").update({ name }).eq("id", groupId).select().single();
}

// ── Групови съобщения ────────────────────────────────────────
export async function getGroupMessages(groupId) {
  return sb
    .from("messages")
    .select("*")
    .eq("group_id", groupId)
    .is("deleted_at", null)
    .order("created_at");
}

export async function sendGroupMessage(senderId, groupId, content) {
  return sb
    .from("messages")
    .insert({
      sender_id: senderId,
      group_id: groupId,
      receiver_id: null,
      content,
    })
    .select()
    .single();
}

export async function sendGroupImageMessage(senderId, groupId, imageUrl) {
  return sb
    .from("messages")
    .insert({
      sender_id: senderId,
      group_id: groupId,
      receiver_id: null,
      content: null,
      image_url: imageUrl,
    })
    .select()
    .single();
}

export async function sendGroupVoiceMessage(
  senderId,
  groupId,
  audioUrl,
  durationSeconds,
) {
  return sb
    .from("messages")
    .insert({
      sender_id: senderId,
      group_id: groupId,
      receiver_id: null,
      content: null,
      audio_url: audioUrl,
      audio_duration: durationSeconds,
    })
    .select()
    .single();
}

// ── Realtime: групов разговор (за отворения групов чат) ─────────
export function subscribeToGroupConversation(groupId, onInsert, onUpdate) {
  const channel = sb.channel(`group-conversation:${groupId}`);

  channel.on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `group_id=eq.${groupId}`,
    },
    (payload) => onInsert(payload.new),
  );

  channel.on(
    "postgres_changes",
    {
      event: "UPDATE",
      schema: "public",
      table: "messages",
      filter: `group_id=eq.${groupId}`,
    },
    (payload) => onUpdate?.(payload.new),
  );

  return channel.subscribe();
}

// ── Realtime: входящи групови съобщения (за известия, независимо
// от отворения чат) — филтрирано по всичките ти групи наведнъж.
export function subscribeToAllIncomingGroupMessages(groupIds, onMessage) {
  if (!groupIds?.length) return null;
  return sb
    .channel("incoming-group-messages")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `group_id=in.(${groupIds.join(",")})`,
      },
      (payload) => onMessage(payload.new),
    )
    .subscribe();
}
