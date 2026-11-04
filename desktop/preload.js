// Runs in an isolated, sandboxed context. The page gets no Node access, only this flag.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("pdfmasterDesktop", { isDesktop: true, platform: process.platform });
