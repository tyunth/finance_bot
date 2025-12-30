const db = require('../../db');
const ExcelJS = require('exceljs'); // Требует: npm install exceljs

// Старый CSV (оставляем, если нужен для веба)
async function generateCsv(userId) {
    const txs = await db.dbAll('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC', [userId]);
    const header = ['ID', 'Date', 'Type', 'Category', 'Amount', 'Comment', 'Tag'].join(';');
    const rows = txs.map(t => {
        const comment = (t.comment || '').replace(/"/g, '""').replace(/\n/g, ' ');
        const tag = (t.tag || '').replace(/"/g, '""');
        return [t.id, t.date, t.type, `"${t.category}"`, t.amount, `"${comment}"`, `"${tag}"`].join(';');
    });
    return '\uFEFF' + [header, ...rows].join('\n');
}

// 🔥 НОВАЯ ФУНКЦИЯ ДЛЯ БОТА
async function generateUserExcel(userId) {
    // 1. Получаем данные
    const txs = await db.dbAll('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC', [userId]);

    // 2. Создаем книгу Excel
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Финансы');

    // 3. Настраиваем колонки
    sheet.columns = [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Дата', key: 'date', width: 15 },
        { header: 'Тип', key: 'type', width: 10 },
        { header: 'Категория', key: 'category', width: 20 },
        { header: 'Сумма', key: 'amount', width: 15 },
        { header: 'Тег', key: 'tag', width: 15 },
        { header: 'Комментарий', key: 'comment', width: 30 }
    ];

    // 4. Заполняем данными
    txs.forEach(t => {
        sheet.addRow({
            id: t.id,
            date: t.date.split('T')[0], // Оставляем только дату YYYY-MM-DD
            type: t.type === 'income' ? 'Доход' : (t.type === 'expense' ? 'Расход' : 'Перевод'),
            category: t.category,
            amount: t.amount,
            tag: t.tag,
            comment: t.comment
        });
    });

    // Красим шапку (опционально)
    sheet.getRow(1).font = { bold: true };
    
    // 5. Возвращаем буфер (файл в памяти)
    return await workbook.xlsx.writeBuffer();
}

module.exports = { generateCsv, generateUserExcel };
