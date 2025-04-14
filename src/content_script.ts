console.log("Content script loaded.");

let floatingButton: HTMLButtonElement | null = null;
let selectedText = "";

function showFloatingButton(range: Range) {
  removeFloatingButton(); // Remove existing button if any

  // Get the bounding box of the entire selection range
  const rect = range.getBoundingClientRect();

  // Check if the rect has zero dimensions (might happen for certain selections)
  if (rect.width === 0 && rect.height === 0) {
    console.warn("Selection bounding box has zero dimensions, cannot position button.");
    return; // Don't show button if we can't position it
  }

  floatingButton = document.createElement("button");
  floatingButton.id = "extension-floating-button"; // For styling
  floatingButton.title = "Ask Mark about selected text"; // Add tooltip

  // Add SVG Icon (User Provided)
  floatingButton.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="display: block; margin: auto;">
      <g id="SVGRepo_bgCarrier" stroke-width="0"></g>
      <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g>
      <g id="SVGRepo_iconCarrier">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M12.9914 2.86904C12.9914 2.86899 12.9914 2.86895 12.9914 2.86891C12.9256 2.37165 12.5016 2 12 2C11.4983 2 11.0743 2.37171 11.0086 2.86904L11.0086 2.86932L11.0085 2.86992L11.0075 2.87704L11.0029 2.91013C10.9985 2.94035 10.9917 2.98656 10.9822 3.04699C10.9633 3.16792 10.9339 3.34537 10.8927 3.56523C10.81 4.00611 10.6812 4.61161 10.4967 5.27082C10.1127 6.64363 9.5417 8.04408 8.79289 8.79289C8.04408 9.5417 6.64363 10.1127 5.27082 10.4967C4.61161 10.6812 4.00611 10.81 3.56523 10.8927C3.34537 10.9339 3.16792 10.9633 3.04699 10.9822C2.98656 10.9917 2.94035 10.9985 2.91013 11.0029L2.87704 11.0075L2.86992 11.0085L2.86932 11.0086C2.86923 11.0086 2.86913 11.0086 2.86904 11.0086C2.86899 11.0086 2.86895 11.0086 2.86891 11.0086C2.37165 11.0744 2 11.4984 2 12C2 12.5017 2.37171 12.9257 2.86904 12.9914L2.86932 12.9914L2.86992 12.9915L2.87704 12.9925L2.91013 12.9971C2.94035 13.0015 2.98656 13.0083 3.04699 13.0178C3.16792 13.0367 3.34537 13.0661 3.56523 13.1073C4.00611 13.19 4.61161 13.3188 5.27082 13.5033C6.64363 13.8873 8.04408 14.4583 8.79289 15.2071C9.5417 15.9559 10.1127 17.3564 10.4967 18.7292C10.6812 19.3884 10.81 19.9939 10.8927 20.4348C10.9339 20.6546 10.9633 20.8321 10.9822 20.953C10.9917 21.0134 10.9985 21.0596 11.0029 21.0899L11.0075 21.123L11.0085 21.1301L11.0086 21.1307C11.0086 21.1308 11.0086 21.1309 11.0086 21.131C11.0086 21.131 11.0086 21.131 11.0086 21.131C11.0743 21.6283 11.4983 22 12 22C12.5017 22 12.9257 21.6283 12.9914 21.131L12.9914 21.1307L12.9915 21.1301L12.9925 21.123L12.9971 21.0899C13.0015 21.0596 13.0083 21.0134 13.0178 20.953C13.0367 20.8321 13.0661 20.6546 13.1073 20.4348C13.19 19.9939 13.3188 19.3884 13.5033 18.7292C13.8873 17.3564 14.4583 15.9559 15.2071 15.2071C15.9559 14.4583 17.3564 13.8873 18.7292 13.5033C19.3884 13.3188 19.9939 13.19 20.4348 13.1073C20.6546 13.0661 20.8321 13.0367 20.953 13.0178C21.0134 13.0083 21.0596 13.0015 21.0899 12.9971L21.123 12.9925L21.1301 12.9915L21.1307 12.9914C21.1308 12.9914 21.1309 12.9914 21.131 12.9914C21.131 12.9914 21.131 12.9914 21.131 12.9914C21.6283 12.9257 22 12.5017 22 12C22 11.4983 21.6283 11.0743 21.131 11.0086L21.1307 11.0086L21.1301 11.0085L21.123 11.0075L21.0899 11.0029C21.0596 10.9985 21.0134 10.9917 20.953 10.9822C20.8321 10.9633 20.6546 10.9339 20.4348 10.8927C19.9939 10.81 19.3884 10.6812 18.7292 10.4967C17.3564 10.1127 15.9559 9.5417 15.2071 8.79289C14.4583 8.04408 13.8873 6.64363 13.5033 5.27082C13.3188 4.61161 13.19 4.00611 13.1073 3.56523C13.0661 3.34537 13.0367 3.16792 13.0178 3.04699C13.0083 2.98656 13.0015 2.94035 12.9971 2.91013L12.9925 2.87704L12.9915 2.86992L12.9914 2.86932C12.9914 2.86923 12.9914 2.86913 12.9914 2.86904ZM16.8722 12C15.7644 11.5928 14.6021 11.0163 13.7929 10.2071C12.9837 9.39792 12.4072 8.23564 12 7.12776C11.5928 8.23564 11.0163 9.39792 10.2071 10.2071C9.39792 11.0163 8.23564 11.5928 7.12776 12C8.23564 12.4072 9.39792 12.9837 10.2071 13.7929C11.0163 14.6021 11.5928 15.7644 12 16.8722C12.4072 15.7644 12.9837 14.6021 13.7929 13.7929C14.6021 12.9837 15.7644 12.4072 16.8722 12Z" fill="currentColor"></path>
      </g>
    </svg>
  `;

  // Use rect from the selection range itself
  floatingButton.style.position = "absolute";
  // Position near bottom-right of the selection box
  floatingButton.style.left = `${window.scrollX + rect.right}px`;
  floatingButton.style.top = `${window.scrollY + rect.bottom + 5}px`; // Add small offset below
  floatingButton.style.zIndex = "9999"; // Try to keep it on top

  floatingButton.onclick = (e) => {
    e.stopPropagation(); // Prevent click from bubbling up
    console.log("Floating button clicked. Sending text:", selectedText);
    if (selectedText) {
       chrome.runtime.sendMessage({
         action: "setSelectedText",
         payload: { text: selectedText }
       })
       .then(() => {
         console.log("Message sent to background with selected text.");
         // Optionally, send a message to OPEN the popup here,
         // but usually, the background script handles this better or
         // the user opens it manually after clicking.
         // chrome.runtime.sendMessage({ action: 'openPopup' });
       })
       .catch(error => {
         console.error("Error sending selected text message:", error);
       });
    }
    removeFloatingButton(); // Remove button after click
  };

  document.body.appendChild(floatingButton);
}

function removeFloatingButton() {
  if (floatingButton) {
    floatingButton.remove();
    floatingButton = null;
  }
}

document.addEventListener("mouseup", () => {
  setTimeout(() => { // Use setTimeout to allow selection object to update
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const text = range.toString().trim();

      if (text.length > 0) {
        selectedText = text;
        console.log("Text selected:", selectedText);
        showFloatingButton(range);
      } else {
        // If selection is cleared or empty
        selectedText = "";
        removeFloatingButton();
      }
    } else {
       selectedText = "";
       removeFloatingButton();
    }
  }, 0);
});

// Remove button if user clicks elsewhere
document.addEventListener("mousedown", (event) => {
  if (floatingButton && !floatingButton.contains(event.target as Node)) {
    removeFloatingButton();
    selectedText = ""; // Clear selected text if clicking away
  }
});

// Remove button if selection changes explicitly
document.addEventListener("selectionchange", () => {
   // More complex logic might be needed here if selectionchange fires too often
   // For now, rely on mouseup and mousedown primarily
   // console.log("Selection changed");
   // Basic check: if no text is selected, remove the button
   const selection = window.getSelection();
   if (floatingButton && (!selection || selection.toString().trim().length === 0)) {
        //console.log("Selection cleared, removing button");
        removeFloatingButton();
        selectedText = "";
   }
});

console.log("Content script event listeners attached."); 