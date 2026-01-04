const express = require('express');
const router = express.Router();
const db = require('../../db');

const safeHandler = (fn) => async (req, res, next) => {
    try { await fn(req, res, next); } 
    catch (e) { res.status(500).json({ error: e.message }); }
};

router.get('/utilities', safeHandler(async (req, res) => {
    const list = await db.getUtilityReadings(req.userId);
    res.json(list);
}));

router.post('/utilities/action', safeHandler(async (req, res) => {
    const data = req.body;
    if (data.action === 'add') await db.addUtilityReading(req.userId, data);
    else if (data.action === 'delete') await db.deleteUtilityReading(data.id);
    res.json({ status: 'ok' });
}));

// --- WORDS (Английские слова) ---
router.get('/words', safeHandler(async (req, res) => {
    const words = await db.dbAll('SELECT * FROM english_words WHERE user_id = ? ORDER BY date DESC', [req.userId]);
    res.json(words);
}));

router.post('/words/delete', safeHandler(async (req, res) => {
    const { id } = req.body;
    await db.dbRun('DELETE FROM english_words WHERE id = ? AND user_id = ?', [id, req.userId]);
    res.json({ status: 'ok' });
}));

module.exports = router;
