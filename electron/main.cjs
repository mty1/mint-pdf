const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')

const debugPort = process.env.MINT_PDF_REMOTE_DEBUG_PORT

if (debugPort) {
  app.commandLine.appendSwitch('remote-debugging-port', debugPort)
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: '薄荷PDF',
    backgroundColor: '#17362c',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../build/icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.MINT_PDF_DEBUG === '1') {
    win.webContents.on('console-message', (_event, details) => {
      console.log(`[renderer:${details.level}] ${details.message}`)
    })

    win.webContents.on('did-fail-load', (_event, code, description, url) => {
      console.error(`[did-fail-load] ${code} ${description} ${url}`)
    })

    win.webContents.once('did-finish-load', async () => {
      const snapshot = await win.webContents.executeJavaScript(`
        JSON.stringify({
          title: document.title,
          appChildren: document.querySelector('#app')?.children.length ?? 0,
          bodyText: document.body.innerText.slice(0, 200)
        })
      `)
      console.log(`[mint-pdf-debug] ${snapshot}`)
    })
  }

  win.loadFile(path.join(__dirname, '../dist/index.html'))
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
