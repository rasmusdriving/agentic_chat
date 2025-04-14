import './popup.css'; // Import the CSS file
import { marked } from 'marked'; // Import marked library

// Popup script logic

// Constants
const SELECTED_MODEL_KEY = 'selectedGroqModel';
const CHAT_HISTORY_KEY = 'chatHistory'; // Key for storing chat history
const DEFAULT_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const VISION_MODEL_ID = 'llama-3.2-90b-vision-preview';
const MAX_IMAGE_SIZE_MB = 10;

// --- UI Elements ---
const headerDiv = document.getElementById('header')!;
const chatContainerDiv = document.getElementById('chat-container')!; // Used for scrolling
const chatMessagesDiv = document.getElementById('chat-messages')!; // Append messages here
const inputAreaDiv = document.getElementById('input-area')!; // Used as drop zone
const imagePreviewAreaDiv = document.getElementById('image-preview-area')!;
const imagePreviewEl = document.getElementById('image-preview')! as HTMLImageElement;
const removeImageButton = document.getElementById('remove-image-button')! as HTMLButtonElement;
const chatInputEl = document.getElementById('chat-input')! as HTMLTextAreaElement;
const sendButton = document.getElementById('send-button')! as HTMLButtonElement;
const statusMessagesDiv = document.getElementById('status-messages')!;
const modelSelectEl = document.getElementById('model-select')! as HTMLSelectElement; // Definition for model select
const initialMessageDiv = document.getElementById('initial-message')!;
const errorDiv = document.getElementById('error-message')!;
const noKeyDiv = document.getElementById('no-key-message')!;
const transcriptionNotificationDiv = document.getElementById('transcription-notification')!;
const attachTranscriptionBtn = document.getElementById('attach-transcription-btn')! as HTMLButtonElement;
const copyTranscriptionBtn = document.getElementById('copy-transcription-btn')! as HTMLButtonElement;
const dismissTranscriptionBtn = document.getElementById('dismiss-transcription-btn')! as HTMLButtonElement;
const transcriptionLoadingNotificationDiv = document.getElementById('transcription-loading-notification')!;

// State variables
let currentDownloadId: number | null = null;
let currentSelectedModel: string = DEFAULT_MODEL;
let chatHistory: { role: 'user' | 'assistant', content: any, contextUsed?: boolean }[] = [];
let attachedImageDataUrl: string | null = null;
let currentSelectedTextContext: string | null = null;
let currentTranscription: string | null = null;
let transcriptionNotificationDismissed = false;
let transcriptionContextPending = false;

// --- Helper Functions ---

function showElement(element: HTMLElement) {
    element.style.display = 'block';
}

function showFlexElement(element: HTMLElement) {
    element.style.display = 'flex';
}

function hideElement(element: HTMLElement) {
    element.style.display = 'none';
}

function hideStatusMessages() {
    hideElement(initialMessageDiv);
    hideElement(errorDiv);
    hideElement(noKeyDiv);
}

function hideTranscriptionElements() {
    // hideElement(loadingDiv); // Removed - Element does not exist
}

function addMessageToChat(role: 'user' | 'assistant', content: any) {
    // This function now ONLY adds to history, saves, and renders.
    // It should NOT be called directly for streaming updates.
    chatHistory.push({ role, content });
    saveChatHistory(); // Save history after adding a message
    renderChatHistory(); // Re-render the entire history
}

function adjustUIForModel(modelId: string) {
    if (modelId === VISION_MODEL_ID) {
        chatInputEl.placeholder = `Type message or drop image for ${VISION_MODEL_ID}...`;
    } else {
        chatInputEl.placeholder = "Type your message...";
        if (attachedImageDataUrl) {
            console.log("Clearing attached image as model switched away from vision.");
            attachedImageDataUrl = null;
            imagePreviewEl.src = '';
            hideElement(imagePreviewAreaDiv);
        }
    }
}

// --- Initialization Logic (Define before use) ---

