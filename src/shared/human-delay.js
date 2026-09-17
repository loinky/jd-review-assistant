globalThis.JDRAHumanDelay = (() => {
  const MIN_DELAY_MS = 3000;
  const MAX_DELAY_MS = 5000;

  function randomUnit() {
    if (globalThis.crypto?.getRandomValues) {
      const value = new Uint32Array(1);
      globalThis.crypto.getRandomValues(value);
      return value[0] / 0x100000000;
    }
    return Math.random();
  }

  function getRandomDelay() {
    return (
      MIN_DELAY_MS +
      Math.floor(randomUnit() * (MAX_DELAY_MS - MIN_DELAY_MS + 1))
    );
  }

  function wait() {
    return new Promise((resolve) => globalThis.setTimeout(resolve, getRandomDelay()));
  }

  return Object.freeze({ MIN_DELAY_MS, MAX_DELAY_MS, getRandomDelay, wait });
})();
