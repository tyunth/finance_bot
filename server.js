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
// const trashRoutes = require('./modules/trash/trash.routes'); // ❌ ЗАКОММЕНТИРОВАЛ, ТАК КАК ФАЙЛА НЕТ

const app = express();
const HOST = '127.0.0.1';
const PORT = 4000;

app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.use(express.static(path.join(__dirname, 'public')));

// --- РОУТЫ ---

// 1. Открытые
app.use('/budzet/auth', authRoutes);
app.use('/budzet/ha', require('./modules/home/home.routes'));

// 2. Защищенные
// Финансы
app.use('/budzet/transactions', authMiddleware, financeRoutes);
app.use('/budzet/balances', authMiddleware, financeRoutes);
app.use('/budzet/categories', authMiddleware, financeRoutes);

// Ученики
app.use('/budzet/students', authMiddleware, studentRoutes);
app.use('/budzet/debts', authMiddleware, studentRoutes);

// Покупки
app.use('/budzet/shopping', authMiddleware, require('./modules/shopping/shopping.routes'));

// Коммуналка
app.use('/budzet/utilities', authMiddleware, require('./modules/utilities/utilities.routes'));

// Задачи
app.use('/budzet/todos', authMiddleware, require('./modules/todos/todos.routes'));

// Система
app.use('/budzet/system', authMiddleware, systemRoutes);
app.use('/budzet/users', authMiddleware, systemRoutes);
app.use('/budzet/settings', authMiddleware, systemRoutes);
app.use('/budzet/config', authMiddleware, systemRoutes);
app.use('/budzet/admin', authMiddleware, systemRoutes);
app.use('/budzet/stats', authMiddleware, systemRoutes);

// Корзина (Пока отключаем, чтобы сервер не падал)
// app.use('/budzet/trash', authMiddleware, trashRoutes); 

app.listen(PORT, HOST, () => {
    console.log(`🚀 Server running at http://${HOST}:${PORT}/`);
});
