const API_BASE_URL = '/budzet'; 
const API_URL_TX = API_BASE_URL + '/transactions';
const API_URL_EDIT = API_BASE_URL + '/transactions/edit';
const API_URL_CATEGORIES = API_BASE_URL + '/categories';

const CURRENCY = 'T';

// Глобальные переменные
let ALL_CATEGORIES = [];
let RAW_DATA = [];
let FILTERED_DATA = [];
let chartsInstance = {}; 

// --- УТИЛИТЫ ---
function formatCurrency(amount) {
    return new Intl.NumberFormat('ru-RU').format(amount) + ' ' + CURRENCY;
}

// --- УПРАВЛЕНИЕ ВКЛАДКАМИ ---
function switchTab(tabName) {
    ['analytics', 'transactions'].forEach(t => {
        document.getElementById(`tab-${t}`).classList.add('hidden');
        document.getElementById(`btn-${t}`).classList.remove('active');
    });
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    document.getElementById(`btn-${tabName}`).classList.add('active');
}

// --- ИНИЦИАЛИЗАЦИЯ ---
async function init() {
    try {
        // Грузим категории
        const catRes = await fetch(API_URL_CATEGORIES);
        ALL_CATEGORIES = await catRes.json();
        
        const filterSel = document.getElementById('filter-category');
        filterSel.innerHTML = '<option value="ALL">Все категории</option>';
        ALL_CATEGORIES.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            filterSel.appendChild(opt);
        });

        // Грузим транзакции
        const txRes = await fetch(API_URL_TX);
        RAW_DATA = await txRes.json();
        
        document.getElementById('loading').style.display = 'none';
        document.getElementById('filter-panel').classList.remove('hidden');

        FILTERED_DATA = [...RAW_DATA];

        applyFilters(); 
        switchTab('analytics');

    } catch (e) {
        console.error(e);
        const loadEl = document.getElementById('loading');
        loadEl.textContent = 'Ошибка API. Проверьте консоль.';
        loadEl.className = 'text-center py-10 text-red-600 font-bold';
    }
}

// --- ФИЛЬТРАЦИЯ ---
function applyFilters() {
    const startStr = document.getElementById('filter-date-start').value;
    const endStr = document.getElementById('filter-date-end').value;
    const catVal = document.getElementById('filter-category').value;

    const startDate = startStr ? new Date(startStr) : null;
    const endDate = endStr ? new Date(endStr) : null;
    if (endDate) endDate.setHours(23, 59, 59);

    FILTERED_DATA = RAW_DATA.filter(t => {
        const tDate = new Date(t.date);
        if (startDate && tDate < startDate) return false;
        if (endDate && tDate > endDate) return false;
        if (catVal !== 'ALL' && t.category !== catVal) return false;
        return true;
    });

    renderAnalytics(FILTERED_DATA);
    renderTable(FILTERED_DATA);
}

function resetFilters() {
    document.getElementById('filter-date-start').value = '';
    document.getElementById('filter-date-end').value = '';
    document.getElementById('filter-category').value = 'ALL';
    applyFilters();
}

