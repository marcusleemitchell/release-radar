/**
 * preload.js — exposes a minimal, explicit API to the web page.
 * (contextIsolation is on, so the page can only call what's listed here.)
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("releaseRadar", {
  /**
   * Copy an image of a page region to the system clipboard.
   * @param {{x:number,y:number,width:number,height:number}} rect  CSS px, document coordinates
   * @param {number} scale  device pixel ratio (2 on retina)
   */
  copyImage: (rect, scale) => ipcRenderer.invoke("copy-image", rect, scale),
});
