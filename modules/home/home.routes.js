const express = require('express');
const router = express.Router();
const homeService = require('./home.service');
const config = require('../../config');

// POST http://ТВОЙ_IP:4000/ha/webhook?secret=my-super-secret
router.post('/ha/webhook', async (req, res) => {
    // Простая защита, чтобы никто левый не слал данные
    // Секрет можно хранить в config.js или просто хардкодом для начала
    const secret = req.query.secret || req.headers['x-ha-secret'];
    
    // Замени 'my-super-secret' на свой пароль, который пропишешь в HA
    if (secret !== 'my-super-secret') {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        await homeService.handleWebhook(req.body);
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('HA Webhook Error:', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
