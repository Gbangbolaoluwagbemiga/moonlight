// Shim for 'isomorphic-ws': the browser already provides a native WebSocket,
// but the upstream package's browser build only has a default export, which
// breaks static named-import analysis (`import { WebSocket } from
// 'isomorphic-ws'`) used by some of our dependencies. Provide both forms.
export const WebSocket = globalThis.WebSocket;
export default globalThis.WebSocket;
