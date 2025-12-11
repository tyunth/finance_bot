const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.resolve(__dirname, 'finance.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err.message);
    } else {
        console.log('Подключение к SQLite успешно.');
        initializeTables();
    }
});

function initializeTables() {
    db.serialize(() => {
        // Транзакции
        db.run(`CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, amount REAL, category TEXT, tag TEXT, comment TEXT, date TEXT, source_account TEXT, target_account TEXT
        )`);
        
        // Счета
        db.run(`CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, balance REAL DEFAULT 0, is_deposit INTEGER DEFAULT 0, rate REAL DEFAULT 0, term_date TEXT, bank_name TEXT, start_date TEXT, UNIQUE(user_id, name)
        )`);

        // Обработанные события календаря
        db.run(`CREATE TABLE IF NOT EXISTS processed_events (
            event_id TEXT PRIMARY KEY, summary TEXT, date TEXT, status TEXT
        )`);

        // Долги
        db.run(`CREATE TABLE IF NOT EXISTS debts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, student_name TEXT, subject TEXT, amount REAL, date TEXT, event_id TEXT, is_paid INTEGER DEFAULT 0
        )`);

        // Чеки
        db.run(`CREATE TABLE IF NOT EXISTS receipt_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id INTEGER, item_name TEXT, price REAL, quantity REAL DEFAULT 1, shop_name TEXT, date TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS product_mappings (
            raw_name TEXT PRIMARY KEY, category TEXT
        )`);

        // Обучение
        db.run(`CREATE TABLE IF NOT EXISTS keywords (
            keyword TEXT PRIMARY KEY, category TEXT
        )`);

        // Ученики
        db.run(`CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            name TEXT, subject TEXT, parents TEXT, 
            school TEXT, grade TEXT, teacher TEXT, 
            phone TEXT, address TEXT, notes TEXT,
            parent_phone TEXT
        )`);

        // --- НОВЫЕ ТАБЛИЦЫ ---

        // 1. Покупки и Вишлист
        db.run(`CREATE TABLE IF NOT EXISTS shopping_list (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            item_name TEXT, 
            type TEXT, 
            person_name TEXT, 
            price_estimate REAL DEFAULT 0,
            status TEXT DEFAULT 'active',
            created_at TEXT
        )`);

        // 2. Коммуналка (Показания и Тарифы)
        db.run(`CREATE TABLE IF NOT EXISTS utility_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            service_type TEXT,
            meter_value REAL,
            consumption REAL,
            tariff_price REAL,
            total_cost REAL,
            image_path TEXT
        )`);

        // Миграции для существующих таблиц
        // Добавляем lesson_type в транзакции, чтобы отличать Пробные от Обычных
        
        
        // Миграции (добавление колонок, если их нет)
        const runMigration = (table, col, type = 'TEXT') => {
            db.all(`PRAGMA table_info(${table})`, (err, cols) => {
                if (!err && !cols.map(c => c.name).includes(col)) {
                    db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
                    console.log(`Migration: Added ${col} to ${table}`);
                }
            });
        };

        ['comment', 'tag', 'source_account', 'target_account'].forEach(c => runMigration('transactions', c));
        ['rate', 'term_date', 'bank_name', 'start_date'].forEach(c => runMigration('accounts', c));
        ['parent_phone'].forEach(c => runMigration('students', c)); // <--- НОВАЯ МИГРАЦИЯ
        ['lesson_type'].forEach(c => runMigration('transactions', c));
        ['sort_order'].forEach(c => runMigration('shopping_list', c, 'INTEGER DEFAULT 0'));
    });
}

const dbRun = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(e) { e ? reject(e) : resolve(this) }));
const dbAll = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (e, r) => e ? reject(e) : resolve(r)));
const dbGet = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (e, r) => e ? reject(e) : resolve(r)));

// --- БИЗНЕС-ЛОГИКА ---

async function ensureMainAccount(userId) {
    try { await dbRun('INSERT OR IGNORE INTO accounts (user_id, name, balance) VALUES (?, ?, ?)', [userId, 'Основной', 0]); } catch (e) {}
}

