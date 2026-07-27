# 💬 Chat App

A feature-rich, real-time chat application built using modern web technologies. Experience seamless 1-on-1 conversations with real-time updates, voice messaging, and instant notifications.

🚀 **Live Demo:** [chat4e.netlify.app](https://chat4e.netlify.app/chat/chat.html)

---

## 🚀 Tech Stack

- **Frontend:** HTML5, CSS3, JavaScript (ES6+ Modules)
- **Bundler:** Vite v5
- **Backend & Database:** Supabase (Authentication, PostgreSQL, Realtime Subscriptions & Storage)

---

## ✨ Features

- **🔒 Secure Auth:** Fully functional User Registration and Login system.
- **⚡ Real-Time Messaging:** Instant text communication powered by Supabase Realtime.
- **🎙️ Voice Messages:** Record and send audio notes directly within the chat.
- **🖼️ Media Sharing:** Upload and send images seamlessly.
- **😀 Emoji Picker:** Integrated emoji support (powered by `picmo`) to express yourself.
- **👥 User Profiles:** Personalize your account with custom display names and profile pictures.
- **🏷️ Chat Nicknames:** Assign custom nicknames to users within specific chats.
- **🔔 Friend Requests & Live Alerts:** Send chat invitations and receive instant live notifications for incoming requests.
- **🟢 Presence Indicator:** See who is online in real-time.

---

## 🛠️ Local Development Setup

Follow these steps to get the project running locally on your machine.

### 1. Clone the Repository

```bash
git clone <your-repository-url>
cd Chat
```

### 2. Install Dependencies

npm install

### 3. Environment Variables Configuration

Create a .env file in the root directory of your project and add your Supabase credentials:

VITE_SUPABASE_URL=[https://your-supabase-project.supabase.co](https://your-supabase-project.supabase.co)
VITE_SUPABASE_KEY=your-supabase-anon-key

### 4. Start the Development Server

npm run dev

The app will be up and running at http://localhost:5173 (or the port specified by Vite).

Available Scripts

npm run dev - Starts the Vite development server.

npm run build - Builds the production-ready assets.

npm run preview - Locally previews the production build.

### 🗺️ Roadmap & Future Enhancements

Here are the features currently in development or planned for future releases:

[ ] Push Notifications: Native push alerts using Service Workers (Supabase Edge Function send-push infrastructure is underway).

[ ] Chat History Search: Quick text search inside message histories.

[ ] Pagination & Lazy Loading: Optimize performance for long chat histories.

[ ] Image Compression: Compress images client-side before uploading to save bandwidth and storage.

[ ] PWA Support: Make the application installable on mobile/desktop with offline capabilities.

[ ] Privacy & Control: Account deletion and GDPR-compliant data export options.
