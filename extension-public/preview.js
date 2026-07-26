(() => {
  const body = document.body;
  chrome.runtime.sendMessage({ type: 'ELEMENT_SHOT_PREVIEW_READY' });
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'ELEMENT_SHOT_SET_PREVIEW_DATA' || typeof message.dataUrl !== 'string') {
      return;
    }
    const image = document.createElement('img');
    image.alt = 'Screenshot preview';
    image.src = message.dataUrl;
    body.replaceChildren(image);
  });
})();
