# Audio Transcriber & AI Assistant (Groq Powered Chrome Extension)

This Chrome extension provides a powerful interface to interact with various AI models via the Groq API, offering fast transcription services for downloaded audio files and a versatile chat interface with vision capabilities.

## Features

*   **AI Chat:** Engage in conversations with various large language models available through the Groq API.
*   **Model Selection:** Easily switch between different Groq models directly from the popup.
*   **Chat History:** Conversation history is saved locally and persists even when the popup is closed.
*   **Chat Reset:** Clear the current conversation history to start fresh.
*   **Selected Text Capture:** Select text on any webpage, and the extension can capture it to potentially use in the chat.
*   **Audio Transcription (Downloads):** Automatically detects completed audio file downloads (MP3, WAV, M4A, OGG, FLAC, WEBM etc.).
*   **Audio Transcription (Clipboard URL):** Transcribe audio directly from a URL copied to your clipboard via the context menu.
*   **One-Click Transcription:** Transcribe detected audio files or clipboard URLs with a single click using Groq's transcription API (`whisper-large-v3-turbo`).
*   **Transcription Actions:**
    *   **Copy:** Copy the full transcript to the clipboard.
    *   **Summary:** Send the transcript to the selected chat model to generate a summary.
    *   **Email:** Send the transcript to the selected chat model to draft an email based on its content.
*   **Streaming Responses:** AI chat responses are streamed word-by-word for a smoother experience.
*   **API Key Management:** Securely store your Groq API key via the extension's options page.
*   **Modern UI:** Clean and responsive interface built with TypeScript and CSS variables.

## Prerequisites

