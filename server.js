const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const config = require('./config');

const app = express();
const HOST = '127.0.0.1';
const PORT = 4000;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Авторизация (User ID)
app.use((req, res, next) => {
    const headerId = req.headers['x-user-id'];
    if (headerId) { req.userId = parseInt(headerId); return next(); }
    if (req.query.userId) { req.userId = parseInt(req.query.userId); return next(); }
    req.userId = config.ADMIN_ID;
    next();
});

const safeHandler = (fn) => async (req, res, next) => {
    try { await fn(req, res, next); } 
    catch (e) { console.error('API Error:', e); res.status(500).json({ error: e.message }); }
};

// --- МОДУЛИ (ПОДКЛЮЧАЕМ РОУТЫ) ---

// 1. ФИНАНСЫ (Транзакции, Категории, Баланс)
// Все маршруты из файла finance.routes.js подключатся сюда
app.use('/', require('./modules/finance/finance.routes'));


// --- ОСТАЛЬНЫЕ API (Пока оставим тут, перенесем следующим шагом) ---

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
app.post('/debts/pay', safeHandler(async (req, res) => {
    await db.payDebt(req.body.id);
    res.json({ status: 'ok' });
}));

// 5. ПОКУПКИ
app.get('/shopping', safeHandler(async (req, res) => {
    const list = await db.getShoppingList(req.userId);
    res.json(list);
}));
app.post('/shopping/action', safeHandler(async (req, res) => {
    const data = req.body;
    if (data.action === 'add') await db.addShoppingItem(req.userId, data);
    else if (data.action === 'status' || data.action === 'toggle') {
        if (data.status === 'deleted') await db.deleteShoppingItem(data.id);
        else {
            const isBought = (data.status === 'bought' || data.status === true || data.status == 1) ? 1 : 0;
            await db.updateShoppingStatus(data.id, isBought);
        }
    } else if (data.action === 'reorder') await db.reorderShoppingList(data.ids);
    else if (data.action === 'delete') await db.deleteShoppingItem(data.id);
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

// 7. СПИСОК ДЕЛ
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

// 9. CONFIG / KPI / HEALTH
app.get('/config', (req, res) => {
    res.json({ calendarId: process.env.GOOGLE_CALENDAR_ID, adminId: config.ADMIN_ID });
});
app.get('/stats/kpi', safeHandler(async (req, res) => {
    const { month } = req.query;
    const count = await db.getLessonCount(req.userId, month);
    res.json({ count });
}));
app.post('/api/health', safeHandler(async (req, res) => {
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

// 11. ЮЗЕР ИНФО
app.get('/users/me', safeHandler(async (req, res) => {
    const user = await db.getUser(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const modules = await db.getUserModules(req.userId);
    res.json({ id: user.telegram_id, name: user.first_name, role: user.role, modules: modules });
}));

// --- ЗАПУСК ---
app.listen(PORT, HOST, () => {
    console.log(`🚀 Modular Server running at http://${HOST}:${PORT}/`);
});
