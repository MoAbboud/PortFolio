# ❄️ Snowball Creator

An interactive story/thought builder where ideas grow and branch like a rolling snowball. Create branching narratives and watch your thoughts evolve into beautiful story trees! 🎨

*Updated January 2026*

## 🎯 Features

- **Start with a seed idea** - Enter any word, phrase, or sentence
- **Branch your thoughts** - Choose from 3 AI-generated prompts or create your own
- **Visual tree** - See your decision tree grow as you make choices
- **Essay format** - View your snowball journey as a flowing narrative with word count
- **Beautiful animations** - Enhanced snowfall effects with drift and smooth transitions
- **Undo/Reset** - Step back or start over at any time
- **Export** - Download your essay as a text file
- **Copy to Clipboard** - Quickly copy your essay for sharing
- **Keyboard shortcuts** - Fast navigation with Alt+Z (Undo), Alt+R (Reset), Alt+E (Export), Alt+C (Copy), 1-4 (Select options)
- **Mobile friendly** - Responsive design works on all devices
- **Toast notifications** - Clean, non-intrusive feedback

## 🚀 How to Use

1. Open `index.html` in any modern web browser
2. Enter your starting thought in the input field
3. Click "Begin Snowball" or press Enter
4. Choose from the generated prompts OR type your own custom idea
5. Watch your thought chain grow!
6. Use Undo (Alt+Z) to step back, Reset (Alt+R) to start over, or Export (Alt+E) to save your essay

### ⌨️ Keyboard Shortcuts

- **Alt+Z** - Undo last step
- **Alt+R** - Reset everything
- **Alt+E** - Export essay as text file
- **Alt+C** - Copy essay to clipboard
- **1-4** - Quick select options (1 = custom input, 2-4 = preset options)
- **Enter** - Submit custom input when focused

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
