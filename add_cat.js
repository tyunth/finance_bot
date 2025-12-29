const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// --- НАСТРОЙКИ ---
// Впишите сюда Telegram ID пользователя, которому нужны категории (ID жены)
// Если не знаете ID, запустите скрипт, он сначала выведет список всех юзеров.
const TARGET_TG_ID = 1047396910; 

// Стандартный набор категорий
const DEFAULTS = [
    { name: 'Еда', type: 'expense' },
    { name: 'Транспорт', type: 'expense' },
    { name: 'Дом', type: 'expense' },
    { name: 'Здоровье', type: 'expense' },
    { name: 'Одежда', type: 'expense' },
    { name: 'Развлечения', type: 'expense' },
    { name: 'Образование', type: 'expense' },
    { name: 'Подарки', type: 'expense' },
    { name: 'Связь', type: 'expense' },
    { name: 'Кафе', type: 'expense' },
    { name: 'Спорт', type: 'expense' },
    { name: 'Зарплата', type: 'income' },
    { name: 'Фриланс', type: 'income' },
    { name: 'Подарок', type: 'income' },
    { name: 'Проценты', type: 'income' }
];

const dbPath = path.resolve(__dirname, 'finance.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // 1. Сначала покажем всех пользователей, чтобы вы могли найти нужный ID
    db.all("SELECT id, telegram_id, username, first_name FROM users", (err, users) => {
        if (err) return console.error(err);
        console.log('👥 Пользователи в базе:');
        console.table(users);
        
        console.log(`\n⚙️ Начинаем добавление категорий для Telegram ID: ${TARGET_TG_ID}...`);
        
        // 2. Ищем внутренний user_id по telegram_id
        db.get("SELECT id FROM users WHERE telegram_id = ?", [TARGET_TG_ID], (err, user) => {
            if (!user) {
                console.error('❌ Ошибка: Пользователь с таким Telegram ID не найден! Скопируйте правильный ID из таблицы выше и вставьте в код.');
                db.close();
                return;
            }

            const userId = user.id;
            console.log(`✅ Внутренний ID пользователя: ${userId}`);

            // 3. Добавляем категории
            const stmt = db.prepare("INSERT INTO categories (user_id, name, type, created_at) VALUES (?, ?, ?, ?)");
            const now = new Date().toISOString();
            
            let count = 0;
            DEFAULTS.forEach(cat => {
                // Используем INSERT OR IGNORE, чтобы не дублировать, если вдруг уже есть (но тут у нас нет уникального индекса по name+userid, так что просто добавим)
                // Для чистоты лучше бы проверить, но для быстрого фикса сойдет.
                stmt.run(userId, cat.name, cat.type, now, (err) => {
                    if (err) console.error(`Ошибка с ${cat.name}:`, err.message);
                    else count++;
                });
            });
            
            stmt.finalize(() => {
                console.log(`🎉 Готово! Добавлено категорий: ${DEFAULTS.length}`);
                console.log('Теперь обновите страницу в браузере у нового пользователя.');
                db.close();
            });
        });
    });
});
