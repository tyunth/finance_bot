const http = require('http');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.resolve(__dirname, 'finance.db');

const HOST = '127.0.0.1'; // Слушаем только локальный хост (Nginx будет проксировать)
const PORT = 4000;

// Промисификация dbAll для выборки данных (SELECT)
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
        if (err) return reject(err);
    });
    db.all(sql, params, (err, rows) => {
        db.close();
        if (err) return reject(err);
        resolve(rows);
    });
});

// НОВАЯ ФУНКЦИЯ: Промисификация dbRun для выполнения (INSERT, UPDATE, DELETE)
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
        if (err) return reject(err);
    });
    db.run(sql, params, function(err) { // Используем function(err) для доступа к this.changes
        db.close();
        if (err) return reject(err);
        resolve({ changes: this.changes, lastID: this.lastID });
    });
});


const server = http.createServer(async (req, res) => {
    // Разрешаем CORS (критично для доступа с браузера)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); // Добавили POST
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // 1. GET /transactions (Получение всех транзакций)
    if (req.url === '/transactions' && req.method === 'GET') {
        try {
            const transactions = await dbAll('SELECT * FROM transactions ORDER BY date DESC');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(transactions));
        } catch (e) {
            console.error('Ошибка API при чтении транзакций:', e);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Database read failed' }));
        }
    } 
    // 2. GET /categories (Получение уникальных категорий для выпадающего списка)
    else if (req.url === '/categories' && req.method === 'GET') {
        try {
            const categories = await dbAll('SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL AND category != "Перевод" ORDER BY category ASC');
            const categoryNames = categories.map(row => row.category);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(categoryNames));
        } catch (e) {
             res.writeHead(500, { 'Content-Type': 'application/json' });
             res.end(JSON.stringify({ error: 'Failed to fetch categories.', details: e.message }));
        }
    }
    // 3. POST /transactions/edit (Редактирование транзакции)
    else if (req.url === '/transactions/edit' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                // Требуемые поля для обновления
                const { id, amount, category, comment } = data; 

                if (!id || !amount || !category || typeof comment === 'undefined') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields: id, amount, category, or comment.' }));
                    return;
                }

                // Выполняем UPDATE в базе данных
                const sql = `
                    UPDATE transactions 
                    SET 
                        amount = ?, 
                        category = ?, 
                        comment = ?,
                        updated_at = datetime('now', 'localtime')
                    WHERE 
                        id = ?
                `;
                const params = [amount, category, comment, id];

                const result = await dbRun(sql, params);

                if (result.changes === 0) {
                     res.writeHead(404, { 'Content-Type': 'application/json' });
                     res.end(JSON.stringify({ message: 'Transaction ID not found or no changes made.' }));
                     return;
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Transaction updated successfully.', id: id, changes: result.changes }));

            } catch (e) {
                console.error('Ошибка API при редактировании транзакции:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to update transaction.', details: e.message }));
            }
        });
    }
    // 4. 404/Неподдерживаемый маршрут
    else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Endpoint not found or method not allowed' }));
    }
});

server.listen(PORT, HOST, () => {
    console.log(`API Server running at http://${HOST}:${PORT}/`);
    console.log(`Endpoints: /transactions (GET), /categories (GET), /transactions/edit (POST)`);
});