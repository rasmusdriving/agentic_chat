# Technical Documentation - Audio Transcriber & AI Assistant

This document provides a deeper dive into the technical architecture, data flow, and component responsibilities of the Groq Powered Chrome Extension.

## 1. Architecture Overview

The extension follows a standard Chrome Extension Manifest V3 architecture, utilizing several key components:

*   **Popup (`src/popup/`)**: The main user interface, presented when the extension icon is clicked. It handles user input for chat, displays conversation history, manages image uploads for vision models, and presents transcription controls/results. It communicates primarily with the Background Service Worker.
*   **Background Service Worker (`src/background.ts`)**: An event-driven script that runs independently of any specific tab or popup window. It acts as the central hub for:
    *   Listening to browser events (e.g., `chrome.downloads.onChanged`, `chrome.contextMenus.onClicked`).
    *   Handling communication with the Groq API (both chat completions and transcription).
    *   Managing the Offscreen Document lifecycle.
    *   Routing messages between the Popup, Content Script, and Offscreen Document.
    *   Processing transcription requests initiated via downloads, context menu clicks (direct URL), or context menu clicks (clipboard fallback).
*   **Options Page (`src/options/`)**: A persistent page accessible via extension settings or right-clicking the icon. Its primary role is to allow the user to securely input and save their Groq API key to `chrome.storage.local`.
*   **Offscreen Document (`src/offscreen/`)**: A minimal, hidden HTML page used to perform tasks requiring DOM APIs not available to Service Workers. In this extension, its purpose is to:
    *   Fetch the content of an audio file using its **original source URL** (passed by the background script) using the `fetch` API. It retrieves both the audio data (`ArrayBuffer`) and the `Content-Type` header.
    *   Read data from the clipboard when requested (using `navigator.clipboard.readText`).
    It communicates results (audio data + content type, clipboard text) or errors back to the Background Service Worker.
*   **Content Scripts (`src/content_script.ts` & associated CSS)**: Injected into web pages (`<all_urls>`). Its primary role is to:
    *   Listen for text selection events (or other triggers if added later).
    *   Send the selected text content to the background script using `chrome.runtime.sendMessage` (action: `setSelectedText`).
    *   Apply basic styling via `content_script.css` if needed.

## 2. Key Components and Responsibilities

*   **`manifest.json`**: Defines permissions (`downloads`, `storage`, `offscreen`, `scripting`, `contextMenus`, `clipboardRead`), host permissions (`<all_urls>`, specific domains if needed), background service worker registration, UI pages (`popup`, `options`), icons, and Content Security Policy (CSP).
*   **`src/background.ts`**: 
    *   Manages all interactions with the Groq API (`streamGroqChatApi` for chat, Groq transcription API calls using `whisper-large-v3-turbo` within `processAudioData`).
    *   Listens for download completion events (`chrome.downloads.onChanged`) and stores relevant metadata (`pendingDownload`).
    *   Listens for context menu clicks (`chrome.contextMenus.onClicked`):
        *   Checks for `info.linkUrl` or `info.srcUrl`.
        *   If found, calls `handleTranscribeFromUrl` to initiate direct transcription.
        *   If not found, calls `initiateClipboardReadForTranscription` as a fallback.
    *   Handles message routing (`chrome.runtime.onMessage`) from Popup, Content Script, and Offscreen.
    *   Manages the creation (`setupOffscreenDocument`) and potential closing (`closeOffscreenDocument`) of the offscreen document.
    *   Initiates transcription requests (`handleTranscriptionRequest`) which opens the popup, updates state, and triggers the offscreen document to fetch audio.
    *   Processes fetched audio data (`processAudioData`), determines MIME type (prioritizing `contentType` from offscreen), constructs filename with extension, and sends data to the Groq transcription endpoint.
    *   Handles selected text received from the content script (`setSelectedText`), storing it and attempting to open the popup.
    *   Updates shared state in `chrome.storage.local` (e.g., `transcriptionState`, `transcriptionResult`, `transcriptionError`, `lastSelectedText`).
*   **`src/popup/popup.ts`**:
    *   Initializes the UI state based on data loaded from `chrome.storage.local` (`loadApiKeyStatus`, `loadSelectedModel`, `loadChatHistory`, `loadTranscriptionState`).
    *   Handles user input (text, image drop, button clicks).
    *   Displays appropriate UI for transcription state (`requestDiv`, `loadingDiv`, `resultDiv`, `errorDiv`).
    *   Renders the chat history (`renderChatHistory`).
    *   Manages the streaming display of AI responses (`createAiMessagePlaceholder`, `appendToCurrentAiMessage`, `finalizeAiMessage`).
    *   Sends user messages and transcription action requests to the background script.
    *   Listens for messages from the background script (`addAiChatChunk`, `endAiChatStream`, `chatError`, `updatePopupState`, etc.) and updates the UI accordingly.
    *   Saves chat history and selected model to `chrome.storage.local`.
    *   Potentially loads `lastSelectedText` from storage to pre-fill chat input when opened after text selection.