*   [Node.js](https://nodejs.org/) (LTS version recommended)
*   [npm](https://www.npmjs.com/) (usually included with Node.js) or [yarn](https://yarnpkg.com/)

## Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd <repository-directory>
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    # or
    yarn install
    ```
3.  **Build the extension:**
    *   **For Development (with watching):**
        ```bash
        npm run dev
        # or
        yarn dev
        ```
        This will create a `dist` folder and watch for changes in the `src` directory, rebuilding automatically.
    *   **For Production:**
        ```bash
        npm run build
        # or
        yarn build
        ```
        This creates an optimized build in the `dist` folder suitable for packing or distribution.

## Setup

1.  **Load the Extension in Chrome/Chromium:**
    *   Open Chrome and navigate to `chrome://extensions/`.
    *   Enable "Developer mode" using the toggle switch in the top-right corner.
    *   Click the "Load unpacked" button.
    *   Select the `dist` folder generated during the build process.
    *   The extension icon should appear in your browser toolbar.
2.  **Set Groq API Key:**
    *   Right-click the extension icon in your toolbar and select "Options".
    *   Alternatively, navigate to the extension details in `chrome://extensions/` and click "Extension options".
    *   Enter your Groq API key in the provided field and click "Save". You can obtain a key from the [Groq Console](https://console.groq.com/keys).

## Usage

1.  **Chat:**
    *   Click the extension icon to open the popup.
    *   Select your desired AI model from the dropdown menu.
    *   Type your message in the input area and click "Send" or press Enter.
    *   If using a vision model, drag and drop an image onto the input area before sending your message.
    *   Click the refresh icon in the header to clear the chat history.
2.  **Transcription:**
    *   Download an audio file (e.g., MP3, WAV, M4A).
    *   The extension popup will automatically update, showing a prompt to transcribe the detected file.
    *   Click "Yes" to start the transcription. A loading indicator will appear.
    *   Once complete, the transcript will be displayed in the "Transcription" section.
    *   Use the "Copy", "Summary", or "Email" buttons to interact with the transcript.

## Project Structure

```
.
├── dist/                  # Build output directory (loaded into Chrome)
├── icons/                 # Extension icons
├── node_modules/          # Project dependencies
├── src/                   # Source code
│   ├── background.ts      # Background service worker (API calls, downloads, clipboard, etc.)
│   ├── content_script.ts  # Content script (injects into pages, e.g., for text selection)
│   ├── content_script.css # CSS for the content script
│   ├── offscreen/         # Offscreen document (fetch audio via URL, read clipboard)
│   │   ├── offscreen.html
│   │   └── offscreen.ts
│   ├── options/           # Options page code (API key management)
│   │   ├── options.html
│   │   ├── options.css
│   │   └── options.ts
│   ├── popup/             # Popup UI code (chat, transcription controls)
│   │   ├── popup.html     # (Or potentially popup.tsx if using React/JSX)
│   │   ├── popup.css
│   │   └── popup.ts       # (Or potentially popup.tsx)
│   └── util/              # Optional: Utility functions (e.g., base64 helpers)
├── .env                   # Environment variables (e.g., API keys - *DO NOT COMMIT*)
├── .gitignore             # Git ignore rules
├── manifest.json          # Extension manifest file
├── package.json           # Project metadata and dependencies
├── package-lock.json      # Dependency lock file (or yarn.lock)
├── README.md              # This file
├── DOCUMENTATION.md       # Detailed technical documentation
├── tsconfig.json          # TypeScript configuration
└── webpack.config.js      # Webpack build configuration
```

*   **`manifest.json`**: Defines the extension's properties, permissions, scripts, and UI pages.
*   **`src/background.ts`**: The service worker running in the background. It handles API calls, download events, clipboard URL processing, context menu actions, message passing between components, and manages the offscreen document.
*   **`src/popup/`**: Contains the code for the main extension popup UI, including the chat interface and transcription controls.
*   **`src/options/`**: Contains the code for the extension's options page, primarily used for setting the API key.
*   **`src/offscreen/`**: Contains the HTML and TypeScript for the offscreen document, used to fetch audio from URLs and read the clipboard.
*   **`src/content_script.ts/.css`**: Injected into web pages to perform actions like capturing selected text.
*   **`webpack.config.js`**: Configures how the TypeScript and CSS files are bundled into the `dist` directory.
*   **`dist/`**: Contains the final, compiled extension files loaded into the browser. **Do not edit files here directly**.

## Development

*   Run `npm run dev` (or `yarn dev`) to start the development build.
*   Webpack will watch for changes in the `src` directory and automatically recompile the extension into the `dist` folder.
*   After making changes, you might need to reload the extension in Chrome (`chrome://extensions/` -> click the reload icon for the extension) to see the updates, especially for changes in `background.ts` or `manifest.json`. Changes to the popup UI (`src/popup/*`) often appear just by closing and reopening the popup.
*   Use `console.log` statements in your code. Check the relevant console for output:
    *   **Popup:** Right-click the popup UI -> Inspect -> Console.
    *   **Background Service Worker:** `chrome://extensions/` -> Click the "Service worker" link for the extension.
    *   **Options Page:** Open the options page -> Right-click -> Inspect -> Console.
    *   **Offscreen Document:** `chrome://extensions/` -> Click the "Inspect views" link for the extension -> Select the `offscreen.html` entry.

### System Message

To modify the base instructions or context provided to the AI model (the "system message"), you need to edit the `src/background.ts` file. Locate the `streamGroqChatApi` function. Inside this function, find the `fetch` call to the Groq Chat API URL. The system prompt is added to the `messages` array within the `body` of the request.

```typescript
            // Prepend the system message
            const messagesWithSystemPrompt = [
                 // ---> Modify the system message content here:
                 { role: 'system', content: 'You are a helpful assistant called Mark, you are an expert in the field of the swedish rental market and law' },
                 // Spread the rest of the chat history
                 ...messages 
            ];

            // The streaming function uses this modified array
            streamGroqChatApi(apiKey, model, messagesWithSystemPrompt)
```

Modify the `content` property of the object where `role: 'system'` to change the AI's instructions.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

(Consider adding more specific contribution guidelines if needed, e.g., coding style, branch naming conventions.)

## License

(Specify license if applicable, e.g., MIT License. If none, you can omit this section or state "All rights reserved.") 