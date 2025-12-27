const db = require('../../db');

// 🔥 Теперь принимаем userId
async function generateCsv(userId) {
    // 1. Берем транзакции ТОЛЬКО этого пользователя
    const txs = await db.dbAll('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC', [userId]);
    
    // 2. Заголовки CSV
    const header = ['ID', 'Date', 'Type', 'Category', 'Amount', 'Comment', 'Tag'].join(';');
    
    // 3. Данные
    const rows = txs.map(t => {
        // Экранируем кавычки и убираем переносы строк
        const comment = (t.comment || '').replace(/"/g, '""').replace(/\n/g, ' ');
        const tag = (t.tag || '').replace(/"/g, '""');
        
        return [
            t.id,
            t.date,
            t.type,
            `"${t.category}"`,
            t.amount,
            `"${comment}"`,
            `"${tag}"`
        ].join(';');
    });

    return '\uFEFF' + [header, ...rows].join('\n');
}

module.exports = { generateCsv };
