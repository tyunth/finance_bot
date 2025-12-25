const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const config = require('./config');
require('dotenv').config();

const DB_PATH = path.resolve(__dirname, 'finance.db');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    console.log('🏋️‍♂️ Создаем таблицы для Спорта...');

    // 1. ПЛАНЫ (Храним структуру недели в JSON)
    db.run(`CREATE TABLE IF NOT EXISTS sport_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT,
        plan_data TEXT, 
        is_active INTEGER DEFAULT 1,
        created_at TEXT
    )`);

    // 2. ЛОГИ (Прогресс: кто, что, когда, сколько)
    db.run(`CREATE TABLE IF NOT EXISTS sport_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        exercise_name TEXT,
        date TEXT,
        count INTEGER DEFAULT 0,
        is_done INTEGER DEFAULT 0
    )`);

    // 3. НАСТРОЙКИ (Включаем модуль для админа)
    db.run(`CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER,
        key TEXT,
        value TEXT,
        PRIMARY KEY (user_id, key)
    )`);

    const adminId = config.ADMIN_ID || process.env.ADMIN_ID;
    if (adminId) {
        const stmt = db.prepare("INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, 'module_sport', '1')");
        stmt.run(adminId);
        stmt.finalize();
    }

    console.log('✅ Готово! Таблицы созданы.');
});

db.close();
