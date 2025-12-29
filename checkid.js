const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Судя по вашему db.js, база лежит в корне
const dbPath = path.resolve(__dirname, 'finance.db');

console.log(`📂 Открываю базу: ${dbPath}`);

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error('❌ Ошибка открытия базы:', err.message);
        console.error('Проверьте, что файл finance.db существует в этой папке!');
    } else {
        console.log('✅ База открыта. Ищем старые записи...');
        checkData();
    }
});

function checkData() {
    // Берем 5 последних транзакций
    db.all("SELECT id, user_id, amount, date, category FROM transactions ORDER BY id DESC LIMIT 5", [], (err, rows) => {
        if (err) {
            console.log('❌ Ошибка чтения транзакций:', err.message);
        } else if (rows.length === 0) {
            console.log('📭 Таблица transactions пуста.');
        } else {
            console.log('\n📊 Вот что мы нашли (последние 5 записей):');
            console.table(rows);
            
            console.log('\n🕵️ ВЫВОД:');
            const uids = [...new Set(rows.map(r => r.user_id))];
            if (uids.includes(null)) {
                console.log('⚠️ У записей поле user_id = NULL. Это значит, они "ничьи".');
            } else {
                console.log(`🆔 Ваши старые данные привязаны к ID: ${uids.join(', ')}`);
            }
        }
        db.close(); // Закрываем базу, ничего не меняя
    });
}
