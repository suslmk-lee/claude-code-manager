// `npm run icon` — renders build/icon.html (the SVG source) to build/icon.png; electron-builder turns it into icon.icns.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, backgroundColor: '#00000000', webPreferences: { offscreen: true } });
  await w.loadFile(path.join(__dirname, 'icon.html'));
  await new Promise((r) => setTimeout(r, 800));
  fs.writeFileSync(path.join(__dirname, 'icon.png'), (await w.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })).toPNG());
  app.exit(0);
});
