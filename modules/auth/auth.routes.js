const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../db');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-it';

// Вход
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    const user = await db.getUserByUsername(username);
    if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
    if (!user.password) return res.status(400).json({ error: 'У пользователя не задан пароль' });

    // Сверяем хеши
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Неверный пароль' });

    // Создаем токен
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    // Отправляем Cookie (HttpOnly - скрипты не могут его украсть)
    res.cookie('token', token, { 
        httpOnly: true, 
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 дней
    });

    res.json({ status: 'ok', user: { id: user.id, name: user.first_name, role: user.role } });
});

// Выход
router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ status: 'ok' });
});

// Проверка (кто я?)
router.get('/me', async (req, res) => {
    // Этот роут мы защитим middleware, поэтому req.userId уже будет доступен
    const token = req.cookies.token;
    if(!token) return res.status(401).json({error: 'Not auth'});
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await db.dbGet('SELECT id, first_name, role, username, modules FROM users WHERE id = ?', [decoded.id]);
        res.json(user);
    } catch(e) {
        res.status(401).json({error: 'Invalid'});
    }
});

// Утилита: Задать пароль (временно, чтобы ты мог задать себе пароль первый раз)
// Вызови это через Postman/Curl один раз: POST /auth/set-password { "id": 1, "password": "123" }
router.post('/set-password', async (req, res) => {
    const { id, password } = req.body;
    // В реале тут нужна защита, но пока так
    const hash = await bcrypt.hash(password, 10);
    await db.setUserPassword(id, hash);
    res.json({ status: 'Password set' });
});

module.exports = router;
