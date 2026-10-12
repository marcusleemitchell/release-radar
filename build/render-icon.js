/**
 * render-icon.js — rasterise build/icon.svg to build/icon.png (1024x1024)
 * using Electron's Chromium, which handles gradients/opacity correctly.
 *
 * Run via: npm run icon   (this also builds build/icon.icns)
 */

const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const SIZE = 1024;
const SVG = path.join(__dirname, "icon.svg");
const OUT = path.join(__dirname, "icon.png");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: SIZE,
    height: SIZE,
    useContentSize: true,
    transparent: true,
    frame: false,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: true },
  });

  const svg = fs.readFileSync(SVG, "utf8");
  const html = `<!doctype html><html><body style="margin:0;background:transparent">
    <div style="width:${SIZE}px;height:${SIZE}px;line-height:0">${svg}</div></body></html>`;

  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));

  let image = await win.webContents.capturePage();
  const { width } = image.getSize();
  if (width !== SIZE) image = image.resize({ width: SIZE, height: SIZE, quality: "best" });

  fs.writeFileSync(OUT, image.toPNG());
  console.log(`Wrote ${OUT} (${SIZE}x${SIZE})`);
  app.quit();
});
