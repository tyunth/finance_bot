const express = require('express');
const router = express.Router();
const db = require('../../db');

const safeHandler = (fn) => async (req, res, next) => {
    try { await fn(req, res, next); } 
    catch (e) { res.status(500).json({ error: e.message }); }
};

router.get('/todos', safeHandler(async (req, res) => {
    const list = await db.getTodos(req.userId);
    const now = new Date();
    // Добавляем поле days_active
    const enrichedList = list.map(t => {
        let days = 0;
        if (t.created_at) {
            const created = new Date(t.created_at);
            days = Math.ceil(Math.abs(now - created) / (1000 * 60 * 60 * 24));
        }
        return { ...t, days_active: days };
    });
    res.json(enrichedList);
}));

router.post('/todos/action', safeHandler(async (req, res) => {
    const data = req.body;
    if (data.action === 'add') await db.addTodo(req.userId, data.text, data.period);
    else if (data.action === 'toggle') await db.toggleTodo(data.id, data.status);
    else if (data.action === 'update_period') await db.dbRun('UPDATE todos SET period = ? WHERE id = ?', [data.period, data.id]);
    else if (data.action === 'delete') await db.deleteTodo(data.id);
    res.json({ status: 'ok' });
}));

module.exports = router;