// --- АНАЛИТИКА ---
function renderAnalytics(data) {
    let totalIncome = 0;
    let totalExpense = 0;
    
    const categoryMap = {};
    const monthMap = {}; 
    const dayOfWeekMap = [0,0,0,0,0,0,0]; // Вс=0, Пн=1 ...
    
    // Для частоты (Категории и Комментарии)
    const catFrequency = {};
    const commentFrequency = {};

    data.forEach(t => {
        if (t.type === 'transfer') return;

        const amount = parseFloat(t.amount);
        const dateObj = new Date(t.date);
        
        // Ключ месяца: "2023-11"
        const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
        if (!monthMap[monthKey]) monthMap[monthKey] = { income: 0, expense: 0 };

        if (t.type === 'income') {
            totalIncome += amount;
            monthMap[monthKey].income += amount;
        } else if (t.type === 'expense') {
            totalExpense += amount;
            monthMap[monthKey].expense += amount;
            
            const cat = t.category || 'Без категории';
            categoryMap[cat] = (categoryMap[cat] || 0) + amount;
            catFrequency[cat] = (catFrequency[cat] || 0) + 1;
            
            // Считаем комментарии (очищаем от пробелов)
            if (t.comment && t.comment.trim().length > 0) {
                const c = t.comment.trim();
                commentFrequency[c] = (commentFrequency[c] || 0) + 1;
            }

            dayOfWeekMap[dateObj.getDay()]++;
        }
    });

    // KPI
    document.getElementById('stat-income').textContent = formatCurrency(totalIncome);
    document.getElementById('stat-expense').textContent = formatCurrency(totalExpense);
    const balance = totalIncome - totalExpense;
    document.getElementById('stat-balance').textContent = formatCurrency(balance);
    document.getElementById('stat-balance').className = `text-2xl font-bold mt-1 ${balance >= 0 ? 'text-blue-600' : 'text-red-600'}`;

    // === ГРАФИКИ ===

    // 1. Категории ("Остальное" < 4%)
    const groupedCategories = [];
    const groupedValues = [];
    let otherSum = 0;

    const sortedRawCats = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
    
    sortedRawCats.forEach(([cat, sum]) => {
        const percent = totalExpense > 0 ? (sum / totalExpense) : 0;
        if (percent < 0.04) {
            otherSum += sum;
        } else {
            groupedCategories.push(cat);
            groupedValues.push(sum);
        }
    });
    if (otherSum > 0) {
        groupedCategories.push('Остальное');
        groupedValues.push(otherSum);
    }

    const ctxCat = document.getElementById('chartCategories').getContext('2d');
    if (chartsInstance.cat) chartsInstance.cat.destroy();
    chartsInstance.cat = new Chart(ctxCat, {
        type: 'doughnut',
        data: {
            labels: groupedCategories,
            datasets: [{
                data: groupedValues,
                backgroundColor: [
                    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', 
                    '#ec4899', '#6366f1', '#14b8a6', '#94a3b8', '#64748b' 
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 12 } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let value = context.raw;
                            let percentage = totalExpense > 0 ? Math.round((value / totalExpense) * 100) : 0;
                            return ` ${context.label}: ${formatCurrency(value)} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });

    // 2. Дни недели
    const daysData = [
        dayOfWeekMap[1], dayOfWeekMap[2], dayOfWeekMap[3], dayOfWeekMap[4], dayOfWeekMap[5], dayOfWeekMap[6], dayOfWeekMap[0]
    ];
    
    const ctxDays = document.getElementById('chartDays').getContext('2d');
    if (chartsInstance.days) chartsInstance.days.destroy();
    chartsInstance.days = new Chart(ctxDays, {
        type: 'bar',
        data: {
            labels: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
            datasets: [{
                label: 'Покупок',
                data: daysData,
                backgroundColor: '#60a5fa',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } },
            plugins: { legend: { display: false } }
        }
    });

    // 3. Динамика по месяцам (С КЛИКОМ)
    const sortedMonths = Object.keys(monthMap).sort();
    const ctxMonth = document.getElementById('chartMonthly').getContext('2d');
    if (chartsInstance.month) chartsInstance.month.destroy();
    chartsInstance.month = new Chart(ctxMonth, {
        type: 'bar',
        data: {
            labels: sortedMonths,
            datasets: [
                { label: 'Доход', data: sortedMonths.map(m => monthMap[m].income), backgroundColor: '#10b981', borderRadius: 4 },
                { label: 'Расход', data: sortedMonths.map(m => monthMap[m].expense), backgroundColor: '#ef4444', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const monthStr = sortedMonths[index]; // "2023-11"
                    setFilterByMonth(monthStr);
                }
            }
        }
    });

    // === СПИСКИ ТОПОВ ===

    // Топ Крупных
    const topExp = data.filter(t => t.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 5);
    document.getElementById('top-expenses-list').innerHTML = topExp.map(t => `
        <tr class="hover:bg-gray-50 transition border-b border-gray-100 last:border-0">
            <td class="px-6 py-3 font-medium text-gray-800">${t.category}</td>
            <td class="px-6 py-3 text-xs text-gray-500 hidden sm:table-cell">${t.comment || ''}</td>
            <td class="px-6 py-3 font-bold text-gray-900 text-right">${formatCurrency(t.amount)}</td>
        </tr>
    `).join('');

    // Топ Частых (Категории)
    const sortedFreqCat = Object.entries(catFrequency).sort((a, b) => b[1] - a[1]).slice(0, 5);
    document.getElementById('top-freq-cat-list').innerHTML = sortedFreqCat.map(([cat, count]) => `
        <tr class="hover:bg-gray-50 transition border-b border-gray-100 last:border-0">
            <td class="py-2 font-medium text-gray-800">${cat}</td>
            <td class="py-2 text-right font-semibold text-blue-600">${count}</td>
        </tr>
    `).join('');

    // Топ Частых (Комментарии) - НОВОЕ
    const sortedFreqComment = Object.entries(commentFrequency).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const commentListEl = document.getElementById('top-freq-comment-list');
    
    if (sortedFreqComment.length === 0) {
        commentListEl.innerHTML = '<tr><td class="text-xs text-gray-400 py-2">Нет комментариев</td></tr>';
    } else {
        commentListEl.innerHTML = sortedFreqComment.map(([comm, count]) => `
            <tr class="hover:bg-gray-50 transition border-b border-gray-100 last:border-0">
                <td class="py-2 text-sm text-gray-700">"${comm}"</td>
                <td class="py-2 text-right font-semibold text-gray-500 text-xs">${count} раз</td>
            </tr>
        `).join('');
    }
}

// Вспомогательная функция для клика по графику
function setFilterByMonth(monthStr) {
    // monthStr format "YYYY-MM"
    const [year, month] = monthStr.split('-').map(Number);
    
    // Начало месяца
    const start = new Date(year, month - 1, 1);
    // Конец месяца (0 день следующего месяца = последний день текущего)
    const end = new Date(year, month, 0);

    // Форматируем в YYYY-MM-DD для input type="date"
    const fmt = d => d.toISOString().split('T')[0];

    document.getElementById('filter-date-start').value = fmt(start);
    document.getElementById('filter-date-end').value = fmt(end);
    
    // Применяем
    applyFilters();
}


// --- ТАБЛИЦА (Без изменений логики) ---
function renderTable(data) {
    const headerRow = document.getElementById('table-header');
    const body = document.getElementById('table-body');
    headerRow.innerHTML = '';
    body.innerHTML = '';

    const keys = [
        {k: 'date', label: 'Дата'}, 
        {k: 'category', label: 'Категория'}, 
        {k: 'comment', label: 'Комментарий'}, 
        {k: 'amount', label: 'Сумма'}
    ];

    keys.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col.label.toUpperCase();
        th.className = 'px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider';
        headerRow.appendChild(th);
    });
    headerRow.innerHTML += '<th class="px-6 py-3"></th>'; 

    const dataToShow = data.slice(0, 100); 

    dataToShow.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 transition border-b border-gray-100 ' + 
            (item.type === 'income' ? 'border-l-4 border-l-green-400' : (item.type === 'expense' ? 'border-l-4 border-l-red-400' : ''));

        keys.forEach(col => {
            const td = document.createElement('td');
            td.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-700';
            let val = item[col.k];
            
            if (col.k === 'amount') {
                td.textContent = formatCurrency(val);
                td.className += ' font-bold';
            } else if (col.k === 'date') {
                td.textContent = new Date(val).toLocaleDateString('ru-RU');
            } else {
                td.textContent = val || '—';
            }
            tr.appendChild(td);
        });

        const tdAct = document.createElement('td');
        tdAct.className = 'px-6 py-4 whitespace-nowrap text-right text-sm font-medium';
        tdAct.innerHTML = `<button onclick='openEditModal(${JSON.stringify(item)})' class="text-blue-600 hover:text-blue-900">Изм.</button>`;
        tr.appendChild(tdAct);

        body.appendChild(tr);
    });
    
    if (data.length > 100) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="5" class="text-center py-4 text-gray-400 text-sm">Показаны первые 100 записей из ${data.length}</td>`;
        body.appendChild(tr);
    }
}

// --- РЕДАКТИРОВАНИЕ ---
function openEditModal(item) {
    document.getElementById('edit-id').value = item.id;
    document.getElementById('edit-amount').value = item.amount;
    document.getElementById('edit-comment').value = item.comment || '';
    
    const select = document.getElementById('edit-category');
    select.innerHTML = '';
    const cats = new Set([...ALL_CATEGORIES, item.category]);
    cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        select.appendChild(opt);
    });
    select.value = item.category;

    document.getElementById('edit-modal').classList.remove('hidden');
    document.getElementById('edit-modal').classList.add('flex');
}

function closeModal() {
    document.getElementById('edit-modal').classList.add('hidden');
    document.getElementById('edit-modal').classList.remove('flex');
}

document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-id').value;
    const amount = parseFloat(document.getElementById('edit-amount').value);
    const category = document.getElementById('edit-category').value;
    const comment = document.getElementById('edit-comment').value;

    try {
        const res = await fetch(API_URL_EDIT, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id, amount, category, comment})
        });
        if(res.ok) {
            closeModal();
            init();
        } else {
            alert('Ошибка сохранения');
        }
    } catch(e) { alert('Ошибка сети'); }
});

// Запуск приложения
init();
