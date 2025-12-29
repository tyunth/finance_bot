require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const config = require('./config');

// Подключаем наши новые модули авторизации
const authRoutes = require('./modules/auth/auth.routes');
const authMiddleware = require('./modules/auth/auth.middleware');

// Подключаем модули заранее, чтобы использовать их для нескольких путей
const financeRoutes = require('./modules/finance/finance.routes');
const studentRoutes = require('./modules/students/students.routes');
const systemRoutes = require('./modules/system/system.routes');
const trashRoutes = require('./modules/trash/trash.routes'); // Убедитесь, что файл существует

const app = express();
const HOST = '127.0.0.1';
const PORT = 4000;

// --- 1. НАСТРОЙКИ И MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(cookieParser()); 

// Раздача статики
app.use(express.static(path.join(__dirname, 'public')));


// --- 2. РОУТИНГ ---

// 🟢 А. ОТКРЫТЫЕ МАРШРУТЫ
app.use('/budzet/auth', authRoutes);
app.use('/budzet/ha', require('./modules/home/home.routes'));


// 🔴 Б. ЗАЩИЩЕННЫЕ МАРШРУТЫ (Нужен вход)

// --- ФИНАНСЫ ---
// В api.js запросы идут на /transactions, /balances, /categories
// Направляем их все в financeRoutes
app.use('/budzet/transactions', authMiddleware, financeRoutes);
app.use('/budzet/balances', authMiddleware, financeRoutes);
app.use('/budzet/categories', authMiddleware, financeRoutes);

// --- УЧЕНИКИ ---
// В api.js запросы идут на /students и /debts
app.use('/budzet/students', authMiddleware, studentRoutes);
app.use('/budzet/debts', authMiddleware, studentRoutes);

// --- ПОКУПКИ ---
app.use('/budzet/shopping', authMiddleware, require('./modules/shopping/shopping.routes'));

// --- КОММУНАЛКА ---
app.use('/budzet/utilities', authMiddleware, require('./modules/utilities/utilities.routes'));

// --- СПИСОК ДЕЛ ---
app.use('/budzet/todos', authMiddleware, require('./modules/todos/todos.routes'));

// --- СИСТЕМНОЕ (Админка, конфиг, профиль) ---
// В api.js много разных запросов, которые логично обрабатывать в systemRoutes:
// /users/me, /settings, /config, /stats/kpi, /admin/users
app.use('/budzet/system', authMiddleware, systemRoutes);
app.use('/budzet/users', authMiddleware, systemRoutes);   // для /users/me
app.use('/budzet/settings', authMiddleware, systemRoutes); // для /settings
app.use('/budzet/config', authMiddleware, systemRoutes);   // для /config
app.use('/budzet/admin', authMiddleware, systemRoutes);    // для /admin/users
app.use('/budzet/stats', authMiddleware, systemRoutes);    // для /stats/kpi

// --- КОРЗИНА ---
// В api.js запрос идет на /trash
app.use('/budzet/trash', authMiddleware, trashRoutes);


// --- 3. ЗАПУСК ---
app.listen(PORT, HOST, () => {
    console.log(`🚀 Secure Server running at http://${HOST}:${PORT}/`);
    console.log(`🔒 Auth System: ENABLED`);
});
