import { sb } from "./supabase.js";

// ── Profiles ──────────────────────────────────────────────────
export async function getProfiles() {
  return sb.from("profiles").select("*");
}

export async function upsertProfile(id, email) {
  return sb.from("profiles").upsert({ id, email }, { onConflict: "id" });
}

// ── Messages ──────────────────────────────────────────────────
export async function getMessages(me, other) {
  return sb
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${me},receiver_id.eq.${other}),and(sender_id.eq.${other},receiver_id.eq.${me})`,
    )
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
export function subscribeToConversation(me, other, onMessage) {
  return sb
    .channel(`conversation:${[me, other].sort().join("-")}`)
    .on(
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
        if (isRelevant) onMessage(msg);
      },
    )
    .subscribe();
}

// ── Typing indicator (Presence) ───────────────────────────────
export function createTypingChannel(me, other) {
  const id = [me, other].sort().join("-");
  return sb.channel(`typing:${id}`, {
    config: { presence: { key: me } },
  });
}

export function unsubscribe(channel) {
  if (channel) sb.removeChannel(channel);
}

// ── Friendships ───────────────────────────────────────────────
export async function getFriends(userId) {
  return sb
    .from("friendships")
    .select(
      `
      *,
      sender:profiles!friendships_sender_id_fkey(id, email),
      receiver:profiles!friendships_receiver_id_fkey(id, email)
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
      sender:profiles!friendships_sender_id_fkey(id, email)
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
