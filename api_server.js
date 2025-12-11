const http = require('http');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const db = require('./db');
const config = require('./config');


const DB_PATH = path.resolve(__dirname, 'finance.db');
const HOST = '127.0.0.1'; 
const PORT = 4000;

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, err => err ? reject(err) : null);
    db.all(sql, params, (err, rows) => { db.close(); err ? reject(err) : resolve(rows); });
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, err => err ? reject(err) : null);
    db.run(sql, params, function(err) { 
        db.close(); 
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
            const transactions = await dbAll('SELECT * FROM transactions ORDER BY date DESC');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(transactions));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB Error' })); }
    } 
    
    // 2. Категории (Исправленный баг: объединяем БД + Конфиг)
    else if (req.url === '/categories' && req.method === 'GET') {
        try {
            // Берем из базы
            const dbCats = await dbAll('SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL AND category != "Перевод"');
            const dbCatList = dbCats.map(c => c.category);
            
            // Берем из конфига (разворачиваем массивы)
            const configCats = [...config.EXPENSE_CATEGORIES.flat(), ...config.INCOME_CATEGORIES.flat()].map(c => c.split(' (')[0]);
            
            // Объединяем и убираем дубликаты
            const allCats = [...new Set([...dbCatList, ...configCats])].sort();
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(allCats));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB Error' })); }
    }

    // 3. Балансы счетов (НОВОЕ)
    else if (req.url === '/balances' && req.method === 'GET') {
        try {
            // 1. Получаем счета
            const accounts = await dbAll('SELECT name, is_deposit FROM accounts');
            const balances = {};
            accounts.forEach(a => balances[a.name] = 0);
            if (!balances['Основной']) balances['Основной'] = 0;

            // 2. Считаем сумму по транзакциям
            const txs = await dbAll('SELECT type, amount, source_account, target_account FROM transactions');
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
                
                await dbRun(`UPDATE transactions SET amount = ?, category = ?, comment = ?, tag = ? WHERE id = ?`, [amount, category, comment, tag, id]);
                
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
            // ВАЖНО: Используем require('./db'), который мы подключили в начале файла
            // Если в начале api_server.js не было const db = require('./db'); - добавь!
            // Но у тебя там уже есть require('./config')...
            // Лучше всего в api_server.js заменить подключение sqlite3 вручную на использование db.js
            
            // НО ЧТОБЫ БЫСТРО:
            // В db.js мы экспортировали getStudents. Нам нужно его вызвать.
            // Давай лучше перепишем этот блок на использование dbRun/dbAll ИЗ api_server.js, но с правильным SQL
            // Так будет надежнее без полной переделки импортов.
            
            const students = await dbAll('SELECT * FROM students ORDER BY name ASC');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(students));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    }
    
    else if (req.url === '/students/action' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const action = data.action; 
                
                if (action === 'add') {
                    // Используем dbRun локальный, но SQL как в db.js
                    await dbRun(
                        `INSERT INTO students (name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                        [data.name, data.subject, data.parents, data.school, data.grade, data.teacher, data.phone, data.address, data.notes, data.parent_phone]
                    );
                } else if (action === 'edit') {
                    await dbRun(
                        `UPDATE students SET name=?, subject=?, parents=?, school=?, grade=?, teacher=?, phone=?, address=?, notes=?, parent_phone=? 
                         WHERE id=?`, 
                        [data.name, data.subject, data.parents, data.school, data.grade, data.teacher, data.phone, data.address, data.notes, data.parent_phone, data.id]
                    );
                } else if (action === 'delete') {
                    await dbRun('DELETE FROM students WHERE id = ?', [data.id]);
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { 
                console.error('Ошибка сохранения студента:', e);
                res.writeHead(500); res.end(JSON.stringify({ error: e.message })); 
            }
        });
    }
    // --- СПИСОК ПОКУПОК ---
    
    // Получить список
    else if (req.url === '/shopping' && req.method === 'GET') {
        try {
            const list = await db.getShoppingList(); // Используем функцию из db.js
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(list));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    }
    
    // Действия (Добавить, Купить/Удалить)
    else if (req.url === '/shopping/action' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                
                if (data.action === 'add') {
                    await db.addShoppingItem(data);
                } else if (data.action === 'status') {
                    await db.updateShoppingStatus(data.id, data.status);
                } else if (data.action === 'reorder') {
                    // НОВОЕ: Пересортировка
                    // data.ids должен быть массивом ID
                    await db.reorderShoppingList(data.ids);
                }

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
