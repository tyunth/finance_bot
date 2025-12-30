const express = require('express');
const router = express.Router();
const db = require('../../db'); 
const exportService = require('./export.service');

// 🔥 ВАЖНОЕ ИСПРАВЛЕНИЕ:
// Этот код берет ID из токена (req.user.id) и сохраняет его как req.userId,
// чтобы старые запросы к базе работали.
router.use((req, res, next) => {
    if (req.user && req.user.id) {
        req.userId = req.user.id;
        // 🔥 ДОБАВЬТЕ ЭТОТ ЛОГ:
        console.log(`👤 User ID detected: ${req.userId}`);
    } else {
        console.log('⚠️ No user ID found in token!');
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
    // 🔥 Магия SQL:
    // 1. Берем данные из чеков (receipts)
    // 2. Джойним таблицу синонимов (shop_aliases)
    // 3. Если есть синоним (brand_name) - берем его, иначе берем исходное название (shop_name)
    // 4. Группируем по ИМЕНИ + АДРЕСУ
    
    const sql = `
        SELECT 
            COALESCE(a.brand_name, r.shop_name) as display_name,
            r.address,
            COUNT(*) as visit_count, 
            SUM(r.total_sum) as total_spent,
            AVG(r.total_sum) as avg_check
        FROM receipts r
        LEFT JOIN shop_aliases a ON r.shop_name = a.raw_name AND a.user_id = r.user_id
        WHERE r.user_id = ? 
        GROUP BY display_name, r.address
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
