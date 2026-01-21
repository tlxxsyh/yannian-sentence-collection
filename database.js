const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

// --- 路径处理逻辑 ---
let dbPath;

// 获取用户数据目录 (兼容开发环境和打包环境)
if (app.isPackaged) {
    // 生产环境：C:\Users\用户名\AppData\Roaming\言念句子库\inkwell.db
    // 这样可以保证数据库可读写，且更新软件数据不丢失
    const userDataPath = app.getPath('userData');
    
    // 确保目录存在
    if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
    }
    
    dbPath = path.join(userDataPath, 'inkwell.db');
} else {
    // 开发环境：直接保存在项目根目录
    dbPath = path.join(__dirname, 'inkwell.db');
}

console.log("当前数据库路径:", dbPath);
const db = new Database(dbPath);

// 1. 初始化表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    author TEXT,
    source TEXT,
    type TEXT,
    nationality TEXT,
    dynasty TEXT,
    translation TEXT,
    tags TEXT,
    note TEXT, 
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// --- 预设数据注入 ---
const count = db.prepare('SELECT count(*) as c FROM quotes').get().c;
if (count === 0) {
    const presetQuotes = [
        {
            content: "Nobody grows old merely by a number of years.\nWe grow old by deserting our ideals.",
            author: "塞缪尔·厄尔曼",
            source: "青春",
            dynasty: "",
            nationality: "美国",
            type: "散文",
            tags: "青春,年岁,理想",
            note: "我很喜欢这句话，也送给使用这个软件的你",
            translation: "年岁增长，并非衰老，理想丢弃，方坠暮年。"
        }
    ];

    const insert = db.prepare(`
        INSERT INTO quotes (content, author, source, type, nationality, dynasty, translation, tags, note)
        VALUES (@content, @author, @source, @type, @nationality, @dynasty, @translation, @tags, @note)
    `);

    const importTransaction = db.transaction((quotes) => {
        for (const q of quotes) insert.run(q);
    });

    importTransaction(presetQuotes);
    console.log("已写入预设数据");
}

// 2. 基础 CRUD 操作
function addQuote(data) {
  const stmt = db.prepare(`
    INSERT INTO quotes (content, author, source, type, nationality, dynasty, translation, tags, note)
    VALUES (@content, @author, @source, @type, @nationality, @dynasty, @translation, @tags, @note)
  `);
  return stmt.run(data);
}

function deleteQuote(id) {
  return db.prepare('DELETE FROM quotes WHERE id = ?').run(id);
}

function updateQuote(data) {
  const stmt = db.prepare(`
    UPDATE quotes 
    SET content = @content, author = @author, source = @source, 
        type = @type, nationality = @nationality, dynasty = @dynasty, 
        translation = @translation, tags = @tags, note = @note
    WHERE id = @id
  `);
  return stmt.run(data);
}

function getQuotes() {
  // 移除 SQL 中的 ORDER BY，改为在 JS 中排序
  const quotes = db.prepare('SELECT * FROM quotes').all();
  
  // 使用 JavaScript 的 Date 对象进行排序，完美解决格式不一致的问题
  return quotes.sort((a, b) => {
      const dateA = new Date(a.created_at);
      const dateB = new Date(b.created_at);
      // 倒序排列：新时间 (b) - 旧时间 (a)
      return dateB - dateA;
  });
}

function getRandomQuote(excludeId) {
  if (excludeId) {
      const count = db.prepare('SELECT count(*) as c FROM quotes').get().c;
      if (count > 1) {
          return db.prepare('SELECT * FROM quotes WHERE id != ? ORDER BY RANDOM() LIMIT 1').get(excludeId);
      }
  }
  return db.prepare('SELECT * FROM quotes ORDER BY RANDOM() LIMIT 1').get();
}

function checkContentExists(content) {
    return db.prepare('SELECT id FROM quotes WHERE content = ?').get(content);
}

function clearAllQuotes() {
    return db.exec("DELETE FROM quotes; DELETE FROM sqlite_sequence WHERE name='quotes';");
}

