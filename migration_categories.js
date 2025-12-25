const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const config = require('./config'); // Подключаем твой конфиг, чтобы взять данные
require('dotenv').config();

const DB_PATH = path.resolve(__dirname, 'finance.db');
const db = new sqlite3.Database(DB_PATH);

// Берем ID админа (тебя), чтобы сохранить категории именно для тебя
const MY_ID = config.adminId || process.env.ADMIN_ID;

if (!MY_ID) {
    console.error('❌ Ошибка: Не найден ADMIN_ID в конфиге или .env');
    process.exit(1);
}

db.serialize(() => {
    console.log('⏳ Создаем таблицу categories...');

    // 1. Создаем таблицу
    // type: 'expense' (расход) или 'income' (доход)
    db.run(`CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        type TEXT,
        created_at TEXT
    )`);

    // 2. Переносим РАСХОДЫ из конфига
    // config.EXPENSE_CATEGORIES обычно массив массивов (для кнопок), поэтому делаем .flat()
    const expenses = (config.EXPENSE_CATEGORIES || []).flat();
    
    const stmt = db.prepare("INSERT INTO categories (user_id, name, type, created_at) VALUES (?, ?, 'expense', ?)");
    const now = new Date().toISOString();

    console.log(`📥 Переносим ${expenses.length} категорий расходов для ID ${MY_ID}...`);

    expenses.forEach(cat => {
        stmt.run(MY_ID, cat, now);
    });

    stmt.finalize();
    console.log('✅ Готово!');
});

db.close();
