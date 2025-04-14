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
const transcriptionContainerDiv = document.getElementById('transcription-container')!;
const statusMessagesDiv = document.getElementById('status-messages')!;
const modelSelectEl = document.getElementById('model-select')! as HTMLSelectElement; // Definition for model select
const initialMessageDiv = document.getElementById('initial-message')!;
const requestDiv = document.getElementById('transcription-request')!;
const resultDiv = document.getElementById('transcription-result')!;
const loadingDiv = document.getElementById('loading-indicator')!;
const errorDiv = document.getElementById('error-message')!;
const noKeyDiv = document.getElementById('no-key-message')!;
const filenameEl = document.getElementById('filename')!;
const confirmButton = document.getElementById('confirm-transcribe')! as HTMLButtonElement;
const cancelButton = document.getElementById('cancel-transcribe')! as HTMLButtonElement;
const transcriptionTextEl = document.getElementById('transcription-text')!;
const copyButton = document.getElementById('copy-button')! as HTMLButtonElement;
const summaryButton = document.getElementById('summary-button')! as HTMLButtonElement;
const emailButton = document.getElementById('email-button')! as HTMLButtonElement;
const transcriptionDetailsEl = document.getElementById('transcription-details')! as HTMLDetailsElement;
const errorDetailsEl = document.getElementById('error-details')!;
const openOptionsButton = document.getElementById('open-options')! as HTMLButtonElement;
const dismissErrorButton = document.getElementById('dismiss-error-button')! as HTMLButtonElement;
const resetChatButton = document.getElementById('reset-chat-button')! as HTMLButtonElement; // Get reset button

// State variables
let currentDownloadId: number | null = null;
let currentSelectedModel: string = DEFAULT_MODEL;
let chatHistory: { role: 'user' | 'assistant', content: any, contextUsed?: boolean }[] = [];
let attachedImageDataUrl: string | null = null;
let currentSelectedTextContext: string | null = null;

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
    hideElement(requestDiv);
    hideElement(resultDiv);
    hideElement(loadingDiv);
}

function addMessageToChat(role: 'user' | 'assistant', content: any) {
    // This function now ONLY adds to history, saves, and renders.
    // It should NOT be called directly for streaming updates.
    chatHistory.push({ role, content });
    saveChatHistory(); // Save history after adding a message
    renderChatHistory(); // Re-render the entire history
}

