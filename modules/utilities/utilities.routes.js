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

module.exports = router;
