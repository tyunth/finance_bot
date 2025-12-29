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
    
    // 1. ДОБАВЛЕНИЕ
    if (data.action === 'add') {
        // data должно содержать: title, type, price_estimate, url
        await db.addShoppingItem(req.userId, data);
    } 
    // 2. РЕДАКТИРОВАНИЕ (Новое!)
    else if (data.action === 'edit' || data.action === 'update') {
        await db.updateShoppingItem(req.userId, data);
    }
    // 3. СТАТУС (Куплено/Нет)
    else if (data.action === 'status' || data.action === 'toggle') {
        if (data.status === 'deleted') await db.deleteShoppingItem(data.id);
        else {
            const isBought = (data.status === 'bought' || data.status === true || data.status == 1) ? 1 : 0;
            await db.updateShoppingStatus(data.id, isBought);
        }
    } 
    // 4. СОРТИРОВКА
    else if (data.action === 'reorder') {
        await db.reorderShoppingList(data.ids);
    } 
    // 5. УДАЛЕНИЕ
    else if (data.action === 'delete') {
        await db.deleteShoppingItem(data.id);
    }
    
    res.json({ status: 'ok' });
}));

module.exports = router;
