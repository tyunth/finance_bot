require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');

const authRoutes = require('./modules/auth/auth.routes');
const authMiddleware = require('./modules/auth/auth.middleware');

// --- ПОДКЛЮЧЕНИЕ МОДУЛЕЙ ---
const financeRoutes = require('./modules/finance/finance.routes');
const studentRoutes = require('./modules/students/students.routes');
const systemRoutes = require('./modules/system/system.routes');
const shoppingRoutes = require('./modules/shopping/shopping.routes');
const utilitiesRoutes = require('./modules/utilities/utilities.routes');
const todosRoutes = require('./modules/todos/todos.routes');

const app = express();
const HOST = '127.0.0.1';
const PORT = 4000;

// --- 1. НАСТРОЙКИ ---
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Логируем запросы для отладки
app.use((req, res, next) => {
    // Не засоряем логи статикой (картинки, css)
    if (!req.url.includes('.')) {
        console.log(`📥 API запрос: ${req.method} ${req.url}`);
    }
    next();
});

// --- 2. РОУТИНГ ---

// А. Открытые маршруты (Auth написан правильно, там пути относительные)
app.use('/auth', authRoutes);
app.use('/ha', require('./modules/home/home.routes'));

// Б. ЗАЩИТА (все, что ниже, требует входа)
app.use(authMiddleware);

// В. МОДУЛИ (Исправлено!)
// Мы подключаем их к корню '/', чтобы сработали пути внутри файлов
// (например, router.get('/transactions') внутри financeRoutes)

app.use('/', financeRoutes);   // Ловит /transactions, /categories, /balances
app.use('/', studentRoutes);   // Ловит /students, /debts
app.use('/', shoppingRoutes);  // Ловит /shopping
app.use('/', utilitiesRoutes); // Ловит /utilities
app.use('/', todosRoutes);     // Ловит /todos

// Для системных путей (/users/me, /settings) скорее всего тоже нужны полные пути
// Если в system.routes.js написано router.get('/users/me'), то подключаем к корню:
app.use('/', systemRoutes);

// Если вдруг внутри system.routes.js написано просто router.get('/me'), 
// то для запроса /users/me нужно раскомментировать строку ниже, а верхнюю убрать:
// app.use('/users', systemRoutes); 


// --- 3. ЗАПУСК ---
app.listen(PORT, HOST, () => {
    console.log(`🚀 Server running at http://${HOST}:${PORT}/`);
});
