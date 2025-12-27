const db = require('../../db');

async function generateCsv() {
    // 1. Берем все транзакции
    const txs = await db.dbAll('SELECT * FROM transactions ORDER BY date DESC');
    
    // 2. Заголовки CSV
    const header = ['ID', 'Date', 'Type', 'Category', 'Amount', 'Comment', 'Tag'].join(';');
    
    // 3. Данные
    const rows = txs.map(t => {
        // Экранируем кавычки и заменяем переносы строк, чтобы CSV не сломался
        const comment = (t.comment || '').replace(/"/g, '""').replace(/\n/g, ' ');
        const tag = (t.tag || '').replace(/"/g, '""');
        
        return [
            t.id,
            t.date,
            t.type,
            `"${t.category}"`, // Категории в кавычки
            t.amount,
            `"${comment}"`,
            `"${tag}"`
        ].join(';');
    });

    // 4. Склеиваем (с BOM для корректного открытия в Excel на Windows)
    return '\uFEFF' + [header, ...rows].join('\n');
}

module.exports = { generateCsv };
