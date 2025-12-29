const express = require('express');
const router = express.Router();
const homeService = require('./home.service');

// Чтобы передать bot в роут, нам нужно либо импортировать его (сложно из-за циклов),
// либо приаттачить к req в server.js.
// ПОКА СДЕЛАЕМ ПРОЩЕ: Будем экспортировать функцию инициализации роутов.

module.exports = (bot) => {
    // POST /ha/webhook
    // Защита: можно проверять секретный токен в заголовке
    router.post('/ha/webhook', async (req, res) => {
        const secret = req.headers['x-ha-secret'];
        if (secret !== process.env.HA_SECRET && secret !== 'my-super-secret') {
            return res.status(403).json({ error: 'Access denied' });
        }

        try {
            await homeService.handleWebhook(bot, req.body);
            res.json({ status: 'ok' });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};
