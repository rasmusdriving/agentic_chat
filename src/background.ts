// Background service worker 

// --- Base64 Helpers --- 
// https://stackoverflow.com/a/9458996
function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary_string = atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

console.log("Background service worker started.");

const SUPPORTED_MIME_TYPES = [
    'audio/mpeg', // mp3
    'audio/mp3',  // Add mp3 explicitly
    'audio/mp4', // mp4, m4a
    'audio/ogg', // ogg
    'audio/wav', // wav
    'audio/webm', // webm
    'audio/flac', // flac
    // Add mpeg, mpga if necessary, check their common mime types
];

const SUPPORTED_EXTENSIONS = [
    '.flac', '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.ogg', '.wav', '.webm'
];

const MAX_FILE_SIZE_BYTES = 40 * 1024 * 1024; // 40MB

// Map extensions to MIME types for inference
const EXT_TO_MIME_TYPE: { [key: string]: string } = {
    '.mp3': 'audio/mpeg',
    '.mp4': 'audio/mp4',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.webm': 'audio/webm',
    '.flac': 'audio/flac',
    '.mpeg': 'audio/mpeg', // Added based on SUPPORTED_EXTENSIONS
    '.mpga': 'audio/mpeg'  // Added based on SUPPORTED_EXTENSIONS
};

// Create a reverse map for getting extension from MIME type
const MIME_TO_EXT_TYPE: { [key: string]: string } = Object.entries(EXT_TO_MIME_TYPE)
    .reduce((acc, [ext, mime]) => {
        // Prioritize common extensions for ambiguous MIME types (e.g., audio/mpeg -> .mp3)
        if (mime === 'audio/mpeg' && !acc[mime]) {
            acc[mime] = '.mp3';
        } else if (mime === 'audio/mp4' && !acc[mime]) {
             acc[mime] = '.m4a'; // Or .mp4, .m4a is common for audio-only
        } else if (!acc[mime]) { // Assign if not already set
            acc[mime] = ext;
        }
        return acc;
    }, {} as { [key: string]: string });
// Add explicit audio/mp3 mapping if not covered
MIME_TO_EXT_TYPE['audio/mp3'] = '.mp3'; 

console.log("MIME to Extension Map:", MIME_TO_EXT_TYPE);

// Define the path relative to the extension's root directory
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const GROQ_CHAT_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// --- Offscreen Document Management ---

let creatingOffscreenDocument: Promise<void> | null = null; // Prevent race conditions

// Function to check if an offscreen document is active
async function hasOffscreenDocument(path: string): Promise<boolean> {
    // Check if contexts are supported (they are in MV3)
    if (!chrome.runtime.getContexts) {
        console.warn("chrome.runtime.getContexts is not available.");
        // Fallback or error handling might be needed if getContexts is truly unavailable
        // For now, we assume it exists but types might be incomplete.
        return false; 
    }

    try {
        // Use chrome.runtime.getURL() to get the absolute path
        const documentUrl = chrome.runtime.getURL(path);
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
            documentUrls: [documentUrl] // Use the resolved URL
        });
        return existingContexts.length > 0;
    } catch (error) {
        console.error("Error checking for offscreen document:", error);
        // Attempting to access getContexts might fail if API isn't fully supported
        // or if there's an unexpected issue.
        return false; // Assume no document exists if check fails
    }
}

// Function to create and setup the offscreen document
async function setupOffscreenDocument(path: string): Promise<void> {
    // Use the updated hasOffscreenDocument check
    const documentExists = await hasOffscreenDocument(path);
    if (documentExists) {
        console.log("Offscreen document already exists.");
        return;
    }

    // Avoid race conditions when creating the document
    if (creatingOffscreenDocument) {
        await creatingOffscreenDocument;
    } else {
        // Use chrome.runtime.getURL() here as well
        const documentUrl = chrome.runtime.getURL(path);
        creatingOffscreenDocument = chrome.offscreen.createDocument({
            url: documentUrl, // Use the resolved URL
            reasons: [chrome.offscreen.Reason.DOM_PARSER], // Reason for needing the document (DOM operations, etc.)
            justification: 'Fetching downloaded audio file content',
        });
        try {
            await creatingOffscreenDocument;
            console.log("Offscreen document created successfully.");
        } catch (error: any) {
             console.error("Failed to create offscreen document:", error);
             // Handle specific errors if needed
             if (error.message.includes("Only a single offscreen document may be created")) {
                // This might happen in rare race conditions, log it
                console.warn("Attempted to create offscreen document when one already existed.");
             } else {
                 throw error; // Re-throw other errors
             }
        } finally {
            creatingOffscreenDocument = null;
        }
    }
}

