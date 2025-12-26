const express = require('express');
const router = express.Router();
const db = require('../../db');

const safeHandler = (fn) => async (req, res, next) => {
    try { await fn(req, res, next); } 
    catch (e) { res.status(500).json({ error: e.message }); }
};

// Список учеников
router.get('/students', safeHandler(async (req, res) => {
    const students = await db.getStudents(req.userId);
    res.json(students);
}));

// Статистика по конкретному ученику
router.get('/students/stats', safeHandler(async (req, res) => {
    const { id } = req.query;
    const student = await db.dbGet('SELECT * FROM students WHERE id = ? AND user_id = ?', [id, req.userId]);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const transactions = await db.getStudentStats(req.userId, student.name);
    res.json({ student, transactions });
}));

// Действия (Добавить/Ред/Удалить)
router.post('/students/action', safeHandler(async (req, res) => {
    const data = req.body;
    if (data.action === 'add') await db.addStudent(req.userId, data);
    else if (data.action === 'edit') await db.updateStudent(data);
    else if (data.action === 'delete') await db.deleteStudent(data.id);
    res.json({ status: 'ok' });
}));

// Долги
router.get('/debts', safeHandler(async (req, res) => {
    const debts = await db.getDebts(req.userId);
    res.json(debts);
}));

router.post('/debts/pay', safeHandler(async (req, res) => {
    await db.payDebt(req.body.id);
    res.json({ status: 'ok' });
}));

module.exports = router;
