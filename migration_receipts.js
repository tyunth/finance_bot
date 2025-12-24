const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.resolve(__dirname, 'finance.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Ошибка подключения:', err.message);
    } else {
        console.log('🔌 База данных подключена.');
        runMigration();
    }
});

function runMigration() {
    db.serialize(() => {
        console.log('⏳ Начинаем миграцию...');

        // 1. Создаем таблицу receipts (Чеки)
        db.run(`CREATE TABLE IF NOT EXISTS receipts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            shop_name TEXT,
            shop_address TEXT,
            date TEXT,
            total_sum REAL,        -- Итого по чеку
            calculated_sum REAL,   -- Сумма распознанных позиций (для сверки)
            item_count INTEGER,
            discount REAL,
            raw_json TEXT,         -- Полный ответ нейросети (на всякий случай)
            photo_file_id TEXT,    -- Ссылка на фото в Telegram
            created_at TEXT
        )`, (err) => {
            if (err) console.error('❌ Ошибка создания receipts:', err.message);
            else console.log('✅ Таблица receipts создана (или уже была).');
        });

        // 2. Связываем транзакции с чеком
        // Добавляем колонку receipt_id в таблицу transactions
        db.run(`ALTER TABLE transactions ADD COLUMN receipt_id INTEGER`, (err) => {
            if (err) {
                if (err.message.includes('duplicate column')) {
                    console.log('✅ Колонка receipt_id уже существует.');
                } else {
                    console.error('❌ Ошибка добавления receipt_id:', err.message);
                }
            } else {
                console.log('✅ Колонка receipt_id успешно добавлена в transactions.');
            }
        });
    });

    db.close((err) => {
        if (err) console.error(err.message);
        console.log('🏁 Миграция завершена. Соединение закрыто.');
    });
}
