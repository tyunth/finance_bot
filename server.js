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

// 🔥 ОТЛАДКА: Логируем каждый запрос (чтобы видеть, что приходит)
app.use((req, res, next) => {
    console.log(`📥 Запрос: ${req.method} ${req.url}`);
    next();
});

// --- 2. РОУТИНГ ---

// 🟢 А. ОТКРЫТЫЕ МАРШРУТЫ (без /budzet, так как Nginx его отрезает)
app.use('/auth', authRoutes);
app.use('/ha', require('./modules/home/home.routes'));


// 🔒 Б. ЗАЩИЩЕННЫЕ МАРШРУТЫ
// Все, что идет ниже этой строки, требует токен
app.use(authMiddleware);

// Явное указание путей (без /budzet)

// === ФИНАНСЫ ===
// Если запрос приходит как GET /transactions, он пойдет в financeRoutes
app.use('/transactions', financeRoutes); 
app.use('/categories', financeRoutes);
app.use('/balances', financeRoutes);

// === УЧЕНИКИ ===
app.use('/students', studentRoutes);
app.use('/debts', studentRoutes);

// === ПОКУПКИ ===
app.use('/shopping', shoppingRoutes);

// === КОММУНАЛКА ===
app.use('/utilities', utilitiesRoutes);

// === ЗАДАЧИ ===
app.use('/todos', todosRoutes);

// === СИСТЕМА ===
// Для /users/me (api.js шлет /budzet/users/me -> Nginx режет -> приходит /users/me)
app.use('/users', systemRoutes); 
app.use('/settings', systemRoutes);
app.use('/config', systemRoutes);
app.use('/admin', systemRoutes);
app.use('/stats', systemRoutes);

// === КОРЗИНА (Выключена) ===
// app.use('/trash', trashRoutes);


// --- 3. ЗАПУСК ---
app.listen(PORT, HOST, () => {
    console.log(`🚀 Server running at http://${HOST}:${PORT}/`);
    console.log(`✅ Ready to accept stripped requests (e.g. /transactions instead of /budzet/transactions)`);
});