async function loadApiKeyStatus(): Promise<boolean> {
    try {
        const keyResult = await chrome.storage.local.get('groqApiKey');
        if (!keyResult.groqApiKey) {
            hideStatusMessages();
            showElement(noKeyDiv);
            return false;
        }
        return true;
    } catch (error) {
        console.error("Error checking API key:", error);
        hideStatusMessages();
        showElement(errorDiv);
        return false;
    }
}

async function loadSelectedModel(): Promise<void> {
    try {
        const result = await chrome.storage.local.get(SELECTED_MODEL_KEY);
        const savedModel = result[SELECTED_MODEL_KEY];
        if (savedModel && modelSelectEl.querySelector(`option[value="${savedModel}"]`)) {
            modelSelectEl.value = savedModel;
            currentSelectedModel = savedModel;
        } else {
            modelSelectEl.value = DEFAULT_MODEL;
            currentSelectedModel = DEFAULT_MODEL;
            await chrome.storage.local.set({ [SELECTED_MODEL_KEY]: DEFAULT_MODEL });
        }
        console.log(`Loaded model: ${currentSelectedModel}`);
        adjustUIForModel(currentSelectedModel);
    } catch (error) {
        console.error("Error loading selected model:", error);
        modelSelectEl.value = DEFAULT_MODEL;
        currentSelectedModel = DEFAULT_MODEL;
        adjustUIForModel(DEFAULT_MODEL);
    }
}

async function loadTranscriptionState(): Promise<void> {
    hideTranscriptionNotification();
    hideTranscriptionLoadingNotification();

    let errorIsVisible = errorDiv.style.display !== 'none';
    let noKeyIsVisible = noKeyDiv.style.display !== 'none';

    // Always enable chat input and send button unless actively loading transcription
    sendButton.disabled = false;
    chatInputEl.disabled = false;

    try {
        const result = await chrome.storage.local.get(['pendingDownload', 'transcriptionResult', 'transcriptionState', 'transcriptionError']);

        if (result.transcriptionState === 'loading') {
            showTranscriptionLoadingNotification();
            // Disable chat while loading transcription
            sendButton.disabled = true;
            chatInputEl.disabled = true;
        } else if (result.transcriptionResult) {
            // Show notification bar instead of large module
            if (!transcriptionNotificationDismissed) {
                showTranscriptionNotification(result.transcriptionResult);
            }
            // Chat should be enabled
            sendButton.disabled = false;
            chatInputEl.disabled = false;
        } else if (result.transcriptionError) {
             hideStatusMessages();
             showElement(errorDiv);
             errorIsVisible = true;
        }
    } catch (error) {
        console.error('Error loading transcription state:', error);
         // Optionally show a generic error if loading state fails
         hideStatusMessages();
         showElement(errorDiv);
         errorIsVisible = true; // Make sure this flag is set on catch
    }
}

// Helper function to save chat history
async function saveChatHistory() {
    try {
        await chrome.storage.local.set({ [CHAT_HISTORY_KEY]: chatHistory });
        console.log("Chat history saved.");
    } catch (error) {
        console.error("Error saving chat history:", error);
        // Optionally show an error to the user
    }
}

// Function to render chat history from the loaded array
function renderChatHistory() {
    chatMessagesDiv.innerHTML = ''; // Clear existing messages first
    console.log(">>> Rendering chat history. Current history:", JSON.stringify(chatHistory));
    chatHistory.forEach(message => {
        // console.log(">>> Rendering message:", message); // Reduce console noise
        // Check if the message object has the contextUsed flag (for user messages)
        const contextUsed = (message as any).contextUsed === true;
        const messageDiv = createMessageElement(message.role, message.content, contextUsed); // Pass flag
        chatMessagesDiv.appendChild(messageDiv);
    });
    scrollToBottom(); // Scroll to bottom after rendering history
}

