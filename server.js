require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser'); // 🔥 Нужно для чтения кук
const config = require('./config');

// Подключаем наши новые модули авторизации
const authRoutes = require('./modules/auth/auth.routes');
const authMiddleware = require('./modules/auth/auth.middleware');

const app = express();
const HOST = '127.0.0.1';
const PORT = 4000;

// --- 1. НАСТРОЙКИ И MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(cookieParser()); // 🔥 Включаем парсер кук

// Раздача статики (Фронтенд)
// Файлы из папки public доступны всем (там лежат html, css, js)
app.use(express.static(path.join(__dirname, 'public')));


// --- 2. РОУТИНГ (ПОРЯДОК ВАЖЕН!) ---

// 🟢 А. ОТКРЫТЫЕ МАРШРУТЫ (Пароль не нужен)
// Логин, Выход, Проверка статуса
app.use('/budzet/auth', authRoutes);

// Вебхук от Home Assistant (он защищен своим секретом в URL)
app.use('/budzet/ha', require('./modules/home/home.routes'));


// 🔴 Б. ЗАЩИЩЕННЫЕ МАРШРУТЫ (Нужен вход)
// Все маршруты ниже проходят через authMiddleware.
// Если куки нет — сервер вернет 401 ошибку.

// Финансы
app.use('/budzet/transactions', authMiddleware, require('./modules/finance/finance.routes'));

// Ученики
app.use('/budzet/students', authMiddleware, require('./modules/students/students.routes'));

// Покупки
app.use('/budzet/shopping', authMiddleware, require('./modules/shopping/shopping.routes'));

// Коммуналка
app.use('/budzet/utilities', authMiddleware, require('./modules/utilities/utilities.routes'));

// Список дел
app.use('/budzet/todos', authMiddleware, require('./modules/todos/todos.routes'));

// Системное (Админка, конфиг, корзина)
// Обрати внимание: я добавил префикс /system, чтобы не было конфликтов
app.use('/budzet/system', authMiddleware, require('./modules/system/system.routes'));

// Корзина (если она у тебя была отдельно, добавь так же)
// app.use('/budzet/trash', authMiddleware, require('./modules/trash/trash.routes'));


// --- 3. ЗАПУСК ---
app.listen(PORT, HOST, () => {
    console.log(`🚀 Secure Server running at http://${HOST}:${PORT}/`);
    console.log(`🔒 Auth System: ENABLED (JWT + Cookies)`);
});
