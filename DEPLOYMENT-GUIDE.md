# 🚀 Deployment Guide - Static Site Hosting

Your apps are now ready to deploy! Here's how to host them for **FREE**.

## 📁 What You Have

### ✅ Ready to Deploy:
1. **snowball-standalone/** - Interactive story generator
2. **tektak-standalone/** - TikTok drama tracker
3. **spotlight/** - Designer showcase (already static)

### ❌ Can Delete:
- **snowball/** (Laravel version - 150MB)
- **TekTak/** (Laravel version - similar size)

---

## 🌐 Option 1: Render.com (Recommended)

Perfect for static sites, free forever!

### Steps:
1. Go to [render.com](https://render.com) → Sign up
2. Click **"New +"** → **"Static Site"**
3. Choose deployment method:
   - **From GitHub**: Connect your repo
   - **Manual**: Upload folder directly
4. Configure:
   - **Build Command**: (leave empty)
   - **Publish Directory**: `.` or root
5. Click **"Create Static Site"**
6. Done! Your site is live at `https://your-app-name.onrender.com`

### Deploy Each App Separately:
- Create 3 static sites (one for each app folder)
- Or create one site and use subdirectories

---

## 🎯 Option 2: Netlify Drop

Fastest deployment ever!

### Steps:
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. **Drag and drop** your app folder
3. Done! Instant URL like `https://random-name.netlify.app`

You can rename it in settings to something like `snowball-creator.netlify.app`

---

## ⚡ Option 3: Vercel

Great performance, free tier!

### Steps:
1. Go to [vercel.com](https://vercel.com)
2. Click **"Add New..."** → **"Project"**
3. Upload your folder or connect GitHub
4. Click **"Deploy"**
5. Live at `https://your-app.vercel.app`

---

## 🗑️ Cleanup: Delete Laravel Apps

Once you've extracted the good stuff, delete the heavy Laravel folders:

```powershell
# Delete snowball Laravel version (saves ~150MB)
Remove-Item -Recurse -Force "C:\Users\Absol\OneDrive\Documents\GitHub\PortFol\snowball"

# Delete TekTak Laravel version (saves ~150MB)
Remove-Item -Recurse -Force "C:\Users\Absol\OneDrive\Documents\GitHub\PortFol\TekTak"
```

**Total savings: ~300MB!**

---

## 📊 Before vs After

### Before:
```
PortFol/
├── snowball/          (152 MB - Laravel) ❌
├── TekTak/            (150 MB - Laravel) ❌
├── spotlight/         (1 MB - Static) ✅
└── Default.html
```

### After:
```
PortFol/
├── snowball-standalone/  (0.5 MB) ✅
├── tektak-standalone/    (0.2 MB) ✅
├── spotlight/            (1 MB) ✅
└── Default.html
```

**Went from 303 MB → 1.7 MB** (99% reduction!)

---

## 🎨 Custom Domains (Optional)

All three platforms support custom domains:

1. Buy a domain (Namecheap, Google Domains, etc.)
2. In your hosting platform, go to **Settings** → **Domains**
3. Add your custom domain
4. Update DNS records (they'll show you how)
5. Wait 24-48 hours for DNS propagation

Example: `snowball.yourdomain.com`

---

## ✅ Next Steps

1. ✅ Deploy all 3 apps to Render/Netlify/Vercel
2. ✅ Test them in production
3. ✅ Delete the Laravel folders
4. ✅ Add links to your portfolio (Default.html)
5. 🎉 Show off your deployed apps!

---

## 💡 Pro Tips

- **GitHub**: Push your standalone apps to a repo for easy version control
- **Environment**: No environment variables needed (it's all static!)
- **Speed**: Static sites load INSTANTLY (no server processing)
- **Cost**: $0/month forever on free tiers
- **SSL**: All platforms give you free HTTPS automatically

---

Need help deploying? Just ask! 🚀