// Function to close the offscreen document
/* // DEBUG: Temporarily disable all closing
async function closeOffscreenDocument(): Promise<void> {
    if (!(await hasOffscreenDocument(OFFSCREEN_DOCUMENT_PATH))) {
        console.log("No active offscreen document to close.");
        return;
    }
    await chrome.offscreen.closeDocument();
    console.log("Offscreen document closed.");
}
*/
// DEBUG: Stub function during disable
async function closeOffscreenDocument(): Promise<void> {
     console.warn("DEBUG: closeOffscreenDocument called but is disabled.");
}

// --- Download Listener ---

chrome.downloads.onChanged.addListener(async (delta) => {
    // Check if the download is complete
    if (delta.state?.current === 'complete' && delta.state.previous !== 'complete') {
        try {
            // Get the full download item details using the id from the delta
            const downloadItems = await chrome.downloads.search({ id: delta.id });
            if (downloadItems.length > 0) {
                const item = downloadItems[0];
                console.log("Download complete:", item);

                // Check if it's a supported audio file type
                const isSupportedMime = SUPPORTED_MIME_TYPES.includes(item.mime.toLowerCase());
                const isSupportedExt = SUPPORTED_EXTENSIONS.some(ext => item.filename.toLowerCase().endsWith(ext));

                if ((isSupportedMime || isSupportedExt) && item.filename && item.id) {
                    console.log(`Supported audio file downloaded: ${item.filename}`);

                    // Store download info for the popup to potentially act on
                    await chrome.storage.local.set({
                        pendingDownload: {
                            downloadId: item.id,
                            filename: item.filename,
                            url: item.url, // Crucial for fetching via offscreen
                            fileSize: item.fileSize,
                            mime: item.mime,
                        },
                        transcriptionState: 'pending_user_action', 
                        transcriptionResult: null, 
                        transcriptionError: null
                    });
                    console.log("Stored pending download:", item.id);

                    // Notify popup to update its state
                    chrome.runtime.sendMessage({ action: 'updatePopupState' }).catch(e => console.log("Popup not open or listening?"));

                } else {
                    console.log(`Ignoring unsupported file: ${item.filename} (MIME: ${item.mime})`);
                }
            }
        } catch (error) {
            console.error("Error processing download change:", error);
        }
    }
});

// --- Helper to get API Key ---
async function getApiKey(): Promise<string | null> {
    try {
        const result = await chrome.storage.local.get('groqApiKey');
        return result.groqApiKey || null;
    } catch (error) {
        console.error("Error retrieving Groq API key:", error);
        return null;
    }
}

// --- Groq Chat API Call (Streaming Version) ---
async function streamGroqChatApi(
    apiKey: string,
    model: string,
    messages: { role: 'user' | 'assistant', content: any }[]
): Promise<void> { // No longer returns the full string directly

    console.log(`Starting streaming Groq Chat API call with model: ${model}`);
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };

    // *** Fix: Create a new array containing only role and content for the API ***
    const messagesForApi = messages.map(({ role, content }) => ({ role, content }));

    const body = JSON.stringify({
        model: model,
        messages: messagesForApi, // Use the cleaned array
        stream: true // Enable streaming
    });

    let accumulatedResponse = ""; // To store the full response for history

    try {
        // Log the messages being sent to the API
        console.log('[Background] Streaming Groq Chat API Call - Messages Payload:', JSON.stringify(messagesForApi.map(m => ({ role: m.role, content: typeof m.content === 'string' ? `${m.content.substring(0, 100)}...` : '[Object/Array]' }))));

        const response = await fetch(GROQ_CHAT_API_URL, {
            method: 'POST',
            headers: headers,
            body: body
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error('Groq API Streaming Error Response:', response.status, errorBody);
            throw new Error(`API stream request failed with status ${response.status}: ${errorBody}`);
        }

        if (!response.body) {
            throw new Error('Response body is null');
        }

        // Process the stream
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                console.log("Stream finished.");
                break;
            }

            buffer += value;
            // Process buffer line by line (SSE format: data: {...}\n\n)
            let lines = buffer.split('\n\n');
            buffer = lines.pop() || ''; // Keep the potentially incomplete last part

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonData = line.substring(6).trim(); // Remove 'data: '
                    if (jsonData === '[DONE]') {
                        console.log("Received [DONE] marker.");
                        // The loop will break on the next read() returning done=true
                        continue;
                    }
                    try {
                        const parsedData = JSON.parse(jsonData);
                        const deltaContent = parsedData.choices?.[0]?.delta?.content;

                        if (deltaContent) {
                            accumulatedResponse += deltaContent; // Accumulate for final history
                            // Send chunk to popup
                            chrome.runtime.sendMessage({
                                action: 'addAiChatChunk',
                                payload: { chunk: deltaContent }
                            }).catch(e => console.log("Popup not open or listening for chat chunk?"));
                        }
                         // Check for finish reason (optional, good practice)
                         if (parsedData.choices?.[0]?.finish_reason) {
                             console.log("Stream finished with reason:", parsedData.choices[0].finish_reason);
                         }

                    } catch (parseError) {
                        console.error('Error parsing stream data JSON:', parseError, 'Data:', jsonData);
                    }
                }
            }
        }

        // Stream ended, send final message with accumulated content for history
        chrome.runtime.sendMessage({
            action: 'endAiChatStream',
            payload: { fullResponse: accumulatedResponse }
        }).catch(e => console.log("Popup not open or listening for stream end?"));

    } catch (error) {
        console.error('Error during Groq Chat API stream processing:', error);
        // Send a generic chat error message to the popup
        chrome.runtime.sendMessage({
            action: 'chatError',
            payload: { error: (error instanceof Error ? error.message : String(error)) || 'Failed to process AI stream.' }
        }).catch(e => console.log("Popup not open or listening for stream error?"));
    }
}

