const express = require('express');
const router = express.Router();
const db = require('../../db');
const config = require('../../config');

const safeHandler = (fn) => async (req, res, next) => {
    try { await fn(req, res, next); } 
    catch (e) { res.status(500).json({ error: e.message }); }
};

// 1. Корзина
router.get('/trash', safeHandler(async (req, res) => {
    const items = await db.getArchivedItems(req.userId);
    res.json(items);
}));
router.post('/trash/restore', safeHandler(async (req, res) => {
    const { type, id } = req.body;
    await db.restoreItem(type, id);
    res.json({ status: 'ok' });
}));

// 2. Конфиг и KPI
router.get('/config', (req, res) => {
    res.json({ calendarId: process.env.GOOGLE_CALENDAR_ID, adminId: config.ADMIN_ID });
});
router.get('/stats/kpi', safeHandler(async (req, res) => {
    const { month } = req.query;
    const count = await db.getLessonCount(req.userId, month);
    res.json({ count });
}));

// 3. Здоровье (iOS)
router.post('/api/health', safeHandler(async (req, res) => {
    const targetId = req.body.userId || req.userId;
    await db.addHealthRecord(targetId, req.body.steps, req.body.weight);
    res.json({ status: 'ok', msg: 'Health data saved' });
}));

// 4. Админка и Юзеры
// --- ПОЛЬЗОВАТЕЛИ ---

// Получить всех пользователей
router.get('/admin/users', async (req, res) => {
    try {
        if(req.userId !== config.ADMIN_ID) return res.status(403).json({error: 'Access denied'});
        const users = await db.getAllUsers(); // Убедись, что getAllUsers есть в db.js
        res.json(users);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// 🔥 ИСПРАВЛЕНИЕ: Роут для обновления модулей
router.post('/admin/users/modules', async (req, res) => {
    try {
        if(req.userId !== config.ADMIN_ID) return res.status(403).json({error: 'Access denied'});
        
        const { telegramId, modules } = req.body;
        
        // Вызываем новую функцию из db.js
        await db.updateUserModules(telegramId, modules);
        
        res.json({ success: true });
    } catch (e) {
        console.error(e); // Увидим ошибку в консоли сервера, если что
        res.status(500).json({ error: e.message });
    }
});

// Получить текущего юзера (для initData)
router.get('/users/me', async (req, res) => {
    try {
        const user = await db.getUser(req.userId);
        res.json(user || { role: 'guest', modules: '' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /settings - получить все
router.get('/settings', async (req, res) => {
    try {
        const settings = await db.getAllSettings();
        res.json(settings);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/settings', async (req, res) => {
    try {
        if(req.userId !== config.ADMIN_ID) return res.status(403).json({error: 'Access denied'});
        const { key, value } = req.body;
        await db.setSetting(key, value);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
