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
router.get('/admin/users', safeHandler(async (req, res) => {
    if (req.userId.toString() !== config.ADMIN_ID.toString()) return res.status(403).json({ error: 'Access Denied' });
    const users = await db.getAllUsers();
    res.json(users);
}));

router.post('/admin/users/modules', safeHandler(async (req, res) => {
    if (req.userId.toString() !== config.ADMIN_ID.toString()) return res.status(403).json({ error: 'Access Denied' });
    const { telegramId, modules } = req.body;
    await db.updateUserModules(telegramId, modules);
    res.json({ status: 'ok' });
}));

router.get('/users/me', safeHandler(async (req, res) => {
    const user = await db.getUser(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const modules = await db.getUserModules(req.userId);
    res.json({ id: user.telegram_id, name: user.first_name, role: user.role, modules: modules });
}));

// GET /settings - получить все
router.get('/settings', async (req, res) => {
    try {
        const settings = await db.getAllSettings();
        res.json(settings);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /settings - сохранить одну
router.post('/settings', async (req, res) => {
    try {
        const { key, value } = req.body;
        if(req.userId !== 133245761) return res.status(403).json({error: 'Access denied'}); // Защита
        
        await db.setSetting(key, value);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