function resetButtonStates() {
    confirmButton.disabled = false;
    cancelButton.disabled = false;
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

// Function to send a prompt based on transcription
function sendTranscriptionPrompt(promptTemplate: string) {
    const transcript = transcriptionTextEl.textContent?.trim();
    if (!transcript) {
        addMessageToChat('assistant', { error: 'Cannot generate prompt: Transcription is empty.'});
        return;
    }

    const prompt = promptTemplate.replace('INSERT TRANSCRIPT HERE', transcript)
                                .replace('INSERT TRANSCRIPT', transcript); // Handle both placeholders

    // Add prompt to chat UI and history as a user message
    addUserMessageToChat(prompt);

    // Create placeholder for the AI's response (summary/email)
    // createAiMessagePlaceholder();

    // Prepare and send message to background
    const messageToBackground = {
        action: 'sendChatMessage',
        payload: {
            model: currentSelectedModel, // Use currently selected model
            messages: [...chatHistory],
        }
    };
    chrome.runtime.sendMessage(messageToBackground);
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
        errorDetailsEl.textContent = 'Could not check API key status.';
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
    hideTranscriptionElements();
    hideElement(transcriptionContainerDiv);

    let transcriptionIsActive = false;
    let errorIsVisible = errorDiv.style.display !== 'none';
    let noKeyIsVisible = noKeyDiv.style.display !== 'none';

    try {
        const result = await chrome.storage.local.get(['pendingDownload', 'transcriptionResult', 'transcriptionState', 'transcriptionError']);

        if (result.transcriptionState === 'loading') {
            showElement(loadingDiv);
            showElement(transcriptionContainerDiv);
            transcriptionIsActive = true;
        } else if (result.transcriptionResult) {
            transcriptionTextEl.textContent = result.transcriptionResult;
            showElement(resultDiv);
            showElement(transcriptionContainerDiv);
            transcriptionIsActive = true;
        } else if (result.transcriptionError) {
             hideStatusMessages();
             errorDetailsEl.textContent = `Transcription Error: ${result.transcriptionError}`;
             showElement(errorDiv);
             errorIsVisible = true;
        } else if (result.pendingDownload) {
            currentDownloadId = result.pendingDownload.downloadId;
            filenameEl.textContent = result.pendingDownload.filename;
            resetButtonStates();
            showElement(requestDiv);
            showElement(transcriptionContainerDiv);
            transcriptionIsActive = true;
        } else {
            console.log("No active transcription state.");
            hideElement(transcriptionContainerDiv);
        }

    } catch (error) {
        console.error("Error checking transcription state:", error);
        hideStatusMessages();
        hideTranscriptionElements();
        hideElement(transcriptionContainerDiv);
        errorDetailsEl.textContent = 'Could not retrieve extension state.';
        showElement(errorDiv);
        errorIsVisible = true;
    }

    // Update general status message if nothing else is active
    if (!transcriptionIsActive && !errorIsVisible && !noKeyIsVisible) {
        hideStatusMessages();
        initialMessageDiv.textContent = 'Ready.';
        showElement(initialMessageDiv);
    } else if (initialMessageDiv.textContent === 'Loading...') {
        // If still loading but something else became active, hide loading message
        hideElement(initialMessageDiv);
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
    } else { // role === 'user'
        let textContent = '';
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

// Function to reset the chat
async function resetChat() {
    console.log("Resetting chat...");
    chatHistory = [];
    attachedImageDataUrl = null;
    currentSelectedTextContext = null; // <-- Added: Clear context on reset
    imagePreviewEl.src = '';
    hideElement(imagePreviewAreaDiv);
    chatInputEl.classList.remove('glow'); // <-- Remove glow on reset
    renderChatHistory(); // Clear the display
    try {
        await chrome.storage.local.remove([CHAT_HISTORY_KEY]);
        console.log("Chat history cleared from storage.");
    } catch (error) {
        console.error("Error clearing chat history from storage:", error);
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

// Reset Chat Button Click Listener
resetChatButton.addEventListener('click', resetChat);

confirmButton.addEventListener('click', () => {
    if (currentDownloadId !== null) {
        confirmButton.disabled = true;
        cancelButton.disabled = true;
        hideTranscriptionElements();
        showElement(loadingDiv);
        showElement(transcriptionContainerDiv);
        chrome.runtime.sendMessage({ action: 'startTranscription', downloadId: currentDownloadId });
    }
});

cancelButton.addEventListener('click', () => {
    if (currentDownloadId !== null) {
        confirmButton.disabled = true;
        cancelButton.disabled = true;
        chrome.runtime.sendMessage({ action: 'cancelTranscription', downloadId: currentDownloadId });
        hideTranscriptionElements();
        hideElement(transcriptionContainerDiv);
        hideStatusMessages();
        initialMessageDiv.textContent = 'Transcription cancelled.';
        showElement(initialMessageDiv);
        currentDownloadId = null;
    }
});

copyButton.addEventListener('click', () => {
    const textToCopy = transcriptionTextEl.textContent || '';
    if (!textToCopy) {
        addMessageToChat('assistant', { error: 'Nothing to copy.'});
        return;
    }
    navigator.clipboard.writeText(textToCopy)
        .then(() => {
            copyButton.textContent = 'Copied!';
            setTimeout(() => copyButton.textContent = 'Copy', 1500); // Revert text
        })
        .catch(err => {
            console.error('Failed to copy text: ', err);
            addMessageToChat('assistant', { error: 'Failed to copy text to clipboard.' });
        });
});

summaryButton.addEventListener('click', () => {
    const summaryPrompt = "Summarize the phonecall based on the following transcript: INSERT TRANSCRIPT";
    sendTranscriptionPrompt(summaryPrompt);
});

emailButton.addEventListener('click', () => {
    const emailPrompt = "Based on the following transcript, create the email discussed: INSERT TRANSCRIPT HERE";
    sendTranscriptionPrompt(emailPrompt);
});

openOptionsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

dismissErrorButton.addEventListener('click', async () => {
    console.log("Dismiss error button clicked");
    hideStatusMessages();
    await chrome.storage.local.remove(['transcriptionState', 'transcriptionError']);
    console.log("Cleared error state from storage.");
    await loadTranscriptionState();
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
        case 'requestTranscriptionConfirmation':
            hideStatusMessages();
            hideTranscriptionElements();
            currentDownloadId = message.downloadId;
            filenameEl.textContent = message.filename;
            resetButtonStates();
            showElement(requestDiv);
            showElement(transcriptionContainerDiv);
            break;
        case 'transcriptionComplete':
            hideStatusMessages();
            hideTranscriptionElements();
            transcriptionTextEl.textContent = message.transcription;
            showElement(resultDiv);
            showElement(transcriptionContainerDiv);
            chrome.storage.local.remove(['pendingDownload', 'transcriptionState']);

            // Indicate new transcription and briefly open details
            transcriptionDetailsEl.querySelector('summary')!.textContent = 'Transcription Complete - Show/Hide';
            transcriptionDetailsEl.open = true;
            setTimeout(() => {
                 // Optionally close it again after a delay, or leave open
                 // transcriptionDetailsEl.open = false;
                 transcriptionDetailsEl.querySelector('summary')!.textContent = 'Show/Hide Transcription'; // Reset text
            }, 3000); // Keep open for 3 seconds

            loadTranscriptionState();
            break;
        case 'transcriptionError':
            hideStatusMessages();
            hideTranscriptionElements();
            errorDetailsEl.textContent = `Transcription Error: ${message.error || 'Unknown error'}`;
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
            hideElement(transcriptionContainerDiv);
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
    hideStatusMessages();
    hideTranscriptionElements();
    showElement(initialMessageDiv); // Show loading initially

    if (!await loadApiKeyStatus()) {
        console.log("API Key missing, initialization stopped.");
        return; // Stop initialization if API key is missing
    }
    console.log("API Key found.");

    await loadSelectedModel(); // Load model preference first
    await loadChatHistory(); // Load chat history
    await loadTranscriptionState(); // Load transcription state last as it might hide initial message
    await loadSelectedTextContext(); // <-- Added: Load selected text context

    // Final UI adjustments based on loaded state (e.g., hide initial message)
    if (transcriptionContainerDiv.style.display === 'none' &&
        errorDiv.style.display === 'none' &&
        noKeyDiv.style.display === 'none')
    {
        hideElement(initialMessageDiv);
    }

    // Focus input if transcription isn't active
    if (transcriptionContainerDiv.style.display === 'none') {
        chatInputEl.focus();
    }

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

// Renamed and modified prepareMessagesForApi to prepareContentForApi
// It now returns the final content and whether context was used, but doesn't modify history directly
function prepareContentForApi(userMessageContent: any): { finalContent: any, contextWasUsed: boolean } {
    let contextWasUsed = false;
    let finalUserMessageContent = userMessageContent;

    console.log('[Popup] prepareContentForApi - START - currentSelectedTextContext:', currentSelectedTextContext ? `"${currentSelectedTextContext.substring(0, 50)}..."` : 'null'); // Log context at start

    if (currentSelectedTextContext) {
        console.log("[Popup] Prepending selected text context to user message.");
        const contextPrefix = `Based on the following selected text:\n\n"${currentSelectedTextContext}"\n\nPlease answer the question:`;

        if (typeof userMessageContent === 'string') {
            finalUserMessageContent = `${contextPrefix}\n\n${userMessageContent}`;
        } else if (Array.isArray(userMessageContent)) {
            // Handle vision model case (array of objects)
             // Create a new array to avoid modifying the original object if it's complex
             const newContentArray = userMessageContent.map(part => ({...part}));
             const textPartIndex = newContentArray.findIndex(part => part.type === 'text');

            if (textPartIndex !== -1) {
                newContentArray[textPartIndex].text = `${contextPrefix}\n\n${newContentArray[textPartIndex].text}`;
            } else {
                newContentArray.unshift({ type: 'text', text: contextPrefix });
            }
            finalUserMessageContent = newContentArray;
        } else {
            console.warn("Unknown user message content type when adding context:", userMessageContent);
            finalUserMessageContent = `${contextPrefix}\n\n${String(userMessageContent)}`;
        }

        console.log('[Popup] prepareContentForApi - Context WAS USED. finalUserMessageContent:', typeof finalUserMessageContent === 'string' ? `"${finalUserMessageContent.substring(0, 100)}..."` : '[Object/Array]'); // Log modified content
        contextWasUsed = true;
        currentSelectedTextContext = null;
        chatInputEl.classList.remove('glow');
    } else {
        console.log('[Popup] prepareContentForApi - Context WAS NOT used.');
    }

    return { finalContent: finalUserMessageContent, contextWasUsed: contextWasUsed };
}

// Function to handle sending the chat message
function handleSendMessage() {
    const messageText = chatInputEl.value.trim();

    // Determine content type (text or complex object for vision)
    let messageContent: any;
    if (attachedImageDataUrl && currentSelectedModel === VISION_MODEL_ID) {
        messageContent = [
            { type: "text", text: messageText || "Describe this image." }, // Add placeholder if text is empty
            { type: "image_url", image_url: { url: attachedImageDataUrl } }
        ];
    } else if (messageText) {
        messageContent = messageText;
    } else {
        console.log("No message text or image to send.");
        return; // Don't send empty messages unless it's an image-only query
    }

    if (!messageContent) return; // Should not happen based on above logic, but check anyway

    console.log('[Popup] handleSendMessage - BEFORE prepare - currentSelectedTextContext:', currentSelectedTextContext ? `"${currentSelectedTextContext.substring(0, 50)}..."` : 'null'); // Log context before prepare call
    // Prepare the final content, potentially adding context
    const { finalContent, contextWasUsed } = prepareContentForApi(messageContent);

    // Display and save the potentially modified user message to history
    displayAndSaveUserMessage(finalContent, contextWasUsed);

    // Prepare the full message list for the API using the updated history
    const messagesForApi = [...chatHistory]; // History now contains the final user message

    // Create placeholder for AI response
    const assistantMessageDiv = createMessageElement('assistant', '...'); // Use '...' as placeholder
    chatMessagesDiv.appendChild(assistantMessageDiv);
    scrollToBottom();

    // Send message to background for processing
    chrome.runtime.sendMessage({
        action: 'sendChatMessage',
        payload: {
            model: currentSelectedModel,
            // Clean the messages array for the API call, removing the contextUsed flag
            messages: messagesForApi.map(({ role, content }) => ({ role, content }))
        }
    });

    console.log('[Popup] handleSendMessage - Message sent to background. Payload:', JSON.stringify(messagesForApi.map(({ role, content }) => ({ role, content: typeof content === 'string' ? `${content.substring(0,100)}...` : '[Object/Array]' })))); // Log sent payload
}

// Start initialization when the DOM is ready
document.addEventListener('DOMContentLoaded', initializePopup);