const http = require('http');
const path = require('path');
const fs = require('fs');
const db = require('./db'); // Обязательно подключаем db.js
const config = require('./config');
const calendar = require('./calendar');

const HOST = '127.0.0.1'; 
const PORT = 4000;

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
            const transactions = await db.dbAll('SELECT * FROM transactions ORDER BY date DESC');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(transactions));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: 'DB Error' })); }
    } 
    
    // 2. Категории
    else if (req.url === '/categories' && req.method === 'GET') {
        try {
            // Берем категории админа (пока мульти-юзер не запущен полноценно)
            const expenseCats = await db.getUserCategories(config.ADMIN_ID, 'expense');
            const incomeCats = await db.getUserCategories(config.ADMIN_ID, 'income');
            
            // Объединяем и сортируем
            const allCats = [...new Set([...expenseCats, ...incomeCats])].sort();
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(allCats));
        } catch (e) { 
            res.writeHead(500); res.end(JSON.stringify({ error: e.message })); 
        }
    }

// 3. Балансы счетов (ОБНОВЛЕНО: возвращаем и список счетов с их типом)
    else if (req.url === '/balances' && req.method === 'GET') {
        try {
            // getBalances возвращает { balances: {...}, accountsList: [...] }
            const data = await db.getBalances(config.ADMIN_ID || 0); 
            res.writeHead(200, { 'Content-Type': 'application/json' });
            // Отправляем ВЕСЬ объект data, а не только balances
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
                if (!id || !amount) throw new Error('No Data');
                
                await db.dbRun(`UPDATE transactions SET amount = ?, category = ?, comment = ?, tag = ? WHERE id = ?`, [amount, category, comment, tag, id]);
                
                if (comment && category) {
                    await db.learnKeyword(comment, category);
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
            } catch (e) { 
                console.error('Ошибка сохранения студента:', e);
                res.writeHead(500); res.end(JSON.stringify({ error: e.message })); 
            }
        });
    }

    // Статистика ученика
    else if (req.url.startsWith('/students/stats') && req.method === 'GET') {
        try {
            const urlParts = new URL(req.url, `http://${req.headers.host}`);
            const id = urlParts.searchParams.get('id');
            if (!id) throw new Error('No ID provided');

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

    // 5. Долги учеников
    else if (req.url === '/debts' && req.method === 'GET') {
        try {
            // Берем долги админа (ID 0 или из конфига)
            const debts = await db.getDebts(config.ADMIN_ID); 
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(debts));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    }
    
    else if (req.url === '/debts/pay' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { id } = JSON.parse(body);
                await db.payDebt(id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
    }

    // 6. KPI (Уроки за месяц)
    else if (req.url.startsWith('/stats/kpi') && req.method === 'GET') {
        try {
            const urlParts = new URL(req.url, `http://${req.headers.host}`);
            const month = urlParts.searchParams.get('month'); // YYYY-MM
            const count = await db.getLessonCount(month);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ count }));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    }

    // 7. Ручное добавление транзакции
    else if (req.url === '/transactions/add' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                // Дополняем данными для функции addTransaction
                const txData = {
                    userId: config.ADMIN_ID,
                    type: data.type,
                    amount: parseFloat(data.amount),
                    category: data.category,
                    tag: data.tag || (data.type === 'income' ? 'Доход' : 'Разное'),
                    comment: data.comment,
                    date: data.date,
                    // Логика счетов:
                    sourceAccount: data.type === 'expense' ? 'Основной' : null,
                    targetAccount: data.type === 'income' ? 'Основной' : null
                };
                await db.addTransaction(txData);
                // Если есть категория и коммент, учим бота
                if (data.comment && data.category) await db.learnKeyword(data.comment, data.category);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
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
                console.log('Shopping Action:', data); // Лог оставляем, полезно

                if (data.action === 'add') {
                    await db.addShoppingItem(data);
                } 
                else if (data.action === 'status' || data.action === 'toggle') {
                    // --- ЛОГИКА ИСПРАВЛЕНА ТУТ ---
                    
                    // 1. Если статус пришел как "deleted" -> Удаляем
                    if (data.status === 'deleted') {
                        await db.deleteShoppingItem(data.id);
                    } 
                    // 2. Если статус "bought" или true -> Ставим 1, иначе 0
                    else {
                        const isBought = (data.status === 'bought' || data.status === 'done' || data.status === true || data.status == 1) ? 1 : 0;
                        await db.updateShoppingStatus(data.id, isBought);
                    }
                } 
                else if (data.action === 'reorder') {
                    await db.reorderShoppingList(data.ids);
                }
                // На случай, если фронтенд когда-то начнет слать нормальный action='delete'
                else if (data.action === 'delete') {
                    await db.deleteShoppingItem(data.id);
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { 
                console.error(e);
                res.writeHead(500); res.end(JSON.stringify({ error: e.message })); 
            }
        });
    }

    // --- КОММУНАЛКА ---
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
        
    // --- НОВЫЙ МАРШРУТ: Отдача публичного конфига ---
    else if (req.url === '/config' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Отдаем только то, что можно видеть фронтенду! Не отдавай тут пароли!
        res.end(JSON.stringify({ 
            calendarId: process.env.GOOGLE_CALENDAR_ID 
        }));
    }
        
    // --- TO-DO LIST (С ПОДСЧЕТОМ ДНЕЙ) ---
    else if (req.url === '/todos' && req.method === 'GET') {
        try {
            const list = await db.getTodos();
            
            // Добавляем вычисляемое поле days_active
            const now = new Date();
            const enrichedList = list.map(t => {
                let days = 0;
                if (t.created_at) {
                    const created = new Date(t.created_at);
                    const diffTime = Math.abs(now - created);
                    days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
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
                if (data.action === 'add') await db.addTodo(data.text, data.period);
                else if (data.action === 'toggle') await db.toggleTodo(data.id, data.status);
                else if (data.action === 'update_period') await db.dbRun('UPDATE todos SET period = ? WHERE id = ?', [data.period, data.id]);
                else if (data.action === 'delete') await db.deleteTodo(data.id);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
    }

    // --- КОРЗИНА (TRASH) ---
    else if (req.url === '/trash' && req.method === 'GET') {
        try {
            const items = await db.getArchivedItems(); // <-- Твоя новая функция
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
                await db.restoreItem(type, id); // <-- Твоя новая функция
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