// --- Message Listener (from Popup and Offscreen) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Message received in background:", message, "from:", sender.id);
    let isAsync = false; // Flag to indicate if sendResponse will be called asynchronously

    // Message from Popup
    if (message.action === 'startTranscription') {
        const downloadId = message.downloadId;
        if (downloadId) {
            chrome.storage.local.set({ transcriptionState: 'loading' })
             .then(() => {
                 chrome.runtime.sendMessage({ action: 'updatePopupState' }).catch(e => console.log("Popup not open?"));
                 handleTranscriptionRequest(downloadId);
                 // Don't return true, transcription handles its own response via messages
             });
        }
    } else if (message.action === 'cancelTranscription') {
        const downloadId = message.downloadId;
        chrome.storage.local.remove(['pendingDownload', 'transcriptionState', 'transcriptionResult', 'transcriptionError']);
        closeOffscreenDocument();
        console.log(`Transcription cancelled by user for download ${downloadId}`);
    } else if (message.action === 'requestOffscreenClose') {
        console.log("Received request from popup to close offscreen document.");
        closeOffscreenDocument();
    } else if (message.action === 'sendChatMessage') {
        isAsync = true; // Still async, but response comes via stream messages
        const { model, messages } = message.payload;

        getApiKey().then(apiKey => {
            if (!apiKey) {
                console.error("API Key not found for chat request.");
                chrome.runtime.sendMessage({ action: 'chatError', payload: { error: 'API key not set.' } })
                    .catch(e => console.log("Popup not open or listening for chatError?"));
                sendResponse({ success: false, error: 'API key not set.' });
                return;
            }

            // Prepend the system message
            const messagesWithSystemPrompt = [
                 { role: 'system', content: 'You are a helpful assistant called Mark, you are an expert in the field of the swedish rental market and law' },
                 ...messages // Add the original messages after the system prompt
            ];

            // Call the streaming function - Do NOT await it here
            streamGroqChatApi(apiKey, model, messagesWithSystemPrompt) // Use the modified messages array
                 .catch(error => {
                      // Error handling for the stream initiation itself (rare)
                      console.error("Error initiating Groq Chat API stream:", error);
                      chrome.runtime.sendMessage({
                          action: 'chatError',
                          payload: { error: (error instanceof Error ? error.message : String(error)) || 'Failed to start AI stream.' }
                      }).catch(e => console.log("Popup not open or listening for initial stream error?"));
                      sendResponse({ success: false, error: 'Failed to start AI stream' }); // Inform original sender of initiation failure
                 });

            // Respond immediately to the original message sender to acknowledge receipt
            sendResponse({ success: true, message: 'Stream initiated' });

        }).catch(outerError => {
             // Handle error getting the API key itself
             console.error("Error retrieving API key before streaming:", outerError);
             chrome.runtime.sendMessage({ action: 'chatError', payload: { error: 'Failed to retrieve API key.' } })
                    .catch(e => console.log("Popup not open or listening for API key error?"));
             sendResponse({ success: false, error: 'Failed to retrieve API key.' });
        });

        // Return true because we WILL respond (immediately) or handle errors asynchronously
        return true;
    }

    // Message from Content Script for selected text
    else if (message.action === 'setSelectedText') {
        const selectedText = message.payload?.text;
        if (typeof selectedText === 'string') {
            console.log("[Background] Received selected text:", selectedText.substring(0, 100) + "..."); // Log snippet
            // Store the text in local storage, maybe under a specific key
            chrome.storage.local.set({ lastSelectedText: selectedText }).then(() => {
                 console.log("[Background] Stored selected text.");
                 // Attempt to open the popup window
                 chrome.action.openPopup({}, () => {
                     if (chrome.runtime.lastError) {
                         console.warn(`[Background] Could not open popup programmatically: ${chrome.runtime.lastError.message}. User might need to click the icon.`);
                         // Fallback: Send a message to popup in case it's already open to refresh state?
                         // chrome.runtime.sendMessage({ action: 'updatePopupState' }).catch(e => {});
                     } else {
                         console.log("[Background] Popup opened programmatically.");
                     }
                 });
                 sendResponse({ success: true });
            }).catch(error => {
                 console.error("[Background] Error storing selected text:", error);
                 sendResponse({ success: false, error: error.message });
            });
            isAsync = true; // Indicate async response
        } else {
            console.warn("[Background] Received invalid payload for setSelectedText:", message.payload);
            sendResponse({ success: false, error: 'Invalid payload' });
        }
    }

    // Messages from Offscreen Document
    else if (message.target === 'background') {
        switch (message.action) {
            case 'offscreenLogData': // <<< ADD Handler for the log data
                console.warn("--- Received Offscreen Logs ---");
                console.log(message.data); // Log the array of messages
                console.warn("-------------------------------");
                break;
            case 'audioDataFetched':
                console.log(`[Background] Received audioDataFetched for downloadId: ${message.downloadId}`);
                
                let audioBuffer: ArrayBuffer | null = null;
                const fetchedContentType = message.contentType; // <<< Get content type from message
                console.log(`[Background] Content-Type from offscreen: ${fetchedContentType}`);

                // Check if data is Base64 encoded
                if (message.isBase64 && typeof message.data === 'string') {
                    console.log("[Background] Received data is Base64 encoded. Decoding...");
                    try {
                        audioBuffer = base64ToArrayBuffer(message.data);
                        console.log(`[Background] Decoded Base64 to ArrayBuffer (byteLength: ${audioBuffer.byteLength})`);
                    } catch (e) {
                        console.error("[Background] Error decoding Base64 string:", e);
                        audioBuffer = null; // Ensure it's null on error
                    }
                } else {
                    // Fallback/Error - Should not happen with the new offscreen code
                    console.warn("[Background] Received audio data was NOT Base64 encoded string as expected.");
                     // --- Keep previous debug logging for unexpected cases ---
                     console.log(`[Background] Type of received message.data: ${typeof message.data}`);
                     console.log(`[Background] Is message.data an ArrayBuffer? ${message.data instanceof ArrayBuffer}`);
                     if (message.data instanceof ArrayBuffer) {
                         try {
                             console.log(`[Background] Received data byteLength: ${message.data.byteLength}`);
                         } catch (e) {
                             console.error("[Background] Error accessing byteLength:", e);
                         }
                     } else {
                         console.warn("[Background] Received message.data is NOT an ArrayBuffer. Data:", message.data);
                     }
                     // --- END DEBUG LOGGING ---
                }

                // Close offscreen AFTER data is received and before processing starts
                closeOffscreenDocument(); // <<< Will call the stub

                // Process only if we successfully got an ArrayBuffer
                if (audioBuffer) {
                    processAudioData(message.downloadId, audioBuffer, fetchedContentType); // Pass the decoded ArrayBuffer and fetchedContentType
                } else {
                    console.error("[Background] Cannot process audio data due to decoding failure or invalid data format.");
                    // Update state to show an error
                     chrome.storage.local.set({
                         transcriptionState: 'error',
                         transcriptionError: 'Internal error: Failed to decode/receive audio data correctly from fetch process.',
                         pendingDownload: null
                     }).then(() => {
                         chrome.runtime.sendMessage({ action: 'updatePopupState' }).catch(e => console.log("Popup not open?"));
                     });
                }
                break;
            case 'audioFetchError':
                console.error(`Error fetching audio from offscreen document for downloadId ${message.downloadId}:`, message.error);
                // Close offscreen on error
                const fetchErrorMessage = message.error || 'Failed to fetch audio via offscreen document';
                chrome.storage.local.set({
                    transcriptionState: 'error',
                    transcriptionError: fetchErrorMessage,
                    pendingDownload: null
                }).then(() => {
                    chrome.runtime.sendMessage({ action: 'updatePopupState' }).catch(e => console.log("Popup not open?"));
                });
                break;
            case 'clipboardDataResponse': // Handle response from offscreen clipboard read
                 console.log("Received clipboardDataResponse from offscreen");
                 processClipboardContent(message.data); // Process the received text
                 // Offscreen document is now closed within processClipboardContent only on success
                 break;
            case 'clipboardReadError': // Handle error from offscreen clipboard read
                console.error("Error reading clipboard from offscreen:", message.error);
                chrome.storage.local.set({
                    transcriptionState: 'error',
                    transcriptionError: message.error || 'Failed to read clipboard.'
                }).then(() => {
                    chrome.runtime.sendMessage({ action: 'updatePopupState' }).catch(e => console.log("Popup not open?"));
                });
                 break;
            default:
                 console.warn("Received unknown action from offscreen:", message.action);
        }
    }
    return isAsync; // Return true if we are handling the response asynchronously
});