// Helper function to create a message element (used by render and streaming)
function createMessageElement(role: 'user' | 'assistant', content: any, contextUsed: boolean = false): HTMLDivElement {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', role === 'user' ? 'user-message' : 'ai-message');
    if (contextUsed && role === 'user') {
         messageDiv.classList.add('with-context'); // Add a class for styling user messages with context
    }

    let isError = false;
    let imageIndicator = ''; // Only for user messages with images
    let textContent = '';

    if (role === 'assistant') {
        if (typeof content === 'string') {
             if (content === '...') {
                 messageDiv.textContent = content; // Keep placeholder as text
             } else {
                 try {
                     // Parse valid markdown content
                     messageDiv.innerHTML = marked.parse(content) as string;
                 } catch (e) {
                     console.error("Markdown parsing error:", e);
                     messageDiv.textContent = content; // Fallback to text on error
                 }
             }
        } else if (typeof content === 'object' && content !== null && content.error) {
            // Handle error objects
            messageDiv.textContent = `Error: ${content.error}`;
            isError = true;
        } else {
            // Handle unexpected AI content types
            console.warn("createMessageElement received unexpected AI content:", content);
            messageDiv.textContent = "[Unsupported AI message content]";
        }
        textContent = (typeof content === 'string') ? content : '';
    } else { // role === 'user'
        if (typeof content === 'string') {
            textContent = content;
        } else if (Array.isArray(content)) {
            const textPart = content.find(part => part.type === 'text');
            textContent = textPart?.text || '';
            const imagePart = content.find(part => part.type === 'image_url');
            if (imagePart) {
                imageIndicator = ' [Image]'; // Append indicator
            }
        } else if (typeof content === 'object' && content !== null && content.error) {
            // This case might not be expected for user messages, but handle defensively
            textContent = `Error: ${content.error}`;
            isError = true;
        } else {
            console.warn("createMessageElement received unexpected user content type:", content);
            textContent = "[Unsupported message content]";
        }
        messageDiv.textContent = textContent + imageIndicator; // Set text for user message
    }

    // Apply error styling if needed
    if (isError) {
        messageDiv.style.color = '#f44336';
        // Ensure consistent styling for errors regardless of original role class
        messageDiv.classList.remove('user-message', 'ai-message');
        messageDiv.classList.add('error-message-chat');
    }

    // Add clipboard copy button
    if (!isError && textContent.trim().length > 0) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-clipboard-btn';
        copyBtn.title = 'Copy message';
        copyBtn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" fill="#222" stroke="#aaa" stroke-width="2"/><rect x="2" y="2" width="13" height="13" rx="2" fill="#222" stroke="#aaa" stroke-width="2"/></svg>`;
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            copyToClipboard(textContent);
            showCopiedTooltip(copyBtn);
        };
        messageDiv.style.position = 'relative';
        messageDiv.appendChild(copyBtn);
    }

    return messageDiv;
}

// Helper to scroll chat to bottom
function scrollToBottom() {
     chatContainerDiv.scrollTop = chatContainerDiv.scrollHeight;
}

// Updated function - Adds user message, saves, but doesn't render AI immediately
function addUserMessageToChat(content: any) {
    chatHistory.push({ role: 'user', content });
    renderChatHistory(); // Re-render to show the user message
    saveChatHistory(); // Save history after adding user message
}

// Function to display AND save the user message to history
function displayAndSaveUserMessage(content: any, contextUsed: boolean = false) {
    // Create the message element (including context styling if needed)
    const userMessageDiv = createMessageElement('user', content, contextUsed);
    chatMessagesDiv.appendChild(userMessageDiv);
    scrollToBottom();

    // Add the message to the history array (NOW including the context flag)
    chatHistory.push({ role: 'user', content: content, contextUsed: contextUsed });
    saveChatHistory(); // Save history

    // Clear the input field AFTER adding to history
    chatInputEl.value = '';
    if (attachedImageDataUrl && currentSelectedModel === VISION_MODEL_ID) {
        attachedImageDataUrl = null;
        imagePreviewEl.src = '';
        hideElement(imagePreviewAreaDiv);
    }
     chatInputEl.style.height = 'auto'; // Reset height

}

