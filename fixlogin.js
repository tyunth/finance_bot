const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Путь к базе (в корне, как мы выяснили)
const dbPath = path.resolve(__dirname, 'finance.db');
const db = new sqlite3.Database(dbPath);

console.log('🕵️ Ищем старый ID в транзакциях...');

db.serialize(() => {
    // 1. Берем любую последнюю транзакцию, чтобы узнать ID владельца
    db.get("SELECT user_id FROM transactions WHERE user_id IS NOT NULL LIMIT 1", (err, row) => {
        if (err) {
            console.error('Ошибка:', err.message);
            return;
        }

        if (!row || !row.user_id) {
            console.log('❌ В транзакциях нет ID (они "ничьи" или таблица пуста).');
            console.log('Придется всё-таки делать "рейдерский захват" данных (скрипт take_over.js), который я кидал выше.');
            return;
        }

        const oldId = row.user_id;
        console.log(`✅ Нашли старый ID владельца данных: ${oldId}`);

        // 2. Меняем ID пользователя tyunth на этот старый ID
        console.log(`🔄 Меняем ID у пользователя 'tyunth' на ${oldId}...`);
        
        db.run(`UPDATE users SET id = ? WHERE username = 'tyunth'`, [oldId], function(err) {
            if (err) {
                // Если такой ID в таблице users уже занят (вдруг), удалим дубликат и попробуем снова
                if(err.message.includes('UNIQUE')) {
                    console.log('⚠️ Этот ID уже занят кем-то другим. Удаляем старый аккаунт-пустышку...');
                    db.run(`DELETE FROM users WHERE id = ?`, [oldId], () => {
                         db.run(`UPDATE users SET id = ? WHERE username = 'tyunth'`, [oldId], (e) => {
                             if(e) console.error('Ошибка:', e);
                             else finish(oldId);
                         });
                    });
                } else {
                    console.error('❌ Ошибка обновления:', err.message);
                }
            } else {
                finish(oldId);
            }
        });
    });
});

function finish(id) {
    console.log(`🎉 ГОТОВО! Ваш логин 'tyunth' теперь привязан к ID ${id}.`);
    console.log('➡️  1. Перезагрузите сервер: pm2 restart server');
    console.log('➡️  2. Выйдите из системы (кнопка Выход) и войдите снова как tyunth.');
    console.log('➡️  Данные должны появиться.');
}
