// Options page logic

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveButton')?.addEventListener('click', saveOptions);

function saveOptions() {
  const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
  const status = document.getElementById('status');
  const apiKey = apiKeyInput?.value;

  if (!apiKey) {
    if (status) status.textContent = 'API Key cannot be empty.';
    return;
  }

  chrome.storage.local.set({
    groqApiKey: apiKey
  }, () => {
    // Update status to let user know options were saved.
    if (status) {
      status.textContent = 'Options saved.';
      setTimeout(() => {
        status.textContent = '';
      }, 1500);
    }
  });
}

function restoreOptions() {
  chrome.storage.local.get(['groqApiKey'], (result) => {
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
    if (apiKeyInput && result.groqApiKey) {
      apiKeyInput.value = result.groqApiKey;
    }
  });
} 