# 🎭 TekTak - TikTok Drama Tracker

A mindful way to stay updated on TikTok drama without the endless scroll. Just text summaries, no videos!

## ✨ What Is This?

TekTak lets you **manually curate** TikTok drama stories for people who want to stay informed without getting sucked into social media. Perfect for:
- Getting off the scroll while staying in the loop
- Quick drama catch-ups during breaks
- Portfolio projects showcasing curation skills
- Building a niche drama news site

## 🎯 Features

- **Admin Panel** - Easy-to-use interface for adding drama stories
- **Manual Curation** - You control the content (no APIs needed!)
- **Local Storage** - Data saved in your browser (no backend required)
- **Sample Data** - Ships with examples so it looks polished immediately
- **TikTok-Inspired Design** - Pink and blue gradients, dark theme, modern UI

## 🚀 Quick Start

### For Viewers:
1. Open **`index.html`** in any browser.
2. Browse the latest drama, hashtags, and tea spillers.
3. If no curated data exists, you'll see sample data

### For Curators (You!):
1. Open **`admin.html`** in any browser
2. Fill out the forms to add:
   - 🍿 **Drama Stories** (title, description, type, engagement stats)
   - 🔥 **Trending Hashtags** (name, type, post/view counts)
   - 👑 **Tea Spillers** (username, follower count, what they're known for)
3. Your changes save instantly to localStorage
4. Refresh `index.html` to see your curated content!

## 📝 Daily Workflow

**Spend 10-15 minutes daily curating drama:**

1. Browse TikTok, Twitter, or drama news sites (Dexerto, Drama Alert, etc.)
2. Find 2-3 interesting drama stories
3. Open `admin.html`
4. Add a story with:
   - Catchy title
   - Brief summary (2-3 sentences)
   - Drama type (feud/scandal/controversy/response/legal)
   - Relevant hashtags
   - Engagement stats (estimate if needed)
5. Update trending hashtags weekly
6. Feature new drama creators monthly

**Pro tip:** Keep a notes app open while browsing TikTok to copy drama details quickly!

## 🎨 Drama Types Explained

- **Drama** - General tea and gossip
- **Scandal** - Exposed/cancelled creators
- **Feud** - Influencer fights and call-outs
- **Controversy** - Platform issues, problematic behavior
- **Response** - Apologies, statements, clap-backs
- **Legal** - Lawsuits, court cases, legal threats

## 📦 Deployment

### Option 1: GitHub Pages (Free!)
1. Create a GitHub repo
2. Upload `index.html` and `admin.html`
3. Enable GitHub Pages in repo settings
4. Share the public link for viewers
5. Keep `admin.html` URL private (or password protect it)

### Option 2: Netlify/Vercel (Free!)
1. Drag and drop the folder
2. Deploy instantly
3. No build process needed

### Option 3: Local Only
- Just open the HTML files from your computer
- Data stays in your browser's localStorage

## 🔒 Security Note

**Keep admin.html private!** Anyone with access can edit your content. Options:
- Don't link to it from your main site
- Use a hosting service with basic auth
- Add a simple password prompt (ask me to add this!)
- Only use it locally on your computer

## 🛠️ Future Enhancements (If You Want)

When you're ready to scale beyond manual curation:
1. **Simple password protection** for admin panel
2. **Export/Import** data as JSON for backups
3. **ChatGPT API integration** to auto-summarize TikTok links you paste
4. **News scraper** to pull from drama aggregator sites
5. **Community submissions** with moderation queue
6. **Backend + database** for multi-curator collaboration

## 💾 Data Storage

All data is stored in your browser's **localStorage**:
- No backend required
- No database costs
- Works 100% offline
- Persists between sessions
- Each browser/device is independent

**To backup your data:**
1. Open browser DevTools (F12)
2. Go to Application/Storage → Local Storage
3. Copy the `tektakDrama`, `tektakHashtags`, `tektakInfluencers` entries
4. Save to a text file

## 📱 Mobile Friendly

Both the public site and admin panel work great on phones. You can curate on the go!

---

Made with 🍿 for mindful drama consumption
