// Определение User ID
const TG = window.Telegram?.WebApp;
let CURRENT_USER_ID = null;

if (TG && TG.initDataUnsafe && TG.initDataUnsafe.user) {
    CURRENT_USER_ID = TG.initDataUnsafe.user.id;
    TG.expand();
} else {
    const urlParams = new URLSearchParams(window.location.search);
    const paramId = urlParams.get('userId');
    if (paramId) CURRENT_USER_ID = parseInt(paramId);
}

const BASE_URL = '/budzet';

// Глобальный перехват ошибок 401
export async function fetchWithAuth(url, options) {
    const res = await fetch(url, options);
    if (res.status === 401) {
        window.location.href = '/budzet/login.html';
        throw new Error('Unauthorized');
    }
    return res;
}

async function request(endpoint, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (CURRENT_USER_ID) headers['X-User-Id'] = CURRENT_USER_ID;

    const config = { method, headers };
    if (body) config.body = JSON.stringify(body);

    try {
        const res = await fetch(`${BASE_URL}${endpoint}`, config);
        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error(`Request failed: ${endpoint}`, e);
        throw e;
    }
}

export const API = {
    getUserId: () => CURRENT_USER_ID,
    
    finance: {
        getTransactions: () => request('/transactions'),
        getBalances: () => request('/balances'),
        getCategories: () => request('/categories'),
        addTransaction: (data) => request('/transactions/add', 'POST', data),
        editTransaction: (data) => request('/transactions/edit', 'POST', data)
    },
    students: {
        getAll: () => request('/students'),
        getStats: (id) => request(`/students/stats?id=${id}`),
        action: (data) => request('/students/action', 'POST', data),
        getDebts: () => request('/debts'),
        payDebt: (id) => request('/debts/pay', 'POST', { id })
    },
    shopping: {
        getAll: () => request('/shopping'),
        action: (data) => request('/shopping/action', 'POST', data)
    },
    todos: {
        getAll: () => request('/todos'),
        action: (data) => request('/todos/action', 'POST', data)
    },
    utilities: {
        getAll: () => request('/utilities'),
        action: (data) => request('/utilities/action', 'POST', data)
    },
    trash: {
        getAll: () => request('/trash'),
        restore: (type, id) => request('/trash/restore', 'POST', { type, id })
    },
    system: {
        getConfig: () => request('/config'),
        getKPI: (month) => request(`/stats/kpi?month=${month}`),
        getUsers: () => request('/admin/users'),
        updateModules: (telegramId, modules) => request('/admin/users/modules', 'POST', { telegramId, modules }),
        getMe: () => request('/users/me'),
        
        // 🔥 НОВЫЕ МЕТОДЫ
        getSettings: () => request('/settings'),
        saveSetting: (key, value) => request('/settings', 'POST', { key, value })
    }
};