*   **`src/options/options.ts`**:
    *   Provides UI for entering the Groq API key.
    *   Saves the key to `chrome.storage.local` upon user confirmation.
    *   Loads and displays the currently saved key (if any) on initialization.
*   **`src/offscreen/offscreen.ts`**:
    *   Listens for messages specifically targeted at it from the background script (`fetch-audio-data`, `read-clipboard`).
    *   Handles `fetch-audio-data` requests: Uses the `fetch` API to get the audio file content (as an ArrayBuffer) and the `Content-Type` header from its **source URL**.
    *   Handles `read-clipboard` requests: Uses `navigator.clipboard.readText()`.
    *   Sends results (Base64 audio data + content type, clipboard text) or errors back to the background script.
*   **`src/content_script.ts`**:
    *   Adds event listeners (e.g., `mouseup`) to detect when the user finishes selecting text.
    *   Retrieves the selected text using `window.getSelection()`.
    *   Sends the selected text to the background script via `chrome.runtime.sendMessage({ action: 'setSelectedText', payload: { text: selectedText } })`.

## 3. Data Flow Examples

**A. Sending a Chat Message:**

1.  **Popup**: User types message -> `popup.ts` captures input.
2.  **Popup**: `addUserMessageToChat` adds message to local `chatHistory` & saves to `chrome.storage.local`.
3.  **Popup**: `renderChatHistory` updates the UI to show the user message.
4.  **Popup**: `createAiMessagePlaceholder` adds "..." to the UI.
5.  **Popup**: Sends `sendChatMessage` message (with model and full `chatHistory`) to Background via `chrome.runtime.sendMessage`.
6.  **Background**: `background.ts` listener receives message.
7.  **Background**: Calls `streamGroqChatApi` with API key, model, and history.
8.  **Background**: `streamGroqChatApi` makes `fetch` request to Groq API (`stream: true`).
9.  **Background**: `streamGroqChatApi` processes the response stream.
10. **Background**: For each text chunk -> Sends `addAiChatChunk` message (with chunk) to Popup.
11. **Popup**: Listener receives `addAiChatChunk` -> `appendToCurrentAiMessage` updates the placeholder UI.
12. **Background**: When stream ends -> Sends `endAiChatStream` message (with full response text) to Popup.
13. **Popup**: Listener receives `endAiChatStream` -> `finalizeAiMessage` updates placeholder with full text, adds full response to `chatHistory`, saves history to `chrome.storage.local`, re-enables input.

**B. Transcribing a Downloaded File:**

1.  **Browser**: User downloads audio file.
2.  **Background**: `chrome.downloads.onChanged` listener detects completion.
3.  **Background**: Checks MIME type/extension -> If supported, stores `pendingDownload` info and `transcriptionState: 'pending_user_action'` in `chrome.storage.local`.
4.  **Background**: Sends `updatePopupState` message to Popup.
5.  **Popup**: Listener receives `updatePopupState` -> Calls `loadTranscriptionState`.
6.  **Popup**: `loadTranscriptionState` reads `pendingDownload` from storage -> Shows transcription request UI.
7.  **Popup**: User clicks "Yes" -> Sends `startTranscription` message (with downloadId) to Background.
8.  **Background**: Listener receives `startTranscription` -> Sets `transcriptionState: 'loading'` -> Calls `handleTranscriptionRequest`.
9.  **Background**: `handleTranscriptionRequest` -> Calls `setupOffscreenDocument`.
10. **Background**: Sends message to Offscreen document requesting audio fetch using the download URL.
11. **Offscreen**: `offscreen.ts` listener receives message -> `fetch`es the audio URL -> Converts to Base64.
12. **Offscreen**: Sends message (`audioDataFetched` with Base64 data or `audioFetchError`) back to Background.
13. **Background**: Listener receives message -> Calls `processAudioData` (if successful).
14. **Background**: `processAudioData` sends Base64 data to Groq transcription API.
15. **Background**: Receives transcription result -> Stores transcript in `transcriptionResult`, sets `transcriptionState: 'complete'` in `chrome.storage.local`.
16. **Background**: Sends `updatePopupState` message to Popup.
17. **Popup**: Listener receives `updatePopupState` -> Calls `loadTranscriptionState`.
18. **Popup**: `loadTranscriptionState` reads `transcriptionResult` from storage -> Displays transcript and action buttons.

**C. Transcribing via Context Menu (Direct URL):**

