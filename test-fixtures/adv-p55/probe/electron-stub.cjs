// Adversary probe stub: enough of the electron module surface for the Phase-55
// main-process modules to be bundled and required outside Electron. No product
// code is modified; the stub is passed to esbuild via --alias:electron=...
module.exports = {
  app: { getPath: () => require('node:os').tmpdir() },
  BrowserWindow: class {},
  session: { fromPartition: () => ({ webRequest: { onBeforeRequest() {} }, setPermissionRequestHandler() {} }) },
  ipcMain: { handle() {} },
};