// Function to append chunk to the *last* AI message in history
function appendChunkToHistory(chunk: string) {
    if (chatHistory.length === 0) {
        console.warn("appendChunkToHistory called with empty history. Adding new message.");
        chatHistory.push({ role: 'assistant', content: chunk });
    } else {
        const lastMessage = chatHistory[chatHistory.length - 1];
        if (lastMessage.role === 'assistant') {
            if (typeof lastMessage.content === 'string') {
                // Start replacing placeholder or append
                lastMessage.content = (lastMessage.content === '...' ? chunk : lastMessage.content + chunk);
            } else {
                // Handle unexpected content type
                console.warn("Appending chunk to non-string assistant message. Converting to string.");
                lastMessage.content = String(lastMessage.content) + chunk;
            }
        } else {
            // Last message was user, this chunk starts a new AI message (shouldn't happen with placeholder)
            console.warn("appendChunkToHistory called but last message was user. Adding new message.");
            chatHistory.push({ role: 'assistant', content: chunk });
        }
    }
    // Save and render AFTER updating history
    saveChatHistory();
    renderChatHistory();
}

// Function to finalize the *last* AI message in history
function finalizeAssistantMessage(fullResponse: string) {
    if (chatHistory.length > 0) {
        const lastMessage = chatHistory[chatHistory.length - 1];
        if (lastMessage.role === 'assistant') {
            lastMessage.content = fullResponse; // Set the final content
        } else {
             console.warn("finalizeAssistantMessage called but last message is not from assistant. Adding new message.");
             chatHistory.push({ role: 'assistant', content: fullResponse });
        }
    } else {
        console.warn("finalizeAssistantMessage called with empty history. Adding new message.");
        chatHistory.push({ role: 'assistant', content: fullResponse });
    }

    // Save and render AFTER updating history
    saveChatHistory();
    renderChatHistory();

    // Re-enable input
    sendButton.disabled = false;
    chatInputEl.disabled = false;
    chatInputEl.focus();
}

// Function to load chat history from storage
async function loadChatHistory(): Promise<void> {
    try {
        const result = await chrome.storage.local.get(CHAT_HISTORY_KEY);
        if (result[CHAT_HISTORY_KEY] && Array.isArray(result[CHAT_HISTORY_KEY])) {
            chatHistory = result[CHAT_HISTORY_KEY];
            console.log("Chat history loaded:", chatHistory);
            renderChatHistory(); // Render the loaded history
        } else {
            chatHistory = []; // Initialize if not found or invalid
            console.log("No valid chat history found, initializing empty.");
        }
    } catch (error) {
        console.error("Error loading chat history:", error);
        chatHistory = []; // Initialize on error
        // Optionally show an error to the user
    }
}

// Function to handle chat errors signaled from background
function handleChatError(errorMessage: string) {
    console.error("Handling chat error in popup:", errorMessage);
    if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'assistant') {
        // Update the last AI message (placeholder) with an error string
        // *** FIX: Store a string, not an object ***
        chatHistory[chatHistory.length - 1].content = `[Error: ${errorMessage}]`;
        saveChatHistory();
        renderChatHistory(); // Re-render to show the error message in place
    } else {
        // If no AI placeholder, maybe show a general error?
        // This case is less likely with the current flow
        console.warn("Chat error received, but no AI message placeholder found.");
        // Optionally, display error in a dedicated error area
    }
    // Re-enable input after error
    sendButton.disabled = false;
    chatInputEl.disabled = false;
}

// Function to reset the chat
async function resetChat() {
    console.log("[resetChat] Function called"); // <<< Added Log
    try {
        chatHistory = [];
        await saveChatHistory();
        renderChatHistory(); // Clears the display
        console.log("[resetChat] History cleared and rendered"); // <<< Added Log

        // Clear other related states
        attachedImageDataUrl = null;
        imagePreviewEl.src = '';
        hideElement(imagePreviewAreaDiv);

        currentSelectedTextContext = null;
        transcriptionContextPending = false;
        currentTranscription = null;
        hideTranscriptionNotification();
        transcriptionNotificationDismissed = false; // Allow notification again
        console.log("[resetChat] Contexts and UI cleared"); // <<< Added Log

        // Re-enable input
        chatInputEl.disabled = false;
        sendButton.disabled = false;
        chatInputEl.value = '';
        chatInputEl.focus();
        console.log("[resetChat] Input re-enabled and focused"); // <<< Added Log
    } catch (error) {
        console.error("[resetChat] Error during reset:", error); // <<< Added Log
    }
}

