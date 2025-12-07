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
        // ... (Существующие таблицы: transactions, accounts, processed_events, debts) ...
        db.run(`CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, amount REAL, category TEXT, tag TEXT, comment TEXT, date TEXT, source_account TEXT, target_account TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, balance REAL DEFAULT 0, is_deposit INTEGER DEFAULT 0, rate REAL DEFAULT 0, term_date TEXT, bank_name TEXT, UNIQUE(user_id, name)
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS processed_events (event_id TEXT PRIMARY KEY, summary TEXT, date TEXT, status TEXT)`);
        db.run(`CREATE TABLE IF NOT EXISTS debts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, student_name TEXT, subject TEXT, amount REAL, date TEXT, event_id TEXT, is_paid INTEGER DEFAULT 0)`);

        // --- НОВЫЕ ТАБЛИЦЫ ДЛЯ ЧЕКОВ ---

        // 1. История конкретных покупок (для инфляции)
        db.run(`CREATE TABLE IF NOT EXISTS receipt_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER, -- Связь с общей транзакцией расхода
            item_name TEXT,         -- Название товара из чека (как есть)
            price REAL,             -- Цена за единицу (или общая)
            quantity REAL DEFAULT 1,-- Количество
            shop_name TEXT,         -- Магазин
            date TEXT
        )`);

        // 2. Обучение: Связь "Название товара -> Категория"
        db.run(`CREATE TABLE IF NOT EXISTS product_mappings (
            raw_name TEXT PRIMARY KEY, -- Сырое название из чека (например "МОЛОКО 3.2%")
            category TEXT              -- Твоя категория (например "Молочка")
        )`);

        // Миграции (для старых таблиц)
        const runMigration = (table, col, type = 'TEXT') => {
            db.all(`PRAGMA table_info(${table})`, (err, cols) => {
                if (!err && !cols.map(c => c.name).includes(col)) {
                    db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
                }
            });
        };
        ['comment', 'tag', 'source_account', 'target_account'].forEach(c => runMigration('transactions', c));
        ['rate', 'term_date', 'bank_name'].forEach(c => runMigration('accounts', c));
    });
}

// Промисификация методов
const dbRun = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(e) { e ? reject(e) : resolve(this) }));
const dbAll = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (e, r) => e ? reject(e) : resolve(r)));
const dbGet = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (e, r) => e ? reject(e) : resolve(r)));

// --- СУЩЕСТВУЮЩИЕ ФУНКЦИИ (ensureMainAccount, addTransaction, getBalances...) ---
// (Оставляем их без изменений, они нужны боту)
async function ensureMainAccount(userId) { try { await dbRun('INSERT OR IGNORE INTO accounts (user_id, name, balance) VALUES (?, ?, ?)', [userId, 'Основной', 0]); } catch (e) {} }

async function addTransaction(data) {
    const { userId, type, amount, category, tag, comment, sourceAccount, targetAccount } = data;
    const date = new Date().toISOString();
    // Возвращаем ID созданной транзакции
    const result = await dbRun(
        `INSERT INTO transactions (user_id, type, amount, category, tag, comment, date, source_account, target_account) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, type, amount, category, tag, comment, date, sourceAccount, targetAccount]
    );
    return result.lastID; // Важно для связки с чеком
}

async function getBalances(userId) {
    const accountsList = await dbAll('SELECT name, is_deposit, rate, term_date, bank_name FROM accounts WHERE user_id = ?', [userId]);
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
    rows.forEach(t => { if (t.type === 'income') income += t.amount; else expense += t.amount; });
    return { income, expense };
}
async function getCategoryStats(userId, startDate) {
    const rows = await dbAll(`SELECT category, amount FROM transactions WHERE user_id = ? AND type = 'expense' AND date >= ?`, [userId, startDate]);
    const stats = {};
    rows.forEach(r => { stats[r.category] = (stats[r.category] || 0) + r.amount; });
    return stats;
}
async function isEventProcessed(eventId) { const row = await dbGet('SELECT event_id FROM processed_events WHERE event_id = ?', [eventId]); return !!row; }
async function markEventProcessed(eventId, summary, status) { const date = new Date().toISOString(); await dbRun('INSERT INTO processed_events (event_id, summary, date, status) VALUES (?, ?, ?, ?)', [eventId, summary, date, status]); }
async function addDebt(userId, studentName, subject, amount, eventId) { const date = new Date().toISOString(); await dbRun('INSERT INTO debts (user_id, student_name, subject, amount, date, event_id) VALUES (?, ?, ?, ?, ?, ?)', [userId, studentName, subject, amount, date, eventId]); }
async function getDebts(userId) { return dbAll('SELECT * FROM debts WHERE user_id = ? AND is_paid = 0', [userId]); }


// --- НОВЫЕ ФУНКЦИИ ДЛЯ ЧЕКОВ ---

// 1. Получить категорию для товара (если уже знаем)
async function getProductCategory(rawName) {
    // Упрощаем имя для поиска (убираем цифры и спецсимволы в начале/конце)
    const cleanName = rawName.trim(); 
    const row = await dbGet('SELECT category FROM product_mappings WHERE raw_name = ?', [cleanName]);
    return row ? row.category : null;
}

// 2. Запомнить категорию для товара
async function learnProductCategory(rawName, category) {
    const cleanName = rawName.trim();
    // INSERT OR REPLACE обновит категорию, если она изменилась
    await dbRun('INSERT OR REPLACE INTO product_mappings (raw_name, category) VALUES (?, ?)', [cleanName, category]);
}

// 3. Сохранить детали чека
async function saveReceiptItems(transactionId, shopName, items) {
    const date = new Date().toISOString();
    for (const item of items) {
        await dbRun(
            `INSERT INTO receipt_items (transaction_id, item_name, price, quantity, shop_name, date) VALUES (?, ?, ?, ?, ?, ?)`,
            [transactionId, item.name, item.price, 1, shopName, date] // Количество пока хардкодим 1
        );
    }
}

module.exports = {
    db, dbRun, dbAll, dbGet,
    ensureMainAccount, addTransaction, getBalances, getPeriodStats, getCategoryStats,
    isEventProcessed, markEventProcessed, addDebt, getDebts,
    getProductCategory, learnProductCategory, saveReceiptItems, // Экспорт новых функций
    DB_PATH
};
