// Renderer entry point — loaded by the BrowserWindow.
// Rendering, interaction, and audio modules will be wired here in subsequent tasks.

const app = document.getElementById('app')
if (app) {
  app.innerHTML = '<h1>PetAliveTools</h1><p>桌面宠物 · 项目脚手架已就绪</p>'
}