// --- Event Listeners ---

modelSelectEl.addEventListener('change', async (event) => {
    const newModel = (event.target as HTMLSelectElement).value;
    console.log(`Model selection changed to: ${newModel}`);
    currentSelectedModel = newModel;
    await chrome.storage.local.set({ [SELECTED_MODEL_KEY]: newModel });
    adjustUIForModel(newModel);
});

sendButton.addEventListener('click', () => {
    // Simply call the handler function which contains all the logic
    handleSendMessage();
});

chatInputEl.addEventListener('keypress', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendButton.click();
    }
});

// --- Drag and Drop Listeners ---

const dropZone = inputAreaDiv;

dropZone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (currentSelectedModel === VISION_MODEL_ID) {
        dropZone.style.border = '2px dashed #4fc3f7';
    }
});

dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (currentSelectedModel === VISION_MODEL_ID) {
        dropZone.style.border = '2px dashed #4fc3f7';
        if (event.dataTransfer) {
             event.dataTransfer.dropEffect = 'copy';
        }
    } else {
         if (event.dataTransfer) {
             event.dataTransfer.dropEffect = 'none';
         }
    }
});

dropZone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Check if the related target is outside the drop zone
    if (!dropZone.contains(event.relatedTarget as Node)) {
        dropZone.style.border = '1px solid #444'; // Restore original border
    }
});

dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropZone.style.border = '1px solid #444';

    if (currentSelectedModel !== VISION_MODEL_ID) {
        addMessageToChat('assistant', { error: `Please select the ${VISION_MODEL_ID} model to use images.` });
        return;
    }

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
        if (files.length > 1) {
             addMessageToChat('assistant', { error: 'Please drop only one image at a time.' });
             return;
        }
        const file = files[0];

        if (file.type.startsWith('image/')) {
            const maxSize = MAX_IMAGE_SIZE_MB * 1024 * 1024;
            if (file.size > maxSize) {
                addMessageToChat('assistant', { error: `Image is too large (max ${MAX_IMAGE_SIZE_MB}MB).` });
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const result = e.target?.result as string;
                if (result && result.startsWith('data:image')) {
                    attachedImageDataUrl = result;
                    imagePreviewEl.src = result;
                    showFlexElement(imagePreviewAreaDiv);
                } else {
                    addMessageToChat('assistant', { error: 'Error processing image data.' });
                    attachedImageDataUrl = null;
                }
            };
            reader.onerror = (e) => {
                addMessageToChat('assistant', { error: 'Error reading image file.' });
                attachedImageDataUrl = null;
            };
            reader.readAsDataURL(file);
        } else {
            addMessageToChat('assistant', { error: 'Only image files can be dropped.' });
        }
    } else {
         console.log("No files dropped or dataTransfer unavailable.");
    }
});

removeImageButton.addEventListener('click', () => {
    attachedImageDataUrl = null;
    imagePreviewEl.src = '';
    hideElement(imagePreviewAreaDiv);
});

