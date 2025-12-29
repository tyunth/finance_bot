require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const config = require('./config');

const authRoutes = require('./modules/auth/auth.routes');
const authMiddleware = require('./modules/auth/auth.middleware');

// --- ПОДКЛЮЧЕНИЕ МОДУЛЕЙ ---
const financeRoutes = require('./modules/finance/finance.routes');
const studentRoutes = require('./modules/students/students.routes');
const systemRoutes = require('./modules/system/system.routes');
const shoppingRoutes = require('./modules/shopping/shopping.routes');
const utilitiesRoutes = require('./modules/utilities/utilities.routes');
const todosRoutes = require('./modules/todos/todos.routes');

// const trashRoutes = require('./modules/trash/trash.routes'); // Пока выключено

const app = express();
const HOST = '127.0.0.1';
const PORT = 4000;

// --- 1. НАСТРОЙКИ ---
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// 🔥 ОТЛАДКА: Логируем каждый запрос в консоль
app.use((req, res, next) => {
    console.log(`📥 Запрос: ${req.method} ${req.url}`);
    next();
});

// --- 2. РОУТИНГ ---

// А. Открытые маршруты
app.use('/budzet/auth', authRoutes);
app.use('/budzet/ha', require('./modules/home/home.routes'));

// Б. Проверка токена для всего, что начинается с /budzet (кроме auth/ha)
app.use('/budzet', authMiddleware);

// В. Маршруты (ЯВНОЕ УКАЗАНИЕ ПУТЕЙ)

// === ФИНАНСЫ (Transactions, Categories, Balances) ===
// В api.js запросы идут на /transactions, /categories, /balances.
// Мы направляем их все в financeRoutes. Внутри файла роутера должны быть обработчики.
// Если financeRoutes обрабатывает корень '/', то запросы пойдут верно.
app.use('/budzet/transactions', financeRoutes); 
app.use('/budzet/categories', financeRoutes);
app.use('/budzet/balances', financeRoutes);

// === УЧЕНИКИ ===
app.use('/budzet/students', studentRoutes);
app.use('/budzet/debts', studentRoutes); // Если долги тоже там

// === ПОКУПКИ ===
app.use('/budzet/shopping', shoppingRoutes);

// === КОММУНАЛКА ===
app.use('/budzet/utilities', utilitiesRoutes);

// === ЗАДАЧИ ===
app.use('/budzet/todos', todosRoutes);

// === СИСТЕМА (User, Settings, Admin, Config) ===
// api.js: request('/users/me') -> направляем в systemRoutes
app.use('/budzet/users', systemRoutes); 

// api.js: request('/settings')
app.use('/budzet/settings', systemRoutes);

// api.js: request('/config')
app.use('/budzet/config', systemRoutes);

// api.js: request('/admin/users')
app.use('/budzet/admin', systemRoutes);

// api.js: request('/stats/kpi')
app.use('/budzet/stats', systemRoutes);

// === КОРЗИНА (Пока выключена) ===
// app.use('/budzet/trash', trashRoutes);


// --- 3. ЗАПУСК ---
app.listen(PORT, HOST, () => {
    console.log(`🚀 Server running at http://${HOST}:${PORT}/`);
    console.log(`📝 Debug logging enabled (check console for 404s)`);
});