async function addTransaction(data) {
    const { userId, type, amount, category, tag, comment, sourceAccount, targetAccount, lesson_type } = data;
    const date = data.date || new Date().toISOString();
    return dbRun(
        `INSERT INTO transactions (user_id, type, amount, category, tag, comment, date, source_account, target_account, lesson_type) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, type, amount, category, tag, comment, date, sourceAccount, targetAccount, lesson_type]
    );
}

async function getBalances(userId) {
    const accountsList = await dbAll('SELECT name, is_deposit, rate, term_date, bank_name, start_date FROM accounts WHERE user_id = ?', [userId]);
    const balances = {};
    accountsList.forEach(a => balances[a.name] = 0);
    if (!balances['Основной']) balances['Основной'] = 0;

    const transactions = await dbAll('SELECT type, amount, source_account, target_account FROM transactions WHERE user_id = ?', [userId]);
    transactions.forEach(t => {
        if (t.type === 'income' && t.target_account) balances[t.target_account] = (balances[t.target_account] || 0) + t.amount;
        else if (t.type === 'expense' && t.source_account) balances[t.source_account] = (balances[t.source_account] || 0) - t.amount;
        else if (t.type === 'transfer') {
            if (t.source_account) balances[t.source_account] = (balances[t.source_account] || 0) - t.amount;
            if (t.target_account) balances[t.target_account] = (balances[t.target_account] || 0) + t.amount;
        }
    });
    return { balances, accountsList };
}

async function getPeriodStats(userId, startDate) {
    const rows = await dbAll(`SELECT type, amount FROM transactions WHERE user_id = ? AND type IN ('income', 'expense') AND date >= ?`, [userId, startDate]);
    let income = 0, expense = 0;
    rows.forEach(t => {
        if (t.type === 'income') income += t.amount;
        else expense += t.amount;
    });
    return { income, expense };
}

async function getCategoryStats(userId, startDate) {
    const rows = await dbAll(`SELECT category, amount FROM transactions WHERE user_id = ? AND type = 'expense' AND date >= ?`, [userId, startDate]);
    const stats = {};
    rows.forEach(r => {
        stats[r.category] = (stats[r.category] || 0) + r.amount;
    });
    return stats;
}

// Функции для календаря и долгов
async function isEventProcessed(eventId) {
    const row = await dbGet('SELECT event_id FROM processed_events WHERE event_id = ?', [eventId]);
    return !!row;
}
async function markEventProcessed(eventId, summary, status) {
    const date = new Date().toISOString();
    await dbRun('INSERT OR REPLACE INTO processed_events (event_id, summary, date, status) VALUES (?, ?, ?, ?)', [eventId, summary, date, status]);
}
async function addDebt(userId, studentName, subject, amount, eventId) {
    const date = new Date().toISOString();
    await dbRun('INSERT INTO debts (user_id, student_name, subject, amount, date, event_id) VALUES (?, ?, ?, ?, ?, ?)', 
        [userId, studentName, subject, amount, date, eventId]);
}
async function getDebts(userId) {
    return dbAll('SELECT * FROM debts WHERE user_id = ? AND is_paid = 0', [userId]);
}

// Функции для чеков
async function getProductCategory(rawName) {
    const cleanName = rawName.trim(); 
    const row = await dbGet('SELECT category FROM product_mappings WHERE raw_name = ?', [cleanName]);
    return row ? row.category : null;
}
async function learnProductCategory(rawName, category) {
    const cleanName = rawName.trim();
    await dbRun('INSERT OR REPLACE INTO product_mappings (raw_name, category) VALUES (?, ?)', [cleanName, category]);
}
async function saveReceiptItems(transactionId, shopName, items, dateStr) {
    const date = dateStr || new Date().toISOString();
    for (const item of items) {
        await dbRun(
            `INSERT INTO receipt_items (transaction_id, item_name, price, quantity, shop_name, date) VALUES (?, ?, ?, ?, ?, ?)`,
            [transactionId, item.name, item.price, 1, shopName, date]
        );
    }
}

async function getCategoryByComment(comment) {
    if (!comment) return null;
    const cleanComment = comment.trim().toLowerCase();
    const row = await dbGet('SELECT category FROM keywords WHERE keyword = ?', [cleanComment]);
    return row ? row.category : null;
}

async function learnKeyword(comment, category) {
    if (!comment) return;
    const cleanComment = comment.trim().toLowerCase();
    if (cleanComment.length > 50) return;
    await dbRun('INSERT OR REPLACE INTO keywords (keyword, category) VALUES (?, ?)', [cleanComment, category]);
    console.log(`🧠 Выучил: "${cleanComment}" -> ${category}`);
}

async function wasInterestPaidThisMonth(userId, accountName) {
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7); 
    const row = await dbGet(
        `SELECT id FROM transactions WHERE user_id = ? AND category = 'Проценты' AND target_account = ? AND date LIKE ?`, 
        [userId, accountName, `${currentMonth}%`]
    );
    return !!row;
}

// --- УЧЕНИКИ ---

async function getStudents() {
    return dbAll('SELECT * FROM students ORDER BY name ASC');
}

async function addStudent(data) {
    // ВАЖНО: Тут обновлен список полей, добавлен parent_phone
    const { name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone } = data;
    return dbRun(
        `INSERT INTO students (name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone]
    );
}