// Listener for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Popup received message:", message);

    switch (message.action) {
        case 'transcriptionComplete':
            hideStatusMessages();
            hideTranscriptionElements();
            chrome.storage.local.remove(['pendingDownload', 'transcriptionState']);
            // Only show the notification bar via loadTranscriptionState
            loadTranscriptionState();
            break;
        case 'transcriptionError':
            hideStatusMessages();
            showElement(errorDiv);
            chrome.storage.local.remove(['pendingDownload', 'transcriptionState']);
            break;
        case 'updatePopupState':
            console.log("Received updatePopupState, re-initializing...");
            initializePopup();
            break;
        case 'apiKeyMissing':
            hideStatusMessages();
            hideTranscriptionElements();
            hideElement(initialMessageDiv);
            showElement(noKeyDiv);
            break;
        case 'chatError':
            const errorMessage = message.payload.error || 'Unknown chat error';
            // Update the last message (which should be the placeholder) with the error
            if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'assistant') {
                 chatHistory[chatHistory.length - 1].content = `Error: ${errorMessage}`;
                 saveChatHistory(); // Save the error state
                 renderChatHistory(); // Render the error
            } else {
                 // Fallback if something unexpected happened
                 addMessageToChat('assistant', { error: errorMessage });
            }
            // Re-enable input after error
            sendButton.disabled = false;
            chatInputEl.disabled = false;
            chatInputEl.focus();
            break;
        case 'addAiChatChunk':
            appendChunkToHistory(message.payload.chunk); // Use the rewritten function
            break;
        case 'endAiChatStream':
            finalizeAssistantMessage(message.payload.fullResponse); // Use the rewritten function
            break;
        case 'resetChat':
            resetChat();
            break;
        default:
            console.warn("Popup received unhandled message action:", message.action);
    }
});

// --- Initialization Function ---

async function initializePopup() {
    console.log("Initializing popup...");
    hideStatusMessages(); // Hide error/no-key first
    hideTranscriptionElements();
    hideTranscriptionLoadingNotification(); // Ensure loading indicator is hidden initially
    hideTranscriptionNotification();     // Ensure transcription result is hidden initially
    showElement(initialMessageDiv); // Show "Loading..." initially

    if (!await loadApiKeyStatus()) {
        console.log("API Key missing, initialization stopped.");
        // loadApiKeyStatus already shows noKeyDiv, so just return
        return;
    }
    console.log("API Key found.");

    await loadSelectedModel();
    await loadChatHistory();
    await loadTranscriptionState(); // Load transcription state (might show loading/result notification or errorDiv)
    await loadSelectedTextContext();

    // Final UI adjustment: Hide "Loading..." unless error or no-key is displayed
    if (errorDiv.style.display === 'none' && noKeyDiv.style.display === 'none') {
        hideElement(initialMessageDiv);
    } else {
        // If error or no-key message IS displayed, ensure initial loading message is hidden
        hideElement(initialMessageDiv);
    }

    // Focus input if transcription isn't active and chat isn't disabled
    if (!chatInputEl.disabled) {
        chatInputEl.focus();
    }

    // --- Add Event Listeners ---
    console.log("[initializePopup] Adding event listeners..."); // <<< Added Log

    // Add event listener for the reset button
    const resetChatButton = document.getElementById('reset-chat-button');
    if (resetChatButton) {
        resetChatButton.addEventListener('click', () => {
             console.log("[initializePopup] Reset button clicked!"); // <<< Added Log
             resetChat();
        });
        console.log("[initializePopup] Reset button listener added."); // <<< Added Log
    } else {
        console.error("[initializePopup] Reset chat button not found!"); // <<< Added Log
    }

    // Add event listener for the send button
    sendButton.addEventListener('click', () => {
        // Simply call the handler function which contains all the logic
        handleSendMessage();
    });

    console.log("Popup initialization complete.");
}

// Function to load and handle the selected text context
async function loadSelectedTextContext() {
    try {
        const result = await chrome.storage.local.get('lastSelectedText');
        console.log('[Popup] loadSelectedTextContext - Retrieved from storage:', result.lastSelectedText ? `"${result.lastSelectedText.substring(0, 50)}..."` : 'null'); // Log retrieved value
        if (result.lastSelectedText) {
            console.log("[Popup] Found selected text context in storage.");
            currentSelectedTextContext = result.lastSelectedText;
            console.log('[Popup] loadSelectedTextContext - currentSelectedTextContext SET to:', currentSelectedTextContext ? `"${currentSelectedTextContext.substring(0,50)}..."` : 'null'); // Log assigned value
            chatInputEl.classList.add('glow'); // <-- Added glow class

            // Remove the text from storage now that it's loaded into the popup state
            await chrome.storage.local.remove('lastSelectedText');
            console.log("Removed selected text from storage.");
        } else {
            console.log("No selected text context found in storage.");
            currentSelectedTextContext = null;
            chatInputEl.classList.remove('glow'); // <-- Remove glow class if no context
        }
    } catch (error) {
        console.error("Error loading selected text context:", error);
        currentSelectedTextContext = null;
        chatInputEl.classList.remove('glow'); // <-- Remove glow class on error
    }
}

