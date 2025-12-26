const express = require('express');
const router = express.Router();
const db = require('../../db');

const safeHandler = (fn) => async (req, res, next) => {
    try { await fn(req, res, next); } 
    catch (e) { res.status(500).json({ error: e.message }); }
};

router.get('/shopping', safeHandler(async (req, res) => {
    const list = await db.getShoppingList(req.userId);
    res.json(list);
}));

router.post('/shopping/action', safeHandler(async (req, res) => {
    const data = req.body;
    if (data.action === 'add') {
        await db.addShoppingItem(req.userId, data);
    } else if (data.action === 'status' || data.action === 'toggle') {
        if (data.status === 'deleted') await db.deleteShoppingItem(data.id);
        else {
            const isBought = (data.status === 'bought' || data.status === true || data.status == 1) ? 1 : 0;
            await db.updateShoppingStatus(data.id, isBought);
        }
    } else if (data.action === 'reorder') {
        await db.reorderShoppingList(data.ids);
    } else if (data.action === 'delete') {
        await db.deleteShoppingItem(data.id);
    }
    res.json({ status: 'ok' });
}));

module.exports = router;