async function updateStudent(data) {
    const { id, name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone } = data;
    return dbRun(
        `UPDATE students SET name=?, subject=?, parents=?, school=?, grade=?, teacher=?, phone=?, address=?, notes=?, parent_phone=?
         WHERE id=?`,
        [name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone, id]
    );
}

async function deleteStudent(id) {
    return dbRun('DELETE FROM students WHERE id = ?', [id]);
}

// --- СПИСОК ПОКУПОК ---
async function getShoppingList() {
    return dbAll("SELECT * FROM shopping_list WHERE status = 'active' ORDER BY sort_order ASC, id ASC");
}

async function addShoppingItem(item) {
    const { item_name, type, person_name, price_estimate } = item;
    const created_at = new Date().toISOString();
    return dbRun(
        `INSERT INTO shopping_list (item_name, type, person_name, price_estimate, status, created_at) 
         VALUES (?, ?, ?, ?, 'active', ?)`,
        [item_name, type, person_name, price_estimate, created_at]
    );
}

async function updateShoppingStatus(id, status) {
    return dbRun("UPDATE shopping_list SET status = ? WHERE id = ?", [status, id]);
}

async function reorderShoppingList(ids) {
    // ids - массив [5, 2, 8], где 5 - первый, 2 - второй и т.д.
    const promises = ids.map((id, index) => {
        return dbRun("UPDATE shopping_list SET sort_order = ? WHERE id = ?", [index, id]);
    });
    return Promise.all(promises);
}

// Статистика по конкретному ученику
async function getStudentStats(studentName) {
    // Используем строгое равенство для тега, чтобы "Али" не находил "Алину"
    // Предполагаем, что тег всегда формируется как "Ученик: Имя"
    return dbAll(
        `SELECT * FROM transactions 
         WHERE type = 'income' 
         AND tag = ? 
         ORDER BY date DESC`, 
        [`Ученик: ${studentName}`]
    );
}

module.exports = {
    db, dbRun, dbAll, dbGet,
    ensureMainAccount, addTransaction, getBalances, getPeriodStats, getCategoryStats,
    isEventProcessed, markEventProcessed, addDebt, getDebts,
    getProductCategory, learnProductCategory, saveReceiptItems,
    getCategoryByComment, learnKeyword, wasInterestPaidThisMonth,
    getStudents, addStudent, updateStudent, deleteStudent, getStudentStats,
    getShoppingList, addShoppingItem, updateShoppingStatus, reorderShoppingList,
    DB_PATH
};
