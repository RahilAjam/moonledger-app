import { adsConfig } from "/ads-config.js";

const validPublisherId = /^ca-pub-\d+$/.test(adsConfig.publisherId);
const hasAdSlot = document.querySelector("[data-moonledger-ad]");
const adWrap = document.querySelector("[data-moonledger-ad-wrap]");

// Keep the reserved space out of the layout until a real ad is configured.
if (adWrap) adWrap.hidden = true;

// Do not contact Google or request ads until the owner enables this config
// after AdSense approval and supplies the publisher and ad unit IDs.
if (adsConfig.enabled && validPublisherId && adsConfig.publicPageSlotId && hasAdSlot) {
  if (adWrap) adWrap.hidden = false;
  const script = document.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(adsConfig.publisherId);
  script.onload = () => {
    const slot = document.querySelector("[data-moonledger-ad]");
    slot.dataset.adClient = adsConfig.publisherId;
    slot.dataset.adSlot = adsConfig.publicPageSlotId;
    slot.dataset.adFormat = "auto";
    slot.dataset.fullWidthResponsive = "true";
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  };
  document.head.append(script);
}
