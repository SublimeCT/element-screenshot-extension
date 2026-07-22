export function prepareFixture(targetSelector: string, scrollTop: number): void {
  const target = document.querySelector<HTMLElement>(targetSelector);
  if (!target) {
    throw new Error(`Fixture target is missing: ${targetSelector}`);
  }

  target.scrollTop = scrollTop;

  const pickerScript = document.createElement('script');
  pickerScript.src = browser.runtime.getURL('/element-picker.js');
  pickerScript.addEventListener(
    'load',
    () => {
      document.documentElement.dataset.fixtureReady = 'true';
    },
    { once: true },
  );
  pickerScript.addEventListener(
    'error',
    () => {
      throw new Error('Element picker fixture script failed to load.');
    },
    { once: true },
  );
  document.head.append(pickerScript);
}
