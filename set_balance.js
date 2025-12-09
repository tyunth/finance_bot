const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.resolve(__dirname, 'finance.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err.message);
        process.exit(1);
    }
});

// Получаем аргументы из командной строки
// Пример: node set_balance.js "На машину" 500000
const accountName = process.argv[2];
const newBalance = parseFloat(process.argv[3]);

if (!accountName || isNaN(newBalance)) {
    console.log('Использование: node set_balance.js "<Название счета>" <Новый баланс>');
    console.log('Пример: node set_balance.js "Основной" 150000');
    console.log('Пример: node set_balance.js "Депозит на машину" 1000000');
    
    // Вывод списка текущих счетов для удобства
    db.all('SELECT name, balance FROM accounts', [], (err, rows) => {
        if (err) return;
        console.log('\n--- Текущие счета ---');
        rows.forEach(row => {
            console.log(`"${row.name}": ${row.balance}`);
        });
        process.exit(0);
    });
} else {
    // Выполняем обновление
    const sql = `UPDATE accounts SET balance = ? WHERE name = ?`;
    
    db.run(sql, [newBalance, accountName], function(err) {
        if (err) {
            console.error('Ошибка при обновлении:', err.message);
        } else if (this.changes === 0) {
            console.log(`Счет "${accountName}" не найден! Проверьте название (регистр важен).`);
        } else {
            console.log(`✅ Баланс счета "${accountName}" успешно изменен на ${newBalance}.`);
            console.log('Это изменение НЕ записано в историю транзакций и не повлияет на статистику доходов.');
        }
        db.close();
    });
}
