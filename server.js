require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path'); // <-- Не забудь этот импорт!
const config = require('./config');


const app = express();
const HOST = '127.0.0.1';
const PORT = 4000;

// --- 1. CONFIG & MIDDLEWARE ---
app.use(cors());
app.use(express.json());


// ВАЖНО: Указываем серверу, что сайт лежит в папке 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Авторизация (Middleware)
app.use((req, res, next) => {
    const headerId = req.headers['x-user-id'];
    if (headerId) { req.userId = parseInt(headerId); return next(); }
    if (req.query.userId) { req.userId = parseInt(req.query.userId); return next(); }
    
    req.userId = config.ADMIN_ID; // Fallback
    next();
});

// --- 2. ПОДКЛЮЧЕНИЕ МОДУЛЕЙ ---

// Финансы
app.use('/', require('./modules/finance/finance.routes'));

// Ученики
app.use('/', require('./modules/students/students.routes'));

// Покупки
app.use('/', require('./modules/shopping/shopping.routes.js'));

// Коммуналка
app.use('/', require('./modules/utilities/utilities.routes.js'));

// Список дел
app.use('/', require('./modules/todos/todos.routes.js'));

// Системное (Админка, конфиг, корзина)
app.use('/', require('./modules/system/system.routes.js'));

app.use('/', require('./modules/home/home.routes.js'));

// --- 3. ЗАПУСК ---
app.listen(PORT, HOST, () => {
    console.log(`🚀 Modular Server running at http://${HOST}:${PORT}/`);
    console.log(`📦 Modules loaded: Finance, Students, Shopping, Utilities, Todos, System`);
    console.log(`📂 Serving static files from ./public`);
});
