const XLSX = require('xlsx');
const db = require('./db');

async function generateUserExcel(userId) {
    // 1. Создаем новую книгу
    const workbook = XLSX.utils.book_new();

    // --- ЛИСТ 1: ТРАНЗАКЦИИ ---
    // Получаем сырые данные
    const transactions = await db.dbAll(
        'SELECT date, type, amount, category, tag, comment, source_account, target_account FROM transactions WHERE user_id = ? ORDER BY date DESC', 
        [userId]
    );
    
    // Преобразуем для Excel (Заголовки на русском)
    const txData = transactions.map(t => ({
        'Дата': t.date,
        'Тип': t.type === 'income' ? 'Доход' : (t.type === 'expense' ? 'Расход' : 'Перевод'),
        'Сумма': t.amount,
        'Категория': t.category,
        'Тег': t.tag,
        'Комментарий': t.comment,
        'Счет списания': t.source_account,
        'Счет зачисления': t.target_account
    }));
    
    if (txData.length > 0) {
        const txSheet = XLSX.utils.json_to_sheet(txData);
        // Настраиваем ширину колонок
        txSheet['!cols'] = [{wch:12}, {wch:10}, {wch:10}, {wch:15}, {wch:15}, {wch:30}, {wch:15}, {wch:15}];
        XLSX.utils.book_append_sheet(workbook, txSheet, 'История');
    } else {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{Info: 'Нет данных'}]), 'История');
    }

    // --- ЛИСТ 2: ЗАДАЧИ ---
    const todos = await db.getTodos(userId);
    const todoData = todos.map(t => ({
        'Задача': t.text,
        'Статус': t.is_done ? 'Готово' : 'В процессе',
        'Приоритет': t.period,
        'Создано': t.created_at
    }));

    if (todoData.length > 0) {
        const todoSheet = XLSX.utils.json_to_sheet(todoData);
        todoSheet['!cols'] = [{wch:40}, {wch:12}, {wch:10}, {wch:20}];
        XLSX.utils.book_append_sheet(workbook, todoSheet, 'Задачи');
    }

    // --- ЛИСТ 3: ПОКУПКИ ---
    const shopList = await db.getShoppingList(userId);
    const shopData = shopList.map(s => ({
        'Товар': s.title,
        'Тип': s.type,
        'Статус': s.is_bought ? 'Куплено' : 'Нужно купить',
        'Цена (план)': s.price_estimate
    }));

    if (shopData.length > 0) {
        const shopSheet = XLSX.utils.json_to_sheet(shopData);
        shopSheet['!cols'] = [{wch:30}, {wch:10}, {wch:15}, {wch:12}];
        XLSX.utils.book_append_sheet(workbook, shopSheet, 'Покупки');
    }

    // 2. Генерируем буфер
    // write возвращает буфер, который можно сразу отправить в Телеграм
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    return buffer;
}

module.exports = { generateUserExcel };
