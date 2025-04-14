(()=>{"use strict";console.log("Offscreen document loaded.");let e=[];function r(r,t="log"){const o=`[${(new Date).toISOString()}] [${t.toUpperCase()}] ${String(r)}`;e.push(o),console[t](r)}function t(t){r(`Sending collected logs back due to: ${t}`),chrome.runtime.sendMessage({target:"background",action:"offscreenLogData",data:e})}chrome.runtime.onMessage.addListener(((e,o,n)=>{try{if(r(`Received message: ${JSON.stringify(e)}`),"offscreen"!==e.target)return r("Ignoring message not targeted at offscreen.","warn"),!1;switch(e.type){case"fetch-audio-data":(async()=>{try{const{url:o,downloadId:n}=e.data;if(r(`Received fetch-audio-data request for URL: ${o}, Download ID: ${n}`),!o||void 0===n){const e="Fetch request missing URL or downloadId";return r(e,"error"),t("Missing URL/ID"),void chrome.runtime.sendMessage({target:"background",action:"audioFetchError",error:`Internal error: ${e} in offscreen request.`,downloadId:n??null})}const a=await async function(e,t){try{r(`Attempting fetch for URL: ${e} (Download ID: ${t})`);const o=await fetch(e,{credentials:"include"});if(r(`Fetch response status for ${e}: ${o.status}`),r(`Fetch response ok: ${o.ok}`),r(`Fetch response Content-Length: ${o.headers.get("content-length")}`),r(`Fetch response Content-Type: ${o.headers.get("content-type")}`),!o.ok){let t="No further details available.";try{t=await o.text(),r(`Fetch error response body: ${t}`)}catch(e){r("Failed to read error response body","warn")}throw new Error(`Fetch failed! Status: ${o.status} ${o.statusText} for ${e}. Body: ${t}`)}const n=await o.arrayBuffer();return r(`Fetched ArrayBuffer size: ${n.byteLength} bytes`),0===n.byteLength&&r(`Fetched ArrayBuffer is empty (0 bytes) for URL: ${e}`,"warn"),n}catch(t){throw r(`Error during fetch/processing for ${e}: ${t instanceof Error?t.message:String(t)}`,"error"),t}}(o,n);r(`Fetch successful for Download ID: ${n}. Converting to Base64.`);const s=function(e){let r="";const t=new Uint8Array(e),o=t.byteLength;for(let e=0;e<o;e++)r+=String.fromCharCode(t[e]);return btoa(r)}(a);r(`Converted to Base64 (length: ${s.length})`),chrome.runtime.sendMessage({target:"background",action:"audioDataFetched",data:s,isBase64:!0,downloadId:n})}catch(o){const n=o instanceof Error?o.message:"Unknown error during audio fetch in offscreen";r(`Error in fetch-audio-data handling for Download ID ${e?.data?.downloadId}: ${n}`,"error"),t("Audio fetch error"),chrome.runtime.sendMessage({target:"background",action:"audioFetchError",error:n,downloadId:e?.data?.downloadId??null})}})();break;case"read-clipboard":(async()=>{try{r("Received read-clipboard request.");const e=await async function(){try{if(!navigator.clipboard||!navigator.clipboard.readText)throw new Error("navigator.clipboard.readText API not available.");const e=await navigator.clipboard.readText();return r("Clipboard text read."),e}catch(e){if(r(`Error reading clipboard: ${e instanceof Error?e.message:String(e)}`,"error"),e instanceof DOMException&&"NotAllowedError"===e.name)throw new Error("Clipboard read permission denied. Please grant permission.");if(e instanceof Error&&e.message.includes("Document is not focused"))throw new Error("Clipboard access requires the document to be focused (internal error).");throw e}}();r("Clipboard read successful. Sending data back."),chrome.runtime.sendMessage({target:"background",action:"clipboardDataResponse",data:e})}catch(e){const o=e instanceof Error?e.message:"Unknown error during clipboard read in offscreen";r(`Error in read-clipboard handling: ${o}`,"error"),t("Clipboard read error"),chrome.runtime.sendMessage({target:"background",action:"clipboardReadError",error:o})}})();break;default:r(`Received unknown message type: ${e.type}`,"warn")}}catch(e){r(`Unexpected synchronous error in onMessage handler: ${e instanceof Error?e.message:String(e)}`,"error"),t("Synchronous message handler error")}return!1})),console.log("[Offscreen] Script listeners attached.")})();