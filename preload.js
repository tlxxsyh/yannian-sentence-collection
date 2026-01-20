const { contextBridge, ipcRenderer } = require('electron');

// 建立桥梁，将 ipcRenderer 的功能暴露给 window.api
contextBridge.exposeInMainWorld('api', {
    // 1. 获取/操作句子
    getQuotes: () => ipcRenderer.invoke('get-quotes'),
    addQuote: (data) => ipcRenderer.invoke('add-quote', data),
    updateQuote: (data) => ipcRenderer.invoke('update-quote', data),
    deleteQuote: (id) => ipcRenderer.invoke('delete-quote', id),
    getRandomQuote: (excludeId) => ipcRenderer.invoke('get-random-quote', excludeId),
    
    // 2. 搜索与工具
    getSuggestions: (field, keyword) => ipcRenderer.invoke('get-suggestions', field, keyword),
    checkDuplicate: (content) => ipcRenderer.invoke('check-duplicate', content),
    advancedSearch: (params) => ipcRenderer.invoke('advanced-search', params),
    getCategoryStats: (field) => ipcRenderer.invoke('get-category-stats', field),
    
    // 3. 数据管理
    importData: () => ipcRenderer.invoke('import-data'),
    exportData: () => ipcRenderer.invoke('export-data'),
    clearAllData: () => ipcRenderer.invoke('clear-all-data')
});