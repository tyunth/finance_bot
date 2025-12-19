const http = require('http');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// --- ВАЖНО: Подключаем наш модуль базы данных ---
const db = require('./db'); 
const config = require('./config');

const DB_PATH = path.resolve(__dirname, 'finance.db');
const HOST = '127.0.0.1'; 
const PORT = 4000;

// Локальные хелперы для старых маршрутов
const dbAllLocal = (sql, params = []) => new Promise((resolve, reject) => {
    const database = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, err => err ? reject(err) : null);
    database.all(sql, params, (err, rows) => { database.close(); err ? reject(err) : resolve(rows); });
});

const dbRunLocal = (sql, params = []) => new Promise((resolve, reject) => {
    const database = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, err => err ? reject(err) : null);
    database.run(sql, params, function(err) { 
        database.close(); 
        err ? reject(err) : resolve({ changes: this.changes, lastID: this.lastID }); 
    });
});

const serveStatic = (res, filePath, contentType) => {
    const fullPath = path.join(__dirname, filePath);
    fs.readFile(fullPath, (err, content) => {
        if (err) {
            res.writeHead(500); res.end(`Server Error: Could not load ${filePath}`);
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
};

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // --- STATIC ---
    if (req.url === '/' && req.method === 'GET') serveStatic(res, 'index.html', 'text/html');
    else if (req.url === '/app.js' && req.method === 'GET') serveStatic(res, 'app.js', 'application/javascript');
    else if (req.url === '/style.css' && req.method === 'GET') serveStatic(res, 'style.css', 'text/css');
    
    // --- API ---

    // 1. Транзакции
    else if (req.url === '/transactions' && req.method === 'GET') {
        try {
            const transactions = await dbAllLocal('SELECT * FROM transactions ORDER BY date DESC');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(transactions));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB Error' })); }
    } 
    
    // 2. Категории
    else if (req.url === '/categories' && req.method === 'GET') {
        try {
            const dbCats = await dbAllLocal('SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL AND category != "Перевод"');
            const dbCatList = dbCats.map(c => c.category);
            const configCats = [...config.EXPENSE_CATEGORIES.flat(), ...config.INCOME_CATEGORIES.flat()].map(c => c.split(' (')[0]);
            const allCats = [...new Set([...dbCatList, ...configCats])].sort();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(allCats));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB Error' })); }
    }

    // 3. Балансы счетов
    else if (req.url === '/balances' && req.method === 'GET') {
        try {
            const accounts = await dbAllLocal('SELECT name, is_deposit FROM accounts');
            const balances = {};
            accounts.forEach(a => balances[a.name] = 0);
            if (!balances['Основной']) balances['Основной'] = 0;
            const txs = await dbAllLocal('SELECT type, amount, source_account, target_account FROM transactions');
            txs.forEach(t => {
                if (t.type === 'income' && t.target_account) balances[t.target_account] = (balances[t.target_account] || 0) + t.amount;
                else if (t.type === 'expense' && t.source_account) balances[t.source_account] = (balances[t.source_account] || 0) - t.amount;
                else if (t.type === 'transfer') {
                    if (t.source_account) balances[t.source_account] = (balances[t.source_account] || 0) - t.amount;
                    if (t.target_account) balances[t.target_account] = (balances[t.target_account] || 0) + t.amount;
                }
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(balances));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    }

    // 4. Редактирование
    else if (req.url === '/transactions/edit' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { id, amount, category, comment, tag } = JSON.parse(body);
                if (!id || !amount) throw new Error('No Data');
                await dbRunLocal(`UPDATE transactions SET amount = ?, category = ?, comment = ?, tag = ? WHERE id = ?`, [amount, category, comment, tag, id]);
                if (comment && category) {
                    const dbWrite = new sqlite3.Database(DB_PATH);
                    dbWrite.run('INSERT OR REPLACE INTO keywords (keyword, category) VALUES (?, ?)', [comment.trim().toLowerCase(), category]);
                    dbWrite.close();
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
    }
    
    // --- УЧЕНИКИ ---
    else if (req.url === '/students' && req.method === 'GET') {
        try {
            const students = await db.getStudents();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(students));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    }
    
    // Действия с учениками
    else if (req.url === '/students/action' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (data.action === 'add') await db.addStudent(data);
                else if (data.action === 'edit') await db.updateStudent(data);
                else if (data.action === 'delete') await db.deleteStudent(data.id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
    }

    // Статистика ученика
    else if (req.url.startsWith('/students/stats') && req.method === 'GET') {
        try {
            const urlParts = new URL(req.url, `http://${req.headers.host}`);
            const id = urlParts.searchParams.get('id');
            if (!id) throw new Error('No ID provided');

            // Берем все поля ученика (включая lessons_per_week)
            const student = await db.dbGet('SELECT * FROM students WHERE id = ?', [id]);
            if (!student) throw new Error('Student not found');

            const transactions = await db.getStudentStats(student.name);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ student: student, transactions: transactions }));
        } catch (e) { 
            console.error(e);
            res.writeHead(500); res.end(JSON.stringify({ error: e.message })); 
        }
    }

    // --- СПИСОК ПОКУПОК ---
    else if (req.url === '/shopping' && req.method === 'GET') {
        try {
            const list = await db.getShoppingList();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(list));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    }
    
    else if (req.url === '/shopping/action' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (data.action === 'add') await db.addShoppingItem(data);
                else if (data.action === 'status') await db.updateShoppingStatus(data.id, data.status);
                else if (data.action === 'reorder') await db.reorderShoppingList(data.ids);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
    }

    // --- КОММУНАЛКА (НОВОЕ) ---
    else if (req.url === '/utilities' && req.method === 'GET') {
        try {
            const list = await db.getUtilityReadings();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(list));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    }
    
    else if (req.url === '/utilities/action' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (data.action === 'add') await db.addUtilityReading(data);
                else if (data.action === 'delete') await db.deleteUtilityReading(data.id);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
    }
        
    else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
    }
});

server.listen(PORT, HOST, () => {
    console.log(`Finance Server running at http://${HOST}:${PORT}/`);
});
