const express = require('express');
const router = express.Router();
const db = require('../../db'); 
const exportService = require('./export.service');

const USER_MAPPING = {
    'Galina': 1047396910, 
};

router.use(async (req, res, next) => {
    try {
        if (req.user && req.user.id) {
            // 1. Сначала берем ID из сессии (это ID=2)
            let effectiveId = req.user.id;

            // 2. Ищем этого пользователя в базе, чтобы узнать его telegram_id
            // (Используем dbGet, так как db - это твой модуль базы данных)
            const userRecord = await db.dbGet('SELECT telegram_id FROM users WHERE id = ?', [req.user.id]);

            // 3. Если у пользователя привязан Telegram ID — используем его
            if (userRecord && userRecord.telegram_id) {
                effectiveId = userRecord.telegram_id;
                console.log(`🔀 Mapping: Web User #${req.user.id} -> Telegram User #${effectiveId}`);
            }

            // 4. Сохраняем итоговый ID для всех запросов
            req.userId = effectiveId;
        }
    } catch (e) {
        console.error('⚠️ Auth Middleware Error:', e);
        // В случае ошибки базы оставляем ID как есть, чтобы не уронить запрос
        if (req.user) req.userId = req.user.id;
    }

    next();
});



// Вспомогательная функция для безопасности
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
    // 🔥 И ЭТОТ ЛОГ:
    console.log(`🔍 Seeking transactions for User ${req.userId}...`);
    
    const rows = await db.dbAll('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC', [req.userId]);
    
    console.log(`✅ Found ${rows.length} transactions.`); // Покажет, сколько нашел
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
    
    // Проверка владельца
    const tx = await db.dbGet('SELECT user_id FROM transactions WHERE id = ?', [id]);
    
    // Если транзакции нет или она чужая
    if (!tx || tx.user_id !== req.userId) {
        return res.status(403).json({ error: 'Access Denied' });
    }

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
router.post('/transactions/delete', async (req, res) => {
    try {
        const { id } = req.body;
        await db.dbRun('DELETE FROM transactions WHERE id = ? AND user_id = ?', [id, req.userId]);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// Роут для скачивания
router.get('/transactions/export', async (req, res) => {
    try {
        const csv = await exportService.generateCsv(req.userId);
        
        res.header('Content-Type', 'text/csv');
        res.attachment(`finance_export_${req.userId}.csv`);
        res.send(csv);
    } catch (e) {
        console.error(e);
        res.status(500).send('Export error');
    }
});


// --- АНАЛИТИКА МАГАЗИНОВ ---
router.get('/analytics/shops', safeHandler(async (req, res) => {
    const sql = `
        SELECT 
            COALESCE(a.brand_name, r.shop_name) as shop_name,
            r.shop_address as address,  -- 🔥 БЫЛО r.address, СТАЛО r.shop_address
            COUNT(*) as visit_count, 
            SUM(r.total_sum) as total_spent,
            AVG(r.total_sum) as avg_check
        FROM receipts r
        LEFT JOIN shop_aliases a ON r.shop_name = a.raw_name AND a.user_id = r.user_id
        WHERE r.user_id = ? 
        GROUP BY shop_name, r.shop_address -- 🔥 ТУТ ТОЖЕ ВАЖНО ПОМЕНЯТЬ
        ORDER BY visit_count DESC
    `;
    
    const rows = await db.dbAll(sql, [req.userId]);
    res.json(rows);
}));

// --- НОВЫЙ РОУТ: ОБУЧЕНИЕ БОТА ---
// Бот будет дергать этот роут, когда пользователь ответит на вопрос "Что это за магазин?"
router.post('/shops/alias', safeHandler(async (req, res) => {
    const { raw_name, brand_name } = req.body;
    
    if (!raw_name || !brand_name) {
        return res.status(400).json({ error: 'Data missing' });
    }

    // Сохраняем или обновляем синоним (INSERT OR REPLACE)
    await db.dbRun(
        `INSERT OR REPLACE INTO shop_aliases (user_id, raw_name, brand_name) VALUES (?, ?, ?)`,
        [req.userId, raw_name, brand_name]
    );

    res.json({ status: 'ok', message: `Теперь я знаю, что ${raw_name} это ${brand_name}` });
}));

module.exports = router;
