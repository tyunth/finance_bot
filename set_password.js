const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

// --- НАСТРОЙКИ (ЗАПОЛНИ ЭТО) ---
const TARGET_TG_ID = 1047396910; // <--- Вставь сюда ID из шага 1
const NEW_LOGIN = 'Galina';       // Придумай логин
const NEW_PASSWORD = '180798';     // Придумай пароль
const ACCESS_MODULES = 'shopping,todos'; // К чему дать доступ? (или 'all')
// ------------------------------

const dbPath = path.resolve(__dirname, 'finance.db');
const db = new sqlite3.Database(dbPath);

console.log(`🔍 Ищем пользователя с ID ${TARGET_TG_ID}...`);

const salt = bcrypt.genSaltSync(10);
const hash = bcrypt.hashSync(NEW_PASSWORD, salt);

// Мы делаем UPDATE, а не INSERT
const sql = `
    UPDATE users 
    SET username = ?, 
        password = ?, 
        modules = ?,
        is_approved = 1 
    WHERE telegram_id = ?
`;

db.run(sql, [NEW_LOGIN, hash, ACCESS_MODULES, TARGET_TG_ID], function(err) {
    if (err) {
        console.error('❌ Ошибка базы данных:', err.message);
    } else if (this.changes === 0) {
        console.error('⚠️ Пользователь с таким Telegram ID не найден в базе!');
        console.error('Пусть он сначала нажмет /start в боте.');
    } else {
        console.log('🎉 Успех!');
        console.log(`Теперь пользователь ${TARGET_TG_ID} может войти.`);
        console.log(`Логин: ${NEW_LOGIN}`);
        console.log(`Пароль: ${NEW_PASSWORD}`);
    }
    db.close();
});
