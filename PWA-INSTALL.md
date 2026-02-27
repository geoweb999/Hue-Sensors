# Installing the Hue Dashboard as an App

Your Hue Temperature Dashboard is now a **Progressive Web App (PWA)**! This means you can install it on your phone, tablet, or computer and use it like a native app.

## Benefits of Installing

✅ **App-like experience** - Opens in its own window, no browser UI
✅ **Home screen icon** - Launch directly from your home screen
✅ **Offline support** - View cached data even without internet
✅ **Faster loading** - Assets cached for instant startup
✅ **Better mobile experience** - Fullscreen, no address bar

---

## iOS Installation (iPhone/iPad)

1. **Open Safari** (must use Safari, not Chrome)
   - Navigate to `http://10.0.18.93:3000`

2. **Tap the Share button** (square with arrow pointing up)
   - Located at the bottom center of Safari

3. **Scroll down and tap "Add to Home Screen"**
   - You'll see the app icon and name

4. **Tap "Add"** in the upper right

5. **Done!** The app icon appears on your home screen

**Launching the App:**
- Tap the "Hue Temps" icon on your home screen
- Opens fullscreen without Safari UI
- Works just like a native app!

---

## Android Installation

1. **Open Chrome** (or other supported browser)
   - Navigate to `http://10.0.18.93:3000`

2. **Tap the menu** (three dots in upper right)

3. **Tap "Install app"** or "Add to Home Screen"
   - Chrome may also show an automatic install prompt

4. **Tap "Install"** when prompted

5. **Done!** App appears in your app drawer

**Launching the App:**
- Find "Hue Temperature Dashboard" in your app drawer
- Opens in standalone window
- Can be pinned to home screen

---

## macOS Installation (Safari/Chrome)

### Safari:
1. Open Safari and navigate to `http://10.0.18.93:3000`
2. Click **Safari → Add to Dock** (macOS Sonoma+)
3. Or: **File → Add to Dock**

### Chrome/Edge:
1. Open Chrome/Edge and navigate to `http://10.0.18.93:3000`
2. Click the **install icon** in the address bar (computer with arrow)
3. Or: **Menu (⋮) → Install Hue Temperature Dashboard**
4. Click **Install**

The app appears in your Applications folder and Dock!

---

## Windows Installation (Chrome/Edge)

1. Open Chrome or Edge
2. Navigate to `http://10.0.18.93:3000`
3. Click the **install icon** in the address bar
4. Or: **Menu (⋯) → Apps → Install Hue Temperature Dashboard**
5. Click **Install**

App appears in Start Menu and can be pinned to taskbar!

---

## Features When Installed

### Works Offline
- Last fetched data is cached
- Can view temperatures even without connection
- Automatically updates when connection restored

### Standalone Window
- No browser UI (address bar, tabs, etc.)
- Feels like a native app
- Can be minimized, maximized like any app

### Fast Loading
- Static assets cached
- Instant startup after first load
- Background updates when online

### Mobile Enhancements
- Fullscreen on phones
- Respects device safe areas (notches, etc.)
- Better touch targets
- Works with iOS multitasking

---

## Updating the App

The app automatically checks for updates when you open it. If a new version is available:

1. **Automatic Update:** Most updates happen in the background
2. **Manual Update (if needed):**
   - iOS: Delete app, reinstall from Safari
   - Android: Uninstall, reinstall from Chrome
   - Desktop: Go to browser settings → Apps → Manage, reinstall

---

## Uninstalling

### iOS:
- Long-press the app icon → **Remove App** → **Delete App**

### Android:
- Long-press the app → **App info** → **Uninstall**
- Or: Settings → Apps → Hue Temperature Dashboard → Uninstall

### Desktop:
- **macOS:** Drag from Applications to Trash
- **Windows:** Settings → Apps → Uninstall
- **Chrome/Edge:** chrome://apps or edge://apps → Right-click → Uninstall

---

## Troubleshooting

### "Add to Home Screen" not appearing (iOS)
- Make sure you're using **Safari** (not Chrome or other browsers)
- iOS requires Safari for PWA installation
- Check that you're on iOS 11.3 or later

### Can't install on Android
- Make sure you're using Chrome, Edge, or Samsung Internet
- Check that you're on Android 5.0 or later
- Some browsers don't support PWA installation

### App won't open
- Check that the server is running: `http://10.0.18.93:3000`
- Make sure you're on the same network
- Try opening in browser first to verify connection

### Offline mode not working
- App needs to be opened at least once while online
- Service worker caches data on first visit
- If still not working, clear cache and reload

### Icons not showing
- Icons are automatically generated
- If you want custom icons, replace files in `public/icons/`
- Must be PNG format
- Sizes: 72x72, 96x96, 128x128, 144x144, 152x152, 192x192, 384x384, 512x512

---

## Network Configuration

The app connects to your local server at `http://10.0.18.93:3000`. This works great on your home network!

### Using Outside Your Home
If you want to use the app when away from home, you'll need to:

1. **Port forward** on your router (port 3000)
2. **Set up dynamic DNS** (like DuckDNS or No-IP)
3. **Update manifest.json** to use your public URL
4. **Consider security** (add authentication, HTTPS)

For most users, local network use is sufficient and more secure!

---

## Advanced: Custom Icons

Want to customize the app icon? Replace the files in `public/icons/` with your own designs:

**Quick method:**
1. Create one high-res image (1024x1024 recommended)
2. Use https://realfavicongenerator.net/
3. Upload your image, download all sizes
4. Replace files in `public/icons/`

**Manual method:**
1. Create PNG images in all required sizes
2. Name them `icon-{size}x{size}.png`
3. Place in `public/icons/`

---

## Technical Details

**What is a PWA?**
A Progressive Web App is a web application that can be installed and run like a native app. It uses modern web technologies to provide an app-like experience.

**Technologies Used:**
- **Manifest.json** - App metadata and icons
- **Service Worker** - Offline caching and background sync
- **Cache API** - Fast loading and offline support
- **Web App Manifest** - Installation prompts and behavior

**Browser Support:**
- ✅ iOS Safari 11.3+
- ✅ Android Chrome 40+
- ✅ Desktop Chrome 73+
- ✅ Desktop Edge 79+
- ✅ Desktop Safari 15.4+
- ❌ Firefox (limited PWA support)

---

## Questions?

**Can I use it like a real app?**
Yes! Once installed, it behaves like a native app with its own window/icon.

**Does it use more space?**
Minimal - just caches the web assets (~5-10MB).

**Can I install on multiple devices?**
Yes! Install on phone, tablet, computer - they all connect to your server.

**What if the server is down?**
You can still open the app and view the last cached data.

**Is it secure?**
It connects to your local network server. Since it's HTTP (not HTTPS), keep it on your local network only.

---

Enjoy your installed app! 🎉
