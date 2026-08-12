// Shim: translate the engine's window.webkit.messageHandlers.postMessage calls
// (written for Swift's WKWebView) into CustomEvents the web chrome can listen to.
window.webkit = window.webkit || {};
window.webkit.messageHandlers = new Proxy({}, {
  get(target, name) {
    if (!target[name]) {
      target[name] = {
        postMessage: (data) => {
          window.dispatchEvent(new CustomEvent('mdv:' + name, { detail: data }));
        }
      };
    }
    return target[name];
  }
});