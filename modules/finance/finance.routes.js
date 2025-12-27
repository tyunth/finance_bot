const express = require('express');
const router = express.Router();
const db = require('../../db'); // Поднимаемся на 2 уровня вверх к db.js

// Вспомогательная функция для безопасности (чтобы не писать try-catch везде)
const safeHandler = (fn) => async (req, res, next) => {
    try {
        await fn(req, res, next);
    } catch (e) {
        console.error('Finance API Error:', e);
        res.status(500).json({ error: e.message || 'Server Error' });
    }
};

// --- ТРАНЗАКЦИИ ---

router.get('/transactions', safeHandler(async (req, res) => {
    // req.userId приходит из server.js (middleware)
    const rows = await db.dbAll('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC', [req.userId]);
    res.json(rows);
}));

router.post('/transactions/add', safeHandler(async (req, res) => {
    const data = req.body;
    const txData = {
        userId: req.userId,
        type: data.type,
        amount: parseFloat(data.amount),
        category: data.category,
        tag: data.tag || (data.type === 'income' ? 'Доход' : 'Разное'),
        comment: data.comment,
        date: data.date,
        sourceAccount: data.type === 'expense' ? 'Основной' : null,
        targetAccount: data.type === 'income' ? 'Основной' : null
    };
    await db.addTransaction(txData);
    if (data.comment && data.category) await db.learnKeyword(data.comment, data.category);
    res.json({ status: 'ok' });
}));

router.post('/transactions/edit', safeHandler(async (req, res) => {
    const { id, amount, category, comment, tag } = req.body;
    
    const tx = await db.dbGet('SELECT user_id FROM transactions WHERE id = ?', [id]);
    if (!tx || tx.user_id !== req.userId) return res.status(403).json({ error: 'Access Denied' });

    await db.dbRun(`UPDATE transactions SET amount = ?, category = ?, comment = ?, tag = ? WHERE id = ?`, 
        [amount, category, comment, tag, id]);
        
    if (comment && category) await db.learnKeyword(comment, category);
    res.json({ status: 'ok' });
}));

// --- КАТЕГОРИИ И БАЛАНСЫ ---

router.get('/categories', safeHandler(async (req, res) => {
    const expenseCats = await db.getUserCategories(req.userId, 'expense');
    const incomeCats = await db.getUserCategories(req.userId, 'income');
    const allCats = [...new Set([...expenseCats, ...incomeCats])].sort();
    res.json(allCats);
}));

router.get('/balances', safeHandler(async (req, res) => {
    const data = await db.getBalances(req.userId);
    res.json(data);
}));

// --- УДАЛЕНИЕ ТРАНЗАКЦИИ ---
router.post('/delete', async (req, res) => {
    try {
        const { id } = req.body;
        // Удаляем запись, принадлежащую текущему юзеру
        await db.dbRun('DELETE FROM transactions WHERE id = ? AND user_id = ?', [id, req.userId]);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