// --- Clipboard Utility ---
function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
        // Optionally show a tooltip or feedback
    }).catch(err => {
        alert('Failed to copy to clipboard.');
        console.error('Clipboard copy failed:', err);
    });
}

function showCopiedTooltip(target: HTMLElement) {
    const tooltip = document.createElement('span');
    tooltip.className = 'copied-tooltip';
    tooltip.textContent = 'Copied!';
    target.appendChild(tooltip);
    setTimeout(() => {
        tooltip.remove();
    }, 900);
}

// --- Transcription Notification Logic ---
function showTranscriptionNotification(transcription: string) {
    currentTranscription = transcription;
    transcriptionNotificationDiv.style.display = 'flex';
    transcriptionNotificationDismissed = false;
}
function hideTranscriptionNotification() {
    transcriptionNotificationDiv.style.display = 'none';
    // currentTranscription = null; // <<< REMOVED: Don't nullify here
}

attachTranscriptionBtn.onclick = () => {
    if (currentTranscription) {
        transcriptionContextPending = true;
        chatInputEl.classList.add('glow');
        hideTranscriptionNotification();
    }
};
copyTranscriptionBtn.onclick = () => {
    if (currentTranscription) {
        copyToClipboard(currentTranscription);
        showCopiedTooltip(copyTranscriptionBtn);
    }
};
dismissTranscriptionBtn.onclick = () => {
    transcriptionNotificationDismissed = true;
    hideTranscriptionNotification();
};

// Renamed and modified prepareMessagesForApi to prepareContentForApi
// It now returns the final content and whether context was used, but doesn't modify history directly
function prepareContentForApi(userMessageContent: any): { finalContent: any, contextWasUsed: boolean } {
    let contextWasUsed = false;
    let finalUserMessageContent = userMessageContent;

    console.log(`[prepareContentForApi] Checking context. transcriptionContextPending: ${transcriptionContextPending}, currentTranscription available: ${!!currentTranscription}, currentSelectedTextContext available: ${!!currentSelectedTextContext}`);

    // Use selected text context if present
    if (currentSelectedTextContext) {
        console.log("[prepareContentForApi] Using selected text context.");
        const contextPrefix = `Based on the following selected text:\n\n"${currentSelectedTextContext}"\n\nPlease answer the question:`;
        if (typeof userMessageContent === 'string') {
            finalUserMessageContent = `${contextPrefix}\n\n${userMessageContent}`;
        } else if (Array.isArray(userMessageContent)) {
            const newContentArray = userMessageContent.map(part => ({...part}));
            const textPartIndex = newContentArray.findIndex(part => part.type === 'text');
            if (textPartIndex !== -1) {
                newContentArray[textPartIndex].text = `${contextPrefix}\n\n${newContentArray[textPartIndex].text}`;
            } else {
                newContentArray.unshift({ type: 'text', text: contextPrefix });
            }
            finalUserMessageContent = newContentArray;
        } else {
            finalUserMessageContent = `${contextPrefix}\n\n${String(userMessageContent)}`;
        }
        contextWasUsed = true;
        currentSelectedTextContext = null;
        chatInputEl.classList.remove('glow');
    } else if (transcriptionContextPending && currentTranscription) {
        console.log("[prepareContentForApi] Using transcription context.");
        // Use transcription as context if attach was clicked
        // *** FIX: Use simpler prefix as requested ***
        const contextPrefix = `Transcript:\n${currentTranscription}\n\nUser Question:`;
        if (typeof userMessageContent === 'string') {
            finalUserMessageContent = `${contextPrefix}\n${userMessageContent}`;
        } else if (Array.isArray(userMessageContent)) {
            const newContentArray = userMessageContent.map(part => ({...part}));
            const textPartIndex = newContentArray.findIndex(part => part.type === 'text');
            if (textPartIndex !== -1) {
                newContentArray[textPartIndex].text = `${contextPrefix}\n${newContentArray[textPartIndex].text}`;
            } else {
                // If no text part (e.g., image only), add context as a new text part
                newContentArray.unshift({ type: 'text', text: contextPrefix });
            }
            finalUserMessageContent = newContentArray;
        } else {
            // Handle potentially non-string/non-array content defensively
            finalUserMessageContent = `${contextPrefix}\n${String(userMessageContent)}`;
        }
        console.log("[prepareContentForApi] finalUserMessageContent with transcription:", finalUserMessageContent);
        contextWasUsed = true;
        // Do not reset transcriptionContextPending here, reset it in handleSendMessage *after* use
        // transcriptionContextPending = false;
        chatInputEl.classList.remove('glow');
    } else {
        console.log("[prepareContentForApi] No context added.");
    }
    return { finalContent: finalUserMessageContent, contextWasUsed: contextWasUsed };
}