// --- Main Transcription Request Handler ---

async function handleTranscriptionRequest(downloadId: number) {
    console.log(`Handling transcription request for download ID: ${downloadId}`);

    // <<< Open popup first
    chrome.action.openPopup({}, () => {
        if (chrome.runtime.lastError) {
            console.warn(`[Background] Could not open popup programmatically: ${chrome.runtime.lastError.message}. User might need to click the icon.`);
        } else {
            console.log("[Background] Popup opened programmatically for transcription request.");
        }
    });

    try {
        // 1. Get API Key
        const { groqApiKey } = await chrome.storage.local.get('groqApiKey');
        if (!groqApiKey) {
            throw new Error("Groq API key not set. Please set it in the extension options.");
        }

        // 2. Get pending download details (ensure it's the correct one)
        const { pendingDownload } = await chrome.storage.local.get('pendingDownload');
        if (!pendingDownload || pendingDownload.downloadId !== downloadId) {
            // This might happen if the user initiated another download or cleared state
            console.warn(`Transcription requested for ${downloadId}, but pending download is different or missing.`);
            throw new Error("Relevant download details not found. Please try downloading the file again.");
        }
        console.log("Found pending download details:", pendingDownload);

        // 3. Ensure Offscreen Document is ready
        await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);

        // 4. Update state to fetching
         await chrome.storage.local.set({ transcriptionState: 'fetching' });
         // Notify popup about the state change
         chrome.runtime.sendMessage({ action: 'updatePopupState' }).catch(e => console.log("Popup not open?"));

        // 5. Send message to Offscreen Document to fetch the data
        // Construct the file URL - IMPORTANT!
        // const fileUrl = `file://${pendingDownload.filename}`; // << Don't use file:// URL
        console.log(`Sending fetch request to offscreen for ORIGINAL URL: ${pendingDownload.url}`);
        await chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'fetch-audio-data',
            data: {
                url: pendingDownload.url, // <<< Send the original download URL
                downloadId: downloadId
            }
        });
        console.log("Fetch request sent to offscreen document.");

        // The rest of the process continues when the 'audioDataFetched' or 'audioFetchError' message is received

    } catch (error: any) {
        console.error(`Transcription failed during setup/fetch dispatch [DownloadID: ${downloadId}]:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown transcription error during setup';
        // Store error state and notify popup
        await chrome.storage.local.set({
            transcriptionState: 'error',
            transcriptionError: errorMessage,
            pendingDownload: null // Clear pending state
        });
        // Send 'updatePopupState' instead of 'transcriptionError' for consistency
        chrome.runtime.sendMessage({ action: 'updatePopupState' }).catch(e => console.log("Popup not open?"));
        // Ensure offscreen is closed if an error happens here
        // closeOffscreenDocument(); // <<< REMOVE THIS LINE
    }
}

// --- Groq API Call & Processing Logic ---

async function processAudioData(downloadId: number, audioData: ArrayBuffer, fetchedContentType?: string | null) {
    console.log(`Processing fetched audio data for downloadId ${downloadId} (${audioData.byteLength} bytes). Content-Type from fetch: ${fetchedContentType}`);

    let apiKey = '';
    let filename = 'audio_file'; // Default filename for Blob
    let mimeType: string | undefined = undefined; // Variable to hold the MIME type

    try {
        // Retrieve API key, filename, and MIME type
        const { groqApiKey, pendingDownload } = await chrome.storage.local.get(['groqApiKey', 'pendingDownload']);
        if (!groqApiKey) {
            throw new Error("Groq API key not found in storage.");
        }
        apiKey = groqApiKey;

        // Use original filename and MIME type if available
        if (pendingDownload && pendingDownload.downloadId === downloadId) {
            filename = pendingDownload.filename || filename; // Use original or default
            mimeType = pendingDownload.mime; // Get the MIME type from storage first
            console.log(`Retrieved filename: ${filename}, MIME type from storage: ${mimeType}`);
        } else {
             console.warn(`Could not retrieve original details for downloadId ${downloadId}. Using defaults.`);
             // Attempt to retrieve details matching the ID as a fallback
             const items = await chrome.downloads.search({id: downloadId});
             if (items.length > 0) {
                filename = items[0].filename || filename;
                mimeType = items[0].mime; // Try to get MIME type from download item
                 console.log(`Fallback retrieved filename: ${filename}, MIME type: ${mimeType}`);
             }
        }

        // <<< Prioritize fetchedContentType if available
        if (fetchedContentType && typeof fetchedContentType === 'string') {
            console.log(`Using Content-Type directly from fetch response: ${fetchedContentType}`);
            mimeType = fetchedContentType;
        }

        // Check file size BEFORE making the API call
        if (audioData.byteLength > MAX_FILE_SIZE_BYTES) {
            console.error(`File size (${audioData.byteLength} bytes) exceeds maximum limit (${MAX_FILE_SIZE_BYTES} bytes).`);
            throw new Error(`Audio file is too large (${(audioData.byteLength / (1024*1024)).toFixed(2)} MB). Maximum size is 40 MB. File splitting is not yet implemented.`);
        }

        // TODO: Implement splitting logic here if needed in the future

        // Update state: Transcribing
        await chrome.storage.local.set({ transcriptionState: 'transcribing' });
        chrome.runtime.sendMessage({ action: 'updatePopupState' }).catch(e => console.log("Popup not open?"));

        // Attempt to determine MIME type if missing
        if (!mimeType && filename) {
            console.warn(`MIME type for downloadId ${downloadId} is missing. Attempting inference from filename: ${filename}`);
            const extension = filename.substring(filename.lastIndexOf('.')).toLowerCase();
            const inferredMimeType = EXT_TO_MIME_TYPE[extension];
            if (inferredMimeType) {
                console.log(`Inferred MIME type: ${inferredMimeType}`);
                mimeType = inferredMimeType;
            } else {
                console.warn(`Could not infer MIME type from extension: ${extension}`);
            }
        }

        // Final check for a valid, supported MIME type before API call
        if (!mimeType || !SUPPORTED_MIME_TYPES.includes(mimeType)) {
            const errorMsg = `Could not determine a supported audio MIME type for the file. Detected/inferred type: ${mimeType || 'none'}. Filename: ${filename || 'unknown'}`;
            console.error(errorMsg);
            throw new Error(errorMsg);
        }

        // Convert ArrayBuffer to Blob - Use the determined & validated MIME type
        console.log(`Creating Blob with explicitly set MIME type: ${mimeType}`);
        const audioBlob = new Blob([audioData], { type: mimeType }); // Use the validated type

        // Prepare FormData
        const formData = new FormData();

        // --- Construct filename with correct extension for API --- <<< MODIFIED
        let filenameForApi = 'audio_file'; // Default
        const expectedExtension = MIME_TO_EXT_TYPE[mimeType];
        if (expectedExtension) {
            // Use a generic name + correct extension
            filenameForApi = `api_upload${expectedExtension}`;
            console.log(`Using filename for API based on MIME type: ${filenameForApi}`);
        } else {
            // Fallback: use original filename if it exists, otherwise the default
            filenameForApi = filename ? filename.substring(filename.lastIndexOf('/') + 1).substring(filename.lastIndexOf('\\') + 1) : 'audio_file.bin';
            console.warn(`Could not map MIME type '${mimeType}' to extension. Using filename: ${filenameForApi}`);
        }
        // --- END MODIFICATION ---

        // formData.append('file', audioBlob, baseFilename); // Use the extracted base filename << OLD
        formData.append('file', audioBlob, filenameForApi); // <<< Use filename with extension
        formData.append('model', 'whisper-large-v3-turbo'); // Revert to turbo model as per user example
        // Add other parameters like language if needed
        // formData.append('language', 'en');
        formData.append('response_format', 'verbose_json'); // Change to verbose_json as per user example

        console.log("Calling Groq API with model whisper-large-v3-turbo and verbose_json...");
        const startTime = Date.now();

        // Make the API call
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                // 'Content-Type': 'multipart/form-data' is set automatically by fetch when using FormData
            },
            body: formData
        });

        const endTime = Date.now();
        console.log(`Groq API call finished in ${endTime - startTime}ms. Status: ${response.status}`);

        // Check response status
        if (!response.ok) {
            let errorBody = 'Unknown API error';
            try {
                // Try to parse error details from the API response
                const errorJson = await response.json();
                errorBody = errorJson?.error?.message || JSON.stringify(errorJson);
            } catch (e) {
                errorBody = await response.text(); // Fallback to text body
            }
            throw new Error(`Groq API error: ${response.status} ${response.statusText}. Details: ${errorBody}`);
        }

        // Parse the successful JSON response (verbose_json might have more data, but .text should still exist)
        const result = await response.json();
        const transcription = result?.text; // Assume .text is still the primary field

        if (typeof transcription !== 'string') {
             console.error("Groq API verbose_json response missing text field:", result);
             throw new Error("Groq API response did not contain valid transcription text.");
        }

        console.log("Transcription successful.");
        // Store result, clear pending state, notify popup
        await chrome.storage.local.set({
            transcriptionState: 'complete',
            transcriptionResult: transcription,
            transcriptionError: null,
            pendingDownload: null // Clear pending state as it's processed
        });
        chrome.runtime.sendMessage({ action: 'transcriptionComplete', transcription: transcription }).catch(e => console.log("Popup not open?"));

    } catch (error: any) {
        console.error("Error during audio processing or API call:", error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error during transcription processing';
        // Store error state, clear pending state, notify popup
        await chrome.storage.local.set({
            transcriptionState: 'error',
            transcriptionError: errorMessage,
            transcriptionResult: null,
            pendingDownload: null // Also clear pending state on error
        });
        chrome.runtime.sendMessage({ action: 'updatePopupState' }).catch(e => console.log("Popup not open?"));
    }
}

console.log("Background script listeners attached.");

// --- Context Menu Setup ---

const CONTEXT_MENU_ID = "transcribeAudio"; // Renamed for clarity

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: "Transcribe Audio", // Updated title
        contexts: ["link", "audio", "video", "page", "selection"] // Keep contexts broad, but prioritize link/audio/video
    });
    console.log("Context menu created/updated.");
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === CONTEXT_MENU_ID) {
        const directUrl = info.linkUrl || info.srcUrl; // Check for direct link or media source URL

        if (directUrl) {
            console.log(`'Transcribe Audio' context menu clicked. Direct URL found: ${directUrl}`);
            // Validate URL basic structure before proceeding (simple check)
            try {
                new URL(directUrl); // Throws if invalid
                handleTranscribeFromUrl(directUrl); // Use the new function for direct URLs
            } catch (e) {
                console.error(`Invalid URL detected from context menu: ${directUrl}`, e);
                 chrome.storage.local.set({ transcriptionState: 'error', transcriptionError: `Invalid URL provided: ${directUrl}` }).then(() => {
                    chrome.runtime.sendMessage({ action: 'updatePopupState' }).catch(e => console.log("Popup not open?"));
                });
            }
        } else {
            console.log("'Transcribe Audio' context menu clicked. No direct URL found, attempting clipboard read.");
            initiateClipboardReadForTranscription(); // Fallback to clipboard reading
        }
    }
});

// --- Shared Helper for URL Processing ---

// Extracts filename from URL path
function getFilenameFromUrl(url: string): string {
    try {
        const parsedUrl = new URL(url);
        const pathname = parsedUrl.pathname;
        const parts = pathname.split('/');
        const lastPart = parts[parts.length - 1];
        // Basic decode and fallback
        return lastPart ? decodeURIComponent(lastPart) : `audio_${Date.now()}.unknown`;
    } catch (e) {
        console.warn(`Could not parse filename from URL: ${url}`, e);
        return `audio_${Date.now()}.unknown`;
    }
}

// Prepares storage for a URL-based transcription
async function preparePendingUrlDownload(url: string, source: 'direct' | 'clipboard'): Promise<number> {
     console.log(`Preparing pending download for URL from ${source}: ${url}`);
     const filename = getFilenameFromUrl(url);
     const downloadId = Date.now(); // Use timestamp as a temporary unique ID for URLs

     try {
         await chrome.storage.local.set({
             pendingDownload: {
                 downloadId: downloadId,
                 filename: filename,
                 url: url,
                 fileSize: null, // Size unknown until fetched
                 mime: null, // Mime unknown until fetched/inferred
                 isUrlSource: true // Flag indicating this came from a URL
             },
             transcriptionState: 'pending_user_action', // Ready for user confirmation
             transcriptionResult: null,
             transcriptionError: null
         });
         console.log(`Stored pending URL download (ID: ${downloadId}) for: ${filename}`);
         chrome.runtime.sendMessage({ action: 'updatePopupState' }).catch(e => console.log("Popup not open or listening?"));

         // Close offscreen only if initiated via clipboard and successful here
         // (Direct URL clicks don't use offscreen at this stage)
         if (source === 'clipboard') {
             console.log("URL processing via clipboard successful, closing offscreen document.")
             await closeOffscreenDocument(); // Close after successful clipboard processing
         }

         return downloadId; // <<< Return the ID

     } catch (error) {
        console.error(`Error setting up storage for URL transcription (${source}):`, error);
        const errorMessage = error instanceof Error ? error.message : 'Error preparing URL for transcription.';
        await chrome.storage.local.set({ transcriptionState: 'error', transcriptionError: errorMessage });
        chrome.runtime.sendMessage({ action: 'updatePopupState' }).catch(e => console.log("Popup not open?"));
        // Do not close offscreen here on error during clipboard flow, let other error handlers manage it
        throw error; // <<< Re-throw error so callers know it failed
     }
}


// --- Clipboard & URL Handling Logic ---

// Renamed from handleTranscribeFromClipboard
async function initiateClipboardReadForTranscription() {
    console.log("Initiating transcription via clipboard read...");
    try {
        // 1. Ensure Offscreen Document is ready
        await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);

        // 2. Send message to Offscreen Document to read the clipboard
        console.log("Sending read-clipboard request to offscreen document.");
        // Reset state before asking offscreen doc, in case user clicks multiple times
        await chrome.storage.local.remove(['pendingDownload', 'transcriptionState', 'transcriptionResult', 'transcriptionError']);
        await chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'read-clipboard'
        });
        // Response handled by 'clipboardDataResponse'/'clipboardReadError' messages

    } catch (error: any) {
        console.error("Error initiating clipboard read via offscreen:", error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to initiate clipboard reading.';
        await chrome.storage.local.set({ transcriptionState: 'error', transcriptionError: errorMessage });
        chrome.runtime.sendMessage({ action: 'updatePopupState' }).catch(e => console.log("Popup not open?"));
        // Don't close offscreen here, might not be open or might be needed by another process
    }
}

// New function to handle transcription directly from a context menu URL click
async function handleTranscribeFromUrl(url: string) {
    console.log(`Handling direct transcription request for URL: ${url}`);
    try {
        // Prepare storage and get the temporary ID
        const downloadId = await preparePendingUrlDownload(url, 'direct');
        // Directly start the transcription process
        console.log(`Immediately starting transcription for direct URL, ID: ${downloadId}`);
        await handleTranscriptionRequest(downloadId);
    } catch (error) {
        // Errors during preparePendingUrlDownload are logged and stored within that function
        console.error(`Error setting up or starting transcription from direct URL ${url}:`, error);
        // No need to repeat error setting here as preparePendingUrlDownload handles it.
    }
}


async function processClipboardContent(clipboardText: string | null) {
     if (!clipboardText) {
        console.log("Clipboard is empty or could not be read.");
        // Optionally notify the user
         // closeOffscreenDocument(); // <<< REMOVE: Don't close here, wait for dismiss
        return;
    }

    console.log("Received clipboard content from offscreen:", clipboardText);

    // Basic URL validation
    let url: URL;
    try {
        url = new URL(clipboardText.trim());
        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error("Invalid protocol");
        }
    } catch (e) {
        console.log("Clipboard text is not a valid HTTP/HTTPS URL:", clipboardText);
        // Optionally notify the user
        // closeOffscreenDocument(); // <<< REMOVE: Don't close here, wait for dismiss
        return;
    }

    console.log("Valid URL found in clipboard:", url.href);

    // --- Start transcription process ---
    try { // <<< Add try block here
         console.log("Valid URL format detected in clipboard. Preparing storage and starting transcription...");
         const downloadId = await preparePendingUrlDownload(url.href, 'clipboard');
         console.log(`Immediately starting transcription for clipboard URL, ID: ${downloadId}`);
         await handleTranscriptionRequest(downloadId);
         // Success: offscreen document closed inside preparePendingUrlDownload

    } catch (error: any) { // <<< Keep the existing catch block
        console.error("Error during URL validation or transcription initiation from clipboard:", error);
        // Check if the error originated from preparePendingUrlDownload, which already sets state
        if (!(error instanceof Error && error.message.includes('Error preparing URL'))) {
             // If error is from handleTranscriptionRequest or elsewhere, set error state
             const errorMessage = error instanceof Error ? error.message : 'Error starting transcription from clipboard URL.';
             await chrome.storage.local.set({ transcriptionState: 'error', transcriptionError: errorMessage });
             chrome.runtime.sendMessage({ action: 'updatePopupState' }).catch(e => console.log("Popup not open?"));
        }
        // Do not close offscreen here; it should only be closed on success in preparePendingUrlDownload for clipboard flow
    }
} 