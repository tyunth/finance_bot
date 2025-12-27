// modules/students/students.routes.js
const express = require('express');
const router = express.Router();
const db = require('../../db');

// Получить всех
router.get('/students', async (req, res) => {
    try {
        const rows = await db.getStudents(req.userId);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Статистика
router.get('/students/stats', async (req, res) => {
    try {
        const { id } = req.query;
        const student = await db.dbGet('SELECT * FROM students WHERE id = ? AND user_id = ?', [id, req.userId]);
        const transactions = await db.dbAll(
            'SELECT * FROM transactions WHERE user_id = ? AND tag LIKE ? ORDER BY date DESC', 
            [req.userId, `%${student.name}%`]
        );
        res.json({ student, transactions });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Действия (Add/Edit/Delete)
router.post('/students/action', async (req, res) => {
    try {
        const { action, id, name, subject, phone, parents, parent_phone, address, notes, school, grade, teacher, lessons_per_week, schedule_days } = req.body;
        
        if (action === 'add') {
            await db.dbRun(
                `INSERT INTO students (user_id, name, subject, phone, parents, parent_phone, address, notes, school, grade, teacher, lessons_per_week, schedule_days) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.userId, name, subject, phone, parents, parent_phone, address, notes, school, grade, teacher, lessons_per_week, schedule_days]
            );
        } else if (action === 'edit') {
            await db.dbRun(
                `UPDATE students SET name=?, subject=?, phone=?, parents=?, parent_phone=?, address=?, notes=?, school=?, grade=?, teacher=?, lessons_per_week=?, schedule_days=? 
                 WHERE id=? AND user_id=?`,
                [name, subject, phone, parents, parent_phone, address, notes, school, grade, teacher, lessons_per_week, schedule_days, id, req.userId]
            );
        } else if (action === 'delete') {
            await db.dbRun('DELETE FROM students WHERE id=? AND user_id=?', [id, req.userId]);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Долги
router.get('/debts', async (req, res) => {
    try {
        const rows = await db.getDebts(req.userId);
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/debts/pay', async (req, res) => {
    try {
        await db.payDebt(req.body.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