function showTranscriptionLoadingNotification() {
    transcriptionLoadingNotificationDiv.style.display = 'flex';
}
function hideTranscriptionLoadingNotification() {
    transcriptionLoadingNotificationDiv.style.display = 'none';
}

function handleSendMessage() {
    const messageText = chatInputEl.value.trim();
    let userMessageContent: any; // Renamed from messageContent for clarity

    // Determine base user content (text or image+text)
    if (attachedImageDataUrl && currentSelectedModel === VISION_MODEL_ID) {
        userMessageContent = [
            { type: "text", text: messageText || "Describe this image." }, // Use default text if none provided with image
            { type: "image_url", image_url: { url: attachedImageDataUrl } }
        ];
    } else if (messageText) {
        userMessageContent = messageText;
    } else {
        console.log("No message text or image to send.");
        return; // Exit if nothing to send
    }

    // Prepare the final content, potentially adding context (transcription or selected text)
    console.log("[handleSendMessage] Calling prepareContentForApi with userMessageContent:", userMessageContent);
    const { finalContent, contextWasUsed } = prepareContentForApi(userMessageContent);
    console.log(`[handleSendMessage] Received from prepareContentForApi. finalContent: ${JSON.stringify(finalContent)}, contextWasUsed: ${contextWasUsed}`);

    // *** Fix: Create the new message object before constructing the API payload ***
    const newUserMessage = {
        role: 'user' as const, // Ensure role is typed correctly
        content: finalContent,
        contextUsed: contextWasUsed
    };

    // *** Fix: Construct messages for API *including* the new user message ***
    const messagesForApi = [
        ...chatHistory, // Spread existing history
        { role: newUserMessage.role, content: newUserMessage.content } // Add NEW user message for API call (don't need contextUsed flag for API)
    ];

    // Update UI and save the *actual* history (including contextUsed flag)
    displayAndSaveUserMessage(finalContent, contextWasUsed);

    // Show placeholder for AI response
    const assistantMessageDiv = createMessageElement('assistant', '...');
    chatMessagesDiv.appendChild(assistantMessageDiv);
    scrollToBottom();

    // Disable input while waiting
    sendButton.disabled = true;
    chatInputEl.disabled = true;

    // Send the correctly constructed message list to the background
    chrome.runtime.sendMessage({
        action: 'sendChatMessage',
        payload: {
            model: currentSelectedModel,
            messages: messagesForApi // Send the history *with* the new user message
        }
    });

    // Clear pending transcription context if it was used
    if (contextWasUsed && transcriptionContextPending) {
        transcriptionContextPending = false; // Ensure this is reset
        currentTranscription = null; // Clear the stored transcription after use
    }

     // Clear attached image data after sending if it was used
     if (attachedImageDataUrl) {
         attachedImageDataUrl = null;
         imagePreviewEl.src = '';
         hideElement(imagePreviewAreaDiv);
     }
}