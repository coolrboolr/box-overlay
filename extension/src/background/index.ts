chrome.runtime.onInstalled.addListener(() => {
  console.log("[background] extension installed");
});

console.log("[background] service worker loaded");
