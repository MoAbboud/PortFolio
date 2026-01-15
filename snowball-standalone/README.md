# ❄️ Snowball Creator

An interactive story/thought builder where ideas grow and branch like a rolling snowball.

## 🎯 Features

- **Start with a seed idea** - Enter any word, phrase, or sentence
- **Branch your thoughts** - Choose from 3 AI-generated prompts or create your own
- **Visual tree** - See your decision tree grow as you make choices
- **Essay format** - View your snowball journey as a flowing narrative
- **Beautiful animations** - Snowfall effects and smooth transitions

## 🚀 How to Use

1. Open `index.html` in any modern web browser
2. Enter your starting thought in the input field
3. Click "Begin Snowball"
4. Choose from the generated prompts OR type your own custom idea
5. Watch your thought chain grow!

## 📦 Deployment

### Deploy to Render (Free Static Site)

1. Create a new account at [render.com](https://render.com)
2. Click "New +" → "Static Site"
3. Connect your GitHub repo or upload this folder
4. Set these options:
   - **Build Command**: (leave empty)
   - **Publish Directory**: `.` (current directory)
5. Click "Create Static Site"

### Deploy to Netlify/Vercel

1. Drag and drop this entire folder to [netlify.com/drop](https://app.netlify.com/drop) or [vercel.com](https://vercel.com)
2. Your site is live!

### Or just open locally

Simply double-click `index.html` to run it in your browser - no server needed!

## 📁 Structure

```
snowball-standalone/
├── index.html          # Main HTML file
├── css/
│   └── snowball.css    # All styles
├── js/
│   └── snowball.js     # All functionality
└── README.md           # This file
```

## 🎨 Customization

- **Colors**: Edit CSS variables in `css/snowball.css`
- **Prompts**: Edit `SAMPLE_OPTIONS` array in `js/snowball.js`
- **Animations**: Adjust timing in `SNOWBALL_CONFIG` in `js/snowball.js`

## 🌟 100% Standalone

- No backend required
- No database needed
- No build process
- Just HTML, CSS, and vanilla JavaScript!

---

Made with ❄️ and creativity
