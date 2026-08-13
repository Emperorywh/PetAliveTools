import { contextBridge } from 'electron'

// Preload script — exposes a controlled API surface to the renderer.
// IPC channels will be wired here as features are implemented.
contextBridge.exposeInMainWorld('petalive', {
  version: '0.1.0'
})
