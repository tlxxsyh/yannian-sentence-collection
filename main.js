const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./database.js');
// 引入 CSV 处理库
const { parse } = require('csv-parse/sync'); 
const { stringify } = require('csv-stringify/sync');

let mainWindow;
let splashWindow;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    show: true,
    icon: path.join(__dirname, 'assets/icon.ico'),
    webPreferences: { nodeIntegration: false }
  });
  splashWindow.loadFile('splash.html');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#f5f7fa',
    icon: path.join(__dirname, 'assets/icon.ico'),
    // 隐藏菜单栏
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true,
      webSecurity: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
    mainWindow.show();
  });
  
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createSplashWindow();
  createMainWindow();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC 接口 ---

ipcMain.handle('get-quotes', async () => db.getQuotes());
ipcMain.handle('add-quote', async (event, data) => db.addQuote(data));
ipcMain.handle('update-quote', async (event, data) => db.updateQuote(data));
ipcMain.handle('delete-quote', async (event, id) => db.deleteQuote(id));
ipcMain.handle('get-random-quote', async (event, excludeId) => db.getRandomQuote(excludeId));
ipcMain.handle('get-suggestions', async (event, field, keyword) => db.getSuggestions(field, keyword));
ipcMain.handle('check-duplicate', async (event, content) => !!db.checkContentExists(content));
ipcMain.handle('advanced-search', async (event, params) => db.advancedSearch(params));
ipcMain.handle('clear-all-data', async () => { db.clearAllQuotes(); return { success: true }; });
ipcMain.handle('get-category-stats', async (event, field) => db.getCategoryStats(field));

// --- 导出功能 ---
ipcMain.handle('export-data', async () => {
  const quotes = db.getQuotes();
  if (quotes.length === 0) return { success: false, message: "库中没有数据可导出" };

  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '导出句子数据',
    defaultPath: 'inkwell_backup.csv',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });

  if (filePath) {
    try {
      // 导出时保留 Title Case (首字母大写) 的表头，为了美观
      const csvContent = stringify(quotes, { 
          header: true,
          columns: [
            { key: 'content', header: 'Content' },
            { key: 'author', header: 'Author' },
            { key: 'type', header: 'Type' },
            { key: 'source', header: 'Source' },
            { key: 'dynasty', header: 'Dynasty' },
            { key: 'nationality', header: 'Nationality' },
            { key: 'tags', header: 'Tags' },
            { key: 'note', header: 'Note' },
            { key: 'translation', header: 'Translation' },
            { key: 'created_at', header: 'CreatedAt' }
          ] 
      });
      // 写入 BOM 头，防止 Excel 打开乱码
      fs.writeFileSync(filePath, '\uFEFF' + csvContent, 'utf8');
      return { success: true, message: `成功导出 ${quotes.length} 条数据` };
    } catch (err) {
      return { success: false, message: "导出失败：" + err.message };
    }
  }
  return { success: false, message: "取消导出" };
});

// --- 导入功能 (核心修复) ---
ipcMain.handle('import-data', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '导入句子数据',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    properties: ['openFile']
  });

  if (filePaths && filePaths.length > 0) {
    try {
      const fileContent = fs.readFileSync(filePaths[0], 'utf8');
      
      // 核心修复逻辑：
      // 1. bom: true -> 自动去除 Excel 的 BOM 头
      // 2. columns: x => x.toLowerCase() -> 自动将 Content 转为 content，匹配数据库字段
      const records = parse(fileContent, {
        columns: header => header.map(column => column.trim().toLowerCase()), 
        bom: true, 
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true // 允许稍微不规范的引号
      });

      if (records.length === 0) return { success: false, message: "文件中没有有效数据" };

      // 验证关键字段是否存在
      if (!records[0].hasOwnProperty('content')) {
          return { success: false, message: "导入失败：找不到 'Content' 列，请检查表头拼写。" };
      }

      // 补全缺失字段，防止数据库报错
      const sanitizedRecords = records.map(r => {
          // 尝试标准化日期格式
          let validDate;
          try {
              // 如果有日期字符串，尝试转换成标准 ISO 格式 (YYYY-MM-DDTHH:mm:ss.sssZ)
              if (r.createdat) {
                  const d = new Date(r.createdat);
                  // 检查是否为有效日期
                  if (!isNaN(d.getTime())) {
                      validDate = d.toISOString(); 
                  }
              }
          } catch (e) {
              // 忽略日期转换错误
          }

          return {
              content: r.content,
              author: r.author || '',
              source: r.source || '',
              type: r.type || '',
              nationality: r.nationality || '',
              dynasty: r.dynasty || '',
              translation: r.translation || '',
              tags: r.tags || '',
              note: r.note || '',
              // 使用标准化后的日期，或者当前时间
              created_at: validDate || new Date().toISOString()
          };
      });

      const count = db.importBulk(sanitizedRecords);
      return { success: true, message: `成功导入 ${count} 条数据！` };
    } catch (err) {
      console.error(err);
      return { success: false, message: "导入失败：" + err.message };
    }
  }
  return { success: false, message: "取消导入" };
});