1.  **User**: Right-clicks on an audio link/element -> Selects "Transcribe Audio".
2.  **Background**: `chrome.contextMenus.onClicked` listener receives event with `info.linkUrl` or `info.srcUrl`.
3.  **Background**: Calls `handleTranscribeFromUrl` with the direct URL.
4.  **Background**: `handleTranscribeFromUrl` calls `preparePendingUrlDownload`.
5.  **Background**: `preparePendingUrlDownload` stores initial `pendingDownload` state (with URL, generated filename, temporary ID, `isUrlSource: true`) and `transcriptionState: 'pending_user_action'` in `chrome.storage.local`. Returns the temporary ID.
6.  **Background**: `handleTranscribeFromUrl` immediately calls `handleTranscriptionRequest` with the temporary ID.
7.  **Background**: `handleTranscriptionRequest` opens the popup (`chrome.action.openPopup`).
8.  **Background**: `handleTranscriptionRequest` finds the `pendingDownload` details, sets `transcriptionState: 'fetching'`, calls `setupOffscreenDocument`.
9.  **Background**: Sends `fetch-audio-data` message to Offscreen with the audio URL and temporary ID.
10. **Offscreen**: Listener receives `fetch-audio-data` -> `fetch`es the audio URL -> Gets `ArrayBuffer` and `Content-Type`.
11. **Offscreen**: Sends `audioDataFetched` message (with Base64 data and content type) back to Background.
12. **Background**: Listener receives `audioDataFetched` -> Calls `processAudioData`.
13. **Background**: `processAudioData` decodes data, determines final MIME type (prioritizing fetched content type), generates `filenameForApi` with correct extension, sets `transcriptionState: 'transcribing'`, calls Groq API.
14. **Background**: Receives transcription result -> Stores transcript in `transcriptionResult`, sets `transcriptionState: 'complete'`, clears `pendingDownload`.
15. **Background**: Sends `updatePopupState` message to Popup.
16. **Popup**: Listener receives `updatePopupState` -> Calls `loadTranscriptionState`.
17. **Popup**: `loadTranscriptionState` reads `transcriptionResult` -> Displays transcript.

**D. Transcribing via Context Menu (Clipboard Fallback):**

1.  **User**: Copies an audio URL -> Right-clicks elsewhere on a page -> Selects "Transcribe Audio".
2.  **Background**: `chrome.contextMenus.onClicked` listener receives event, but `info.linkUrl`/`info.srcUrl` are null.
3.  **Background**: Calls `initiateClipboardReadForTranscription`.
4.  **Background**: `initiateClipboardReadForTranscription` calls `setupOffscreenDocument`, clears previous state, sends `read-clipboard` message to Offscreen.
5.  **Offscreen**: Listener receives `read-clipboard` -> Calls `navigator.clipboard.readText()`.
6.  **Offscreen**: Sends `clipboardDataResponse` (with text) or `clipboardReadError` back to Background.
7.  **Background**: Listener receives `clipboardDataResponse` -> Calls `processClipboardContent`.
8.  **Background**: `processClipboardContent` validates the text is a URL -> Calls `preparePendingUrlDownload` (source: 'clipboard').
9.  **Background**: `preparePendingUrlDownload` stores initial `pendingDownload` state, sets `transcriptionState: 'pending_user_action'`, closes the Offscreen document (as clipboard read is done), returns temporary ID.
10. **Background**: `processClipboardContent` immediately calls `handleTranscriptionRequest` with the temporary ID.
11. **Background**: `handleTranscriptionRequest` opens popup, sets state to 'fetching', sends message to Offscreen (a *new* instance will be created if needed) to fetch audio via URL.
12. **(Steps 10-17 from flow C repeat):** Offscreen fetches -> Background processes -> Popup updates.

## 4. State Management

State is primarily managed using `chrome.storage.local`. This allows data persistence across popup openings and background script restarts.

*   **`groqApiKey`**: Stores the user's API key (set via Options page).
*   **`selectedGroqModel`**: Stores the ID of the chat model currently selected in the popup.
*   **`chatHistory`**: Stores an array of chat message objects (`{ role: 'user'|'assistant', content: any }`).
*   **`pendingDownload`**: Temporarily stores details of a detected audio download OR a URL-based request awaiting processing (`{ downloadId, filename, url, fileSize, mime, isUrlSource? }`).
*   **`transcriptionState`**: Tracks the current status of a transcription task (`'pending_user_action'`, `'loading'` (for downloads only), `'fetching'`, `'transcribing'`, `'complete'`, `'error'`).
*   **`transcriptionResult`**: Stores the successful transcription text.
*   **`transcriptionError`**: Stores error messages related to transcription.
*   **`lastSelectedText`**: Stores the most recent text selected by the user on a webpage (sent from the content script).

Components (Popup, Background) load relevant state from storage on initialization or when notified of changes (via `updatePopupState` messages) and save updates back to storage.

## 5. Error Handling

*   **API Errors (Chat/Transcription)**: `fetch` calls in `background.ts` include `.catch()` blocks. Errors are logged, and specific error messages (`chatError`, `transcriptionError`) are sent to the popup for display. The popup's `chatError` handler updates the UI, potentially modifying the AI message placeholder.
*   **Storage Errors**: `try...catch` blocks are used around `chrome.storage` calls, though errors here are less common. Failures might involve logging or defaulting to an empty state.
*   **Offscreen Document Errors**: Fetching audio (from URL) or reading the clipboard in the offscreen document can fail. `offscreen.ts` catches these errors and sends specific error messages back to the background script, which then updates the `transcriptionState`/`transcriptionError` in storage and notifies the popup.
*   **Content Script Errors**: Errors related to accessing `window.getSelection()` or sending messages might occur, typically logged to the content script's console.
*   **UI Errors**: Standard JavaScript error handling within the popup/options scripts.

Error messages shown to the user aim to be informative, often suggesting checking the API key or trying the action again. 