function importBulk(quotesArray) {
    const insert = db.prepare(`
        INSERT INTO quotes (content, author, source, type, nationality, dynasty, translation, tags, note, created_at)
        VALUES (@content, @author, @source, @type, @nationality, @dynasty, @translation, @tags, @note, @created_at)
    `);
    const importTransaction = db.transaction((quotes) => {
        for (const q of quotes) insert.run(q);
    });
    importTransaction(quotesArray);
    return quotesArray.length;
}

// 3. 搜索与联想
function getSuggestions(field, keyword) {
  if (!keyword) return [];
  const sql = `SELECT DISTINCT ${field} as value FROM quotes WHERE ${field} LIKE ? LIMIT 10`;
  return db.prepare(sql).all(`%${keyword}%`);
}

function advancedSearch(params) {
    let sql = 'SELECT * FROM quotes WHERE 1=1';
    const values = {};

    // 标签过滤
    if (params.searchTags) {
        let tags = [];
        if (Array.isArray(params.searchTags)) tags = params.searchTags;
        else if (typeof params.searchTags === 'string') tags = params.searchTags.split(/[,，]/).map(t => t.trim()).filter(t => t);

        if (tags.length > 0) {
            tags.forEach((tag, index) => {
                if (tag === '无标签') {
                    sql += ` AND (tags IS NULL OR tags = '')`;
                } else {
                    sql += ` AND tags LIKE @tagFilter${index}`;
                    values[`tagFilter${index}`] = `%${tag}%`;
                }
            });
        }
    }

    // 关键词过滤
    if (params.keyword && params.keyword.trim() !== '') {
        const kw = params.keyword.trim();
        if (params.mode === 'fulltext') {
            sql += ` AND (content LIKE @kw OR author LIKE @kw OR source LIKE @kw OR type LIKE @kw OR dynasty LIKE @kw OR nationality LIKE @kw OR tags LIKE @kw OR note LIKE @kw)`;
            values.kw = `%${kw}%`;
        } else if (params.mode === 'single' && params.field) {
            sql += ` AND ${params.field} LIKE @kw`;
            values.kw = `%${kw}%`;
        }
    }
    
    // 自定义组合
    if (params.mode === 'custom') {
        if (params.content) { sql += ' AND content LIKE @content'; values.content = `%${params.content}%`; }
        if (params.author) { sql += ' AND author LIKE @author'; values.author = `%${params.author}%`; }
        if (params.type) { sql += ' AND type LIKE @type'; values.type = `%${params.type}%`; }
        if (params.source) { sql += ' AND source LIKE @source'; values.source = `%${params.source}%`; }
        if (params.dynasty) { sql += ' AND dynasty LIKE @dynasty'; values.dynasty = `%${params.dynasty}%`; }
        if (params.nationality) { sql += ' AND nationality LIKE @nationality'; values.nationality = `%${params.nationality}%`; }
    }

    sql += ' ORDER BY created_at DESC';
    return db.prepare(sql).all(values);
}

// 4. 分类统计
function getCategoryStats(field) {
    if (field === 'tags') {
        const allRows = db.prepare("SELECT tags FROM quotes").all();
        const tagCounts = {};
        let noTagCount = 0;

        allRows.forEach(row => {
            if (!row.tags || row.tags.trim() === '') {
                noTagCount++;
            } else {
                const tags = row.tags.split(/[,，]/);
                tags.forEach(t => {
                    const tag = t.trim();
                    if (tag) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                });
            }
        });

        const result = Object.entries(tagCounts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
        
        if (noTagCount > 0) {
            result.unshift({ name: '无标签', count: noTagCount });
        }
        
        return result;
    } else {
        const sql = `
            SELECT ${field} as name, COUNT(*) as count 
            FROM quotes 
            WHERE ${field} IS NOT NULL AND ${field} != '' 
            GROUP BY ${field} 
            ORDER BY count DESC
        `;
        return db.prepare(sql).all();
    }
}

module.exports = { 
    addQuote, getQuotes, getRandomQuote, deleteQuote, updateQuote, 
    getSuggestions, checkContentExists, advancedSearch,
    importBulk, clearAllQuotes, getCategoryStats 
};