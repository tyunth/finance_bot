const http = require('http');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs'); // <--- 1. ВАЖНО: Добавили модуль для чтения файлов

const DB_PATH = path.resolve(__dirname, 'finance.db');
const HOST = '127.0.0.1'; 
const PORT = 4000;

// Хелперы для БД
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, err => err ? reject(err) : null);
    db.all(sql, params, (err, rows) => { db.close(); err ? reject(err) : resolve(rows); });
});

// Исправленный dbRun (для UPDATE/INSERT)
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, err => err ? reject(err) : null);
    db.run(sql, params, function(err) { 
        db.close(); 
        err ? reject(err) : resolve({ changes: this.changes, lastID: this.lastID }); 
    });
});

// <--- 2. ВАЖНО: Функция, которая читает HTML/JS файлы с диска и отправляет браузеру
const serveStatic = (res, filePath, contentType) => {
    const fullPath = path.join(__dirname, filePath);
    fs.readFile(fullPath, (err, content) => {
        if (err) {
            console.error(`Error serving ${filePath}:`, err);
            res.writeHead(500);
            res.end(`Server Error: Could not load ${filePath}`);
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
};

const server = http.createServer(async (req, res) => {
    // CORS (Разрешаем запросы, если вдруг будем стучаться с другого домена)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // --- 3. ВАЖНО: БЛОК РАЗДАЧИ СТАТИКИ (САЙТА) ---
    
    // Если просят корень сайта "/" -> отдаем index.html
    if (req.url === '/' && req.method === 'GET') {
        serveStatic(res, 'index.html', 'text/html');
    } 
    // Если просят скрипт "/app.js" -> отдаем app.js
    else if (req.url === '/app.js' && req.method === 'GET') {
        serveStatic(res, 'app.js', 'application/javascript');
    }
    
    // --- API (РАБОТА С ДАННЫМИ) ---

    // 1. GET /transactions
    else if (req.url === '/transactions' && req.method === 'GET') {
        try {
            const transactions = await dbAll('SELECT * FROM transactions ORDER BY date DESC');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(transactions));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB Error' })); }
    } 
    // 2. GET /categories
    else if (req.url === '/categories' && req.method === 'GET') {
        try {
            const cats = await dbAll('SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL AND category != "Перевод" ORDER BY category ASC');
            // Превращаем [{category: 'Еда'}, {category: 'Такси'}] в ['Еда', 'Такси']
            const catList = cats.map(c => c.category);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(catList));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB Error' })); }
    }
    // 3. POST /transactions/edit
else if (req.url === '/transactions/edit' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                // ДОБАВИЛИ tag в разбор
                const { id, amount, category, comment, tag } = JSON.parse(body);
                
                if (!id || !amount) throw new Error('No Data');
                
                // ОБНОВИЛИ SQL: добавили запись тега
                const sql = `UPDATE transactions SET amount = ?, category = ?, comment = ?, tag = ? WHERE id = ?`;
                
                await dbRun(sql, [amount, category, comment, tag, id]);
                
                // Обучение (опционально)
                if (comment && category) {
                    const dbWrite = new sqlite3.Database(DB_PATH);
                    dbWrite.run('INSERT OR REPLACE INTO keywords (keyword, category) VALUES (?, ?)', [comment.trim().toLowerCase(), category]);
                    dbWrite.close();
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { 
                console.error(e);
                res.writeHead(500); 
                res.end(JSON.stringify({ error: e.message })); 
            }
        });
    }
    // 404
    else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
    }
});

server.listen(PORT, HOST, () => {
    console.log(`Finance Server running at http://${HOST}:${PORT}/`);
});
