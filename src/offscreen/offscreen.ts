console.log("Offscreen document loaded.");

// --- Base64 Helpers --- 
// https://stackoverflow.com/a/9458996
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

let offscreenLogs: string[] = []; // Array to store logs

// Helper function to log messages and store them
function logToOffscreen(message: any, level: 'log' | 'warn' | 'error' = 'log') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${String(message)}`;
    offscreenLogs.push(logEntry);
    // Also log to the actual console for live debugging if possible
    console[level](message);
}

// Helper to send logs back to background
function sendLogsToBackground(reason: string) {
    logToOffscreen(`Sending collected logs back due to: ${reason}`);
    chrome.runtime.sendMessage({
        target: 'background',
        action: 'offscreenLogData',
        data: offscreenLogs
    });
    // Clear logs after sending if needed, or keep accumulating
    // offscreenLogs = [];
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Wrap the entire handler to catch unexpected errors
    try {
        logToOffscreen(`Received message: ${JSON.stringify(message)}`);

        if (message.target !== 'offscreen') {
            logToOffscreen("Ignoring message not targeted at offscreen.", 'warn');
            return false; // Ignore messages not intended for the offscreen document
        }

        switch (message.type) {
            case 'fetch-audio-data':
                (async () => {
                    let url: string | undefined;
                    let downloadId: number | undefined;
                    try {
                        url = message.data?.url;
                        downloadId = message.data?.downloadId;
                        logToOffscreen(`Received fetch-audio-data request for URL: ${url}, Download ID: ${downloadId}`);
                        if (!url || downloadId === undefined) {
                            const errorMsg = "Fetch request missing URL or downloadId";
                            logToOffscreen(errorMsg, 'error');
                            sendLogsToBackground('Missing URL/ID'); // Send logs before error message
                            chrome.runtime.sendMessage({
                                target: 'background',
                                action: 'audioFetchError',
                                error: `Internal error: ${errorMsg} in offscreen request.`,
                                downloadId: downloadId ?? null
                            });
                            return;
                        }

                        // Fetch and get content type
                        const { arrayBuffer, contentType } = await handleFetchAudioData(url, downloadId);
                        logToOffscreen(`Fetch successful for Download ID: ${downloadId}. Content-Type: ${contentType}. Converting to Base64.`);
                        
                        // Convert to Base64 before sending
                        const base64Data = arrayBufferToBase64(arrayBuffer);
                        logToOffscreen(`Converted to Base64 (length: ${base64Data.length})`);

                        chrome.runtime.sendMessage({
                            target: 'background',
                            action: 'audioDataFetched',
                            data: base64Data,
                            contentType: contentType, // Include the detected content type
                            isBase64: true,
                            downloadId: downloadId
                        });
                    } catch (error) {
                         const errorMsg = error instanceof Error ? error.message : 'Unknown error during audio fetch in offscreen';
                         logToOffscreen(`Error in fetch-audio-data handling for Download ID ${downloadId ?? 'unknown'}: ${errorMsg}`, 'error');
                         sendLogsToBackground('Audio fetch error'); // Send logs before error message
                         chrome.runtime.sendMessage({
                             target: 'background',
                             action: 'audioFetchError',
                             error: errorMsg,
                             downloadId: downloadId ?? null
                         });
                    }
                })();
                 break;

            case 'read-clipboard':
                (async () => {
                    try {
                        logToOffscreen("Received read-clipboard request.");
                        const text = await handleReadClipboard();
                        logToOffscreen("Clipboard read successful. Sending data back.");
                        chrome.runtime.sendMessage({
                            target: 'background',
                            action: 'clipboardDataResponse',
                            data: text
                        });
                         // sendLogsToBackground('Clipboard read successful');
                    } catch (error) {
                        const errorMsg = error instanceof Error ? error.message : 'Unknown error during clipboard read in offscreen';
                        logToOffscreen(`Error in read-clipboard handling: ${errorMsg}`, 'error');
                        sendLogsToBackground('Clipboard read error'); // Send logs before error message
                        chrome.runtime.sendMessage({
                            target: 'background',
                            action: 'clipboardReadError',
                            error: errorMsg
                        });
                    }
                })();
                 break;

            default:
                logToOffscreen(`Received unknown message type: ${message.type}`, 'warn');
        }
    } catch (e) {
         const errorMsg = e instanceof Error ? e.message : String(e);
         logToOffscreen(`Unexpected synchronous error in onMessage handler: ${errorMsg}`, 'error');
         sendLogsToBackground('Synchronous message handler error'); // Send logs
    }
    return false;
});

// Updated function to return both ArrayBuffer and Content-Type
async function handleFetchAudioData(fileUrl: string, downloadId: number): Promise<{ arrayBuffer: ArrayBuffer, contentType: string | null }> {
    try {
        logToOffscreen(`Attempting fetch for URL: ${fileUrl} (Download ID: ${downloadId})`);
        const response = await fetch(fileUrl, { credentials: 'include' });
        logToOffscreen(`Fetch response status for ${fileUrl}: ${response.status}`);
        logToOffscreen(`Fetch response ok: ${response.ok}`);
        
        const contentTypeHeader = response.headers.get('content-type');
        const contentType = contentTypeHeader ? contentTypeHeader.split(';')[0].trim() : null; // Extract MIME type
        
        logToOffscreen(`Fetch response Content-Length: ${response.headers.get('content-length')}`);
        logToOffscreen(`Fetch response Content-Type header: ${contentTypeHeader}`);
        logToOffscreen(`Extracted Content-Type: ${contentType}`);

        if (!response.ok) {
            let errorBody = 'No further details available.';
            try {
                errorBody = await response.text();
                logToOffscreen(`Fetch error response body: ${errorBody}`);
            } catch (e) { 
                logToOffscreen("Failed to read error response body", 'warn');
             }
            throw new Error(`Fetch failed! Status: ${response.status} ${response.statusText} for ${fileUrl}. Body: ${errorBody}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        logToOffscreen(`Fetched ArrayBuffer size: ${arrayBuffer.byteLength} bytes`);

        if (arrayBuffer.byteLength === 0) {
             logToOffscreen(`Fetched ArrayBuffer is empty (0 bytes) for URL: ${fileUrl}`, 'warn');
        }

        return { arrayBuffer, contentType }; // Return both
    } catch (error) {
        logToOffscreen(`Error during fetch/processing for ${fileUrl}: ${error instanceof Error ? error.message : String(error)}`, 'error');
        throw error;
    }
}

// Function to read clipboard text using navigator.clipboard API
async function handleReadClipboard(): Promise<string> {
    try {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
            throw new Error("navigator.clipboard.readText API not available.");
        }
        const text = await navigator.clipboard.readText();
        logToOffscreen("Clipboard text read.");
        return text;
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logToOffscreen(`Error reading clipboard: ${errorMsg}`, 'error');
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
            throw new Error('Clipboard read permission denied. Please grant permission.');
        } else if (error instanceof Error && error.message.includes('Document is not focused')) {
            throw new Error('Clipboard access requires the document to be focused (internal error).');
        }
        throw error;
    }
}

console.log("[Offscreen] Script listeners attached."); 