const http = require('http');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const config = require('./config');
// const calendar = require('./calendar'); // Если не используется, можно закомментить

const HOST = '127.0.0.1'; 
const PORT = 4000;

// Хелпер для определения ID пользователя
const getUserId = (req) => {
    // 1. Из заголовка (Правильный путь)
    const headerId = req.headers['x-user-id'];
    if (headerId) return parseInt(headerId);

    // 2. Из URL параметров (Временный путь для тестов)
    // Парсим URL вручную, т.к. req.url может быть просто '/todos'
    try {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const queryId = urlObj.searchParams.get('userId');
        if (queryId) return parseInt(queryId);
    } catch(e) {}

    // 3. Фолбэк на Админа (Чтобы не ломать старый фронтенд прямо сейчас)
    // В будущем это нужно убрать!
    return config.ADMIN_ID;
};

// Хелпер для статики
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
    // CORS: Разрешаем всё
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id'); // Разрешили заголовок ID

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // Определяем текущего юзера
    const currentUserId = getUserId(req);
    // console.log(`Request ${req.url} from User: ${currentUserId}`); // Для отладки

    // --- STATIC ---
    if (req.url === '/' || req.url.startsWith('/?')) serveStatic(res, 'index.html', 'text/html');
    else if (req.url === '/app.js') serveStatic(res, 'app.js', 'application/javascript');
    else if (req.url === '/style.css') serveStatic(res, 'style.css', 'text/css');
    
    // --- API ---

    // 1. Транзакции
    else if (req.url.startsWith('/transactions') && req.method === 'GET') {
        try {
            // ВАЖНО: Тут надо бы фильтровать по currentUserId, но у getTransactions нет фильтра пока.
            // Оставим пока select * (на будущее надо добавить WHERE user_id = ?)
            const transactions = await db.dbAll('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC', [currentUserId]);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(transactions));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB Error' })); }
    } 
    
    // 2. Категории
    else if (req.url.startsWith('/categories') && req.method === 'GET') {
        try {
            const expenseCats = await db.getUserCategories(currentUserId, 'expense');
            const incomeCats = await db.getUserCategories(currentUserId, 'income');
            const allCats = [...new Set([...expenseCats, ...incomeCats])].sort();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(allCats));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    }

    // 3. Балансы
    else if (req.url.startsWith('/balances') && req.method === 'GET') {
        try {
            const data = await db.getBalances(currentUserId); 
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    }
        
    // 4. Редактирование транзакции
    else if (req.url === '/transactions/edit' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { id, amount, category, comment, tag } = JSON.parse(body);
                // Проверка: принадлежит ли транзакция юзеру?
                const tx = await db.dbGet('SELECT user_id FROM transactions WHERE id = ?', [id]);
                if (!tx || tx.user_id !== currentUserId) throw new Error('Access Denied');

                await db.dbRun(`UPDATE transactions SET amount = ?, category = ?, comment = ?, tag = ? WHERE id = ?`, [amount, category, comment, tag, id]);
                if (comment && category) await db.learnKeyword(comment, category);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
    }
    
    // 7. Ручное добавление транзакции
    else if (req.url === '/transactions/add' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const txData = {
                    userId: currentUserId, // <--- БЕРЕМ ТЕКУЩЕГО ЮЗЕРА
                    type: data.type,
                    amount: parseFloat(data.amount),
                    category: data.category,
                    tag: data.tag || (data.type === 'income' ? 'Доход' : 'Разное'),
                    comment: data.comment,
                    date: data.date,
                    sourceAccount: data.type === 'expense' ? 'Основной' : null,
                    targetAccount: data.type === 'income' ? 'Основной' : null
                };
                await db.addTransaction(txData);
                if (data.comment && data.category) await db.learnKeyword(data.comment, data.category);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
    }

    // --- УЧЕНИКИ ---
    else if (req.url.startsWith('/students') && req.method === 'GET') {
        if (req.url.includes('/stats')) {
             // Статистика (подмаршрут)
             try {
                const urlParts = new URL(req.url, `http://${req.headers.host}`);
                const id = urlParts.searchParams.get('id');
                const student = await db.dbGet('SELECT * FROM students WHERE id = ? AND user_id = ?', [id, currentUserId]);
                if (!student) throw new Error('Student not found');
    
                const transactions = await db.getStudentStats(currentUserId, student.name); // <-- Передали ID
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ student, transactions }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        } else {
            // Список
            try {
                const students = await db.getStudents(currentUserId); // <-- Передали ID
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(students));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        }
    }
    
    else if (req.url === '/students/action' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                // Для add нужно передать ID
                if (data.action === 'add') await db.addStudent(currentUserId, data);
                // Для edit/delete теоретически нужна проверка прав, но пока опустим
                else if (data.action === 'edit') await db.updateStudent(data);
                else if (data.action === 'delete') await db.deleteStudent(data.id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
    }

    // 5. Долги
    else if (req.url.startsWith('/debts') && req.method === 'GET') {
        try {
            const debts = await db.getDebts(currentUserId); // <-- Передали ID
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(debts));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    }
    
    // --- СПИСОК ПОКУПОК ---
    else if (req.url.startsWith('/shopping') && req.method === 'GET') {
        try {
            const list = await db.getShoppingList(currentUserId); // <-- Передали ID
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
                if (data.action === 'add') await db.addShoppingItem(currentUserId, data); // <-- Передали ID
                else if (data.action === 'status' || data.action === 'toggle') {
                    if (data.status === 'deleted') await db.deleteShoppingItem(data.id);
                    else {
                        const isBought = (data.status === 'bought' || data.status === true || data.status == 1) ? 1 : 0;
                        await db.updateShoppingStatus(data.id, isBought);
                    }
                } 
                else if (data.action === 'reorder') await db.reorderShoppingList(data.ids);
                else if (data.action === 'delete') await db.deleteShoppingItem(data.id);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
    }

    // --- КОММУНАЛКА ---
    else if (req.url.startsWith('/utilities') && req.method === 'GET') {
        try {
            const list = await db.getUtilityReadings(currentUserId); // <-- Передали ID
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
                if (data.action === 'add') await db.addUtilityReading(currentUserId, data); // <-- Передали ID
                else if (data.action === 'delete') await db.deleteUtilityReading(data.id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
    }
        
    // --- TO-DO LIST ---
    else if (req.url.startsWith('/todos') && req.method === 'GET') {
        try {
            const list = await db.getTodos(currentUserId); // <-- Передали ID
            
            const now = new Date();
            const enrichedList = list.map(t => {
                let days = 0;
                if (t.created_at) {
                    const created = new Date(t.created_at);
                    days = Math.ceil(Math.abs(now - created) / (1000 * 60 * 60 * 24)); 
                }
                return { ...t, days_active: days };
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(enrichedList));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    }
    
    else if (req.url === '/todos/action' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (data.action === 'add') await db.addTodo(currentUserId, data.text, data.period); // <-- Передали ID
                else if (data.action === 'toggle') await db.toggleTodo(data.id, data.status);
                else if (data.action === 'update_period') await db.dbRun('UPDATE todos SET period = ? WHERE id = ?', [data.period, data.id]);
                else if (data.action === 'delete') await db.deleteTodo(data.id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
    }

    // --- КОРЗИНА ---
    else if (req.url.startsWith('/trash') && req.method === 'GET') {
        try {
            const items = await db.getArchivedItems(currentUserId); // <-- Передали ID
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(items));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    }
    
    else if (req.url === '/trash/restore' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { type, id } = JSON.parse(body);
                await db.restoreItem(type, id); // Тут можно добавить проверку владельца
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
    }
    
    // Остальное (kpi, config и т.д.)
    else if (req.url === '/config' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ calendarId: process.env.GOOGLE_CALENDAR_ID }));
    }
    else if (req.url.startsWith('/stats/kpi') && req.method === 'GET') {
        try {
            const urlParts = new URL(req.url, `http://${req.headers.host}`);
            const month = urlParts.searchParams.get('month');
            const count = await db.getLessonCount(currentUserId, month); // <-- Передали ID
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ count }));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    }

    // --- ЗДОРОВЬЕ (iOS Shortcuts) ---
    else if (req.url === '/api/health' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                // В шорткате мы будем передавать userId явно или через секрет. 
                // Для простоты, пусть шорткат шлет { userId: 123, steps: 5000, weight: 80 }
                
                // Простая защита (чтобы кто угодно не слал)
                // Можешь придумать свой secret_key, если сервер смотрит в интернет
                
                await db.addHealthRecord(data.userId, data.steps, data.weight);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', msg: 'Health data saved' }));
            } catch (e) {
                console.error(e);
                res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
            }
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
