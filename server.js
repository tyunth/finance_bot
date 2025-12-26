const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const config = require('./config');

const app = express();
const HOST = '127.0.0.1';
const PORT = 4000;

// --- MIDDLEWARE (Прослойки) ---

// 1. Разрешаем CORS и JSON (заменяет ручной парсинг body)
app.use(cors());
app.use(express.json());

// 2. Раздача статики (HTML, CSS, JS) из текущей папки
app.use(express.static(__dirname));

// 3. Определение User ID (Custom Middleware)
app.use((req, res, next) => {
    // 1. Из заголовка
    const headerId = req.headers['x-user-id'];
    if (headerId) {
        req.userId = parseInt(headerId);
        return next();
    }
    // 2. Из query параметра (для тестов в браузере)
    if (req.query.userId) {
        req.userId = parseInt(req.query.userId);
        return next();
    }
    // 3. Фолбэк на админа
    req.userId = config.ADMIN_ID;
    next();
});

// --- HELPER ДЛЯ ОШИБОК ---
const safeHandler = (fn) => async (req, res, next) => {
    try {
        await fn(req, res, next);
    } catch (e) {
        console.error('API Error:', e);
        res.status(500).json({ error: e.message || 'Server Error' });
    }
};

// --- API ROUTES ---

// 1. ТРАНЗАКЦИИ
app.get('/transactions', safeHandler(async (req, res) => {
    const rows = await db.dbAll('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC', [req.userId]);
    res.json(rows);
}));

