require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const config = require('./config');

const authRoutes = require('./modules/auth/auth.routes');
const authMiddleware = require('./modules/auth/auth.middleware');

// Модули
const financeRoutes = require('./modules/finance/finance.routes');
const studentRoutes = require('./modules/students/students.routes');
const systemRoutes = require('./modules/system/system.routes');
const shoppingRoutes = require('./modules/shopping/shopping.routes');
const utilitiesRoutes = require('./modules/utilities/utilities.routes');
const todosRoutes = require('./modules/todos/todos.routes');

// ❌ УБРАЛИ КОРЗИНУ, чтобы сервер не падал (пока файла нет)
// const trashRoutes = require('./modules/trash/trash.routes'); 

const app = express();
const HOST = '127.0.0.1';
const PORT = 4000;

app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.use(express.static(path.join(__dirname, 'public')));

// --- РОУТИНГ ---

// 1. ОТКРЫТЫЕ МАРШРУТЫ
app.use('/budzet/auth', authRoutes);
app.use('/budzet/ha', require('./modules/home/home.routes'));

// 2. ЗАЩИЩЕННЫЕ МАРШРУТЫ
// Мы подключаем все роутеры к /budzet. 
// Express будет по очереди заходить в каждый роутер и искать совпадение пути.
// Например, запрос /budzet/transactions зайдет в financeRoutes, найдет там /transactions и сработает.

// Важно: Сначала проверяем токен (authMiddleware)
app.use('/budzet', authMiddleware);

// Затем подключаем модули. Порядок не важен, если внутри них разные пути.
app.use('/budzet', financeRoutes);   // Ищет: /transactions, /categories, /balances
app.use('/budzet', studentRoutes);   // Ищет: /students, /debts
app.use('/budzet', systemRoutes);    // Ищет: /users, /settings, /config, /admin, /stats
app.use('/budzet', shoppingRoutes);  // Ищет: /shopping
app.use('/budzet', utilitiesRoutes); // Ищет: /utilities
app.use('/budzet', todosRoutes);     // Ищет: /todos

// Корзина отключена
// app.use('/budzet', trashRoutes);


// --- ЗАПУСК ---
app.listen(PORT, HOST, () => {
    console.log(`🚀 Server running at http://${HOST}:${PORT}/`);
    console.log(`🔒 Auth System: ENABLED`);
});
