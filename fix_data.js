const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Укажите правильный путь к базе
const dbPath = path.resolve(__dirname, 'finance.db'); // или data/database.db

const db = new sqlite3.Database(dbPath);

const MY_ID = 1; // Ваш ID, который мы увидели в логах

db.serialize(() => {
    // 1. Присваиваем транзакции
    db.run(`UPDATE transactions SET user_id = ? WHERE user_id IS NULL OR user_id = 0`, [MY_ID], function(err) {
        if(err) console.error(err);
        else console.log(`Обновлено транзакций: ${this.changes}`);
    });

    // 2. Присваиваем категории (если нужно)
    // (Обычно категории общие, но если у вас есть таблица категорий с user_id)
    // db.run(`UPDATE categories SET user_id = ? WHERE user_id IS NULL`, [MY_ID]);

    console.log('Готово! Перезагрузите страницу в браузере.');
});

db.close();
