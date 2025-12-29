const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// ⚠️ УБЕДИСЬ, ЧТО ПУТЬ ПРАВИЛЬНЫЙ (как ты нашел через find)
// Скорее всего это data/budzet.db или data/database.db
const dbPath = path.resolve(__dirname, 'data/finance.db'); 

const db = new sqlite3.Database(dbPath);

const MY_NEW_ID = 1; // Твой ID админа

// Список всех таблиц из твоего db.js, где есть данные пользователя
const tables = [
    'transactions',
    'accounts',
    'students',
    'shopping_list',
    'todos',
    'utility_readings',
    'debts',
    'lesson_history',
    'processed_events',
    'receipts',
    'parcels',
    'health_stats',
    'english_words',
    'categories' // Категории тоже заберем себе
];

console.log(`🚀 Начинаем перенос всех данных на пользователя ID=${MY_NEW_ID}...`);
console.log(`📁 База: ${dbPath}`);

db.serialize(() => {
    tables.forEach(table => {
        // Мы обновляем ВСЕ записи, которые не принадлежат ID 1
        // Это безопасно, если вы единственный пользователь
        const sql = `UPDATE ${table} SET user_id = ? WHERE user_id != ? OR user_id IS NULL`;
        
        db.run(sql, [MY_NEW_ID, MY_NEW_ID], function(err) {
            if (err) {
                // Некоторые таблицы могут не существовать (если фичи не использовались), это норм
                if (err.message.includes('no such table')) {
                    console.log(`⚠️ Таблица ${table} не найдена (пропуск)`);
                } else {
                    console.error(`❌ Ошибка в ${table}:`, err.message);
                }
            } else {
                if (this.changes > 0) {
                    console.log(`✅ ${table}: присвоено записей: ${this.changes}`);
                } else {
                    console.log(`⚪ ${table}: изменений нет (уже ваши или пусто)`);
                }
            }
        });
    });
});

// Ждем завершения (грязный хак, но для скрипта сойдет)
setTimeout(() => {
    console.log('🏁 Завершено. Перезагрузите сервер (pm2 restart server) и обновите страницу.');
    db.close();
}, 2000);