app.post('/transactions/add', safeHandler(async (req, res) => {
    const data = req.body;
    const txData = {
        userId: req.userId,
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
    res.json({ status: 'ok' });
}));

app.post('/transactions/edit', safeHandler(async (req, res) => {
    const { id, amount, category, comment, tag } = req.body;
    
    // Проверка владельца
    const tx = await db.dbGet('SELECT user_id FROM transactions WHERE id = ?', [id]);
    if (!tx || tx.user_id !== req.userId) return res.status(403).json({ error: 'Access Denied' });

    await db.dbRun(`UPDATE transactions SET amount = ?, category = ?, comment = ?, tag = ? WHERE id = ?`, 
        [amount, category, comment, tag, id]);
        
    if (comment && category) await db.learnKeyword(comment, category);
    res.json({ status: 'ok' });
}));

// 2. КАТЕГОРИИ И БАЛАНСЫ
app.get('/categories', safeHandler(async (req, res) => {
    const expenseCats = await db.getUserCategories(req.userId, 'expense');
    const incomeCats = await db.getUserCategories(req.userId, 'income');
    const allCats = [...new Set([...expenseCats, ...incomeCats])].sort();
    res.json(allCats);
}));

app.get('/balances', safeHandler(async (req, res) => {
    const data = await db.getBalances(req.userId);
    res.json(data);
}));

// 3. УЧЕНИКИ
app.get('/students', safeHandler(async (req, res) => {
    const students = await db.getStudents(req.userId);
    res.json(students);
}));

app.get('/students/stats', safeHandler(async (req, res) => {
    const { id } = req.query;
    const student = await db.dbGet('SELECT * FROM students WHERE id = ? AND user_id = ?', [id, req.userId]);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const transactions = await db.getStudentStats(req.userId, student.name);
    res.json({ student, transactions });
}));

app.post('/students/action', safeHandler(async (req, res) => {
    const data = req.body;
    if (data.action === 'add') await db.addStudent(req.userId, data);
    else if (data.action === 'edit') await db.updateStudent(data);
    else if (data.action === 'delete') await db.deleteStudent(data.id);
    res.json({ status: 'ok' });
}));

// 4. ДОЛГИ
app.get('/debts', safeHandler(async (req, res) => {
    const debts = await db.getDebts(req.userId);
    res.json(debts);
}));

// Этого маршрута не было в api_server.js явно, но app.js его вызывал
app.post('/debts/pay', safeHandler(async (req, res) => {
    await db.payDebt(req.body.id);
    res.json({ status: 'ok' });
}));

// 5. ПОКУПКИ (Shopping List)
app.get('/shopping', safeHandler(async (req, res) => {
    const list = await db.getShoppingList(req.userId);
    res.json(list);
}));

app.post('/shopping/action', safeHandler(async (req, res) => {
    const data = req.body;
    if (data.action === 'add') {
        await db.addShoppingItem(req.userId, data);
    } else if (data.action === 'status' || data.action === 'toggle') {
        if (data.status === 'deleted') await db.deleteShoppingItem(data.id);
        else {
            const isBought = (data.status === 'bought' || data.status === true || data.status == 1) ? 1 : 0;
            await db.updateShoppingStatus(data.id, isBought);
        }
    } else if (data.action === 'reorder') {
        await db.reorderShoppingList(data.ids);
    } else if (data.action === 'delete') {
        await db.deleteShoppingItem(data.id);
    }
    res.json({ status: 'ok' });
}));

// 6. КОММУНАЛКА
app.get('/utilities', safeHandler(async (req, res) => {
    const list = await db.getUtilityReadings(req.userId);
    res.json(list);
}));

app.post('/utilities/action', safeHandler(async (req, res) => {
    const data = req.body;
    if (data.action === 'add') await db.addUtilityReading(req.userId, data);
    else if (data.action === 'delete') await db.deleteUtilityReading(data.id);
    res.json({ status: 'ok' });
}));

// 7. СПИСОК ДЕЛ (TODOS)
app.get('/todos', safeHandler(async (req, res) => {
    const list = await db.getTodos(req.userId);
    const now = new Date();
    const enrichedList = list.map(t => {
        let days = 0;
        if (t.created_at) {
            const created = new Date(t.created_at);
            days = Math.ceil(Math.abs(now - created) / (1000 * 60 * 60 * 24));
        }
        return { ...t, days_active: days };
    });
    res.json(enrichedList);
}));

app.post('/todos/action', safeHandler(async (req, res) => {
    const data = req.body;
    if (data.action === 'add') await db.addTodo(req.userId, data.text, data.period);
    else if (data.action === 'toggle') await db.toggleTodo(data.id, data.status);
    else if (data.action === 'update_period') await db.dbRun('UPDATE todos SET period = ? WHERE id = ?', [data.period, data.id]);
    else if (data.action === 'delete') await db.deleteTodo(data.id);
    res.json({ status: 'ok' });
}));

// 8. КОРЗИНА
app.get('/trash', safeHandler(async (req, res) => {
    const items = await db.getArchivedItems(req.userId);
    res.json(items);
}));

app.post('/trash/restore', safeHandler(async (req, res) => {
    const { type, id } = req.body;
    await db.restoreItem(type, id);
    res.json({ status: 'ok' });
}));

// 9. ПРОЧЕЕ (Config, KPI, Health)
app.get('/config', (req, res) => {
    res.json({
        calendarId: process.env.GOOGLE_CALENDAR_ID,
        adminId: config.ADMIN_ID
    });
});

app.get('/stats/kpi', safeHandler(async (req, res) => {
    const { month } = req.query;
    const count = await db.getLessonCount(req.userId, month);
    res.json({ count });
}));

app.post('/api/health', safeHandler(async (req, res) => {
    // Внимание: тут req.userId берется из middleware, 
    // но в оригинале health data приходила извне с явным userId в body.
    // Если шорткат шлет X-User-Id заголовок - сработает req.userId.
    // Если шорткат шлет userId в body - используем его приоритетнее для этого эндпоинта.
    const targetId = req.body.userId || req.userId;
    await db.addHealthRecord(targetId, req.body.steps, req.body.weight);
    res.json({ status: 'ok', msg: 'Health data saved' });
}));

// 10. АДМИНКА
app.get('/admin/users', safeHandler(async (req, res) => {
    if (req.userId.toString() !== config.ADMIN_ID.toString()) return res.status(403).json({ error: 'Access Denied' });
    const users = await db.getAllUsers();
    res.json(users);
}));

app.post('/admin/users/modules', safeHandler(async (req, res) => {
    if (req.userId.toString() !== config.ADMIN_ID.toString()) return res.status(403).json({ error: 'Access Denied' });
    const { telegramId, modules } = req.body;
    await db.updateUserModules(telegramId, modules);
    res.json({ status: 'ok' });
}));

// 11. ИНФО О ЮЗЕРЕ
app.get('/users/me', safeHandler(async (req, res) => {
    const user = await db.getUser(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const modules = await db.getUserModules(req.userId);
    res.json({
        id: user.telegram_id,
        name: user.first_name,
        role: user.role,
        modules: modules
    });
}));

// --- ЗАПУСК ---
app.listen(PORT, HOST, () => {
    console.log(`🚀 Express Server running at http://${HOST}:${PORT}/`);
});
