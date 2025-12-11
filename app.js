const API_BASE_URL = '/budzet'; 
const API_URL_TX = API_BASE_URL + '/transactions';
const API_URL_EDIT = API_BASE_URL + '/transactions/edit';
const API_URL_CATEGORIES = API_BASE_URL + '/categories';
const API_URL_BALANCES = API_BASE_URL + '/balances';
const API_URL_STUDENTS = API_BASE_URL + '/students';
const API_URL_STUDENT_ACTION = API_BASE_URL + '/students/action';
const API_URL_SHOPPING = API_BASE_URL + '/shopping';
const API_URL_SHOPPING_ACTION = API_BASE_URL + '/shopping/action';

const CURRENCY = 'T';
const CALENDAR_EMBED_ID = 'polandszymon@gmail.com'; 

let ALL_CATEGORIES = [];
let RAW_DATA = [];
let FILTERED_DATA = [];
let chartsInstance = {}; 
let CHART_DATA_CACHE = {}; 

function formatCurrency(amount) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(amount)) + ' ' + CURRENCY;
}

function switchTab(tabName) {
    ['analytics', 'transactions', 'students', 'calendar', 'shopping'].forEach(t => {
        document.getElementById(`tab-${t}`).classList.add('hidden');
        document.getElementById(`btn-${t}`).classList.remove('active');
    });
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    document.getElementById(`btn-${tabName}`).classList.add('active');   
    
    if (tabName === 'calendar') loadCalendar();
    if (tabName === 'students') loadStudents();
    if (tabName === 'shopping') loadShoppingList();
}

// НОВОЕ: Отдельная функция загрузки данных без сброса вкладки
async function loadData() {
    try {
        const [catRes, txRes, balRes] = await Promise.all([
            fetch(API_URL_CATEGORIES),
            fetch(API_URL_TX),
            fetch(API_URL_BALANCES)
        ]);

        ALL_CATEGORIES = await catRes.json();
        RAW_DATA = await txRes.json();
        const balances = await balRes.json();

        // Заполняем фильтр категорий (только если список пуст, чтобы не сбрасывать выбор)
        const filterSel = document.getElementById('filter-category');
        if (filterSel.options.length <= 1) {
            filterSel.innerHTML = '<option value="ALL">Все категории</option>';
            ALL_CATEGORIES.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                filterSel.appendChild(opt);
            });
        }

        renderBalances(balances);
        return true;
    } catch (e) {
        console.error(e);
        document.getElementById('loading').textContent = 'Ошибка загрузки данных';
        return false;
    }
}

async function init() {
    const success = await loadData();
    if (success) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('filter-panel').classList.remove('hidden');
        
        FILTERED_DATA = [...RAW_DATA];
        applyFilters(); 
        
        // Переключаем на аналитику только при первом старте
        switchTab('analytics'); 
    }
}

function renderBalances(balances) {
    const list = document.getElementById('deposit-list');
    if (!balances || Object.keys(balances).length === 0) {
        list.innerHTML = 'Нет счетов';
        return;
    }
    list.innerHTML = Object.entries(balances)
        .map(([name, val]) => {
            const color = val > 0 ? 'text-green-600' : (val < 0 ? 'text-red-500' : 'text-gray-500');
            return `<div class="flex justify-between"><span>${name}:</span> <span class="${color} font-bold">${formatCurrency(val)}</span></div>`;
        })
        .join('');
}

function applyFilters() {
    const startStr = document.getElementById('filter-date-start').value;
    const endStr = document.getElementById('filter-date-end').value;
    const catVal = document.getElementById('filter-category').value;
    const typeVal = document.getElementById('filter-type').value;

    const startDate = startStr ? new Date(startStr) : null;
    const endDate = endStr ? new Date(endStr) : null;
    if (endDate) endDate.setHours(23, 59, 59);

    FILTERED_DATA = RAW_DATA.filter(t => {
        const tDate = new Date(t.date);
        if (startDate && tDate < startDate) return false;
        if (endDate && tDate > endDate) return false;
        if (catVal !== 'ALL' && t.category !== catVal) return false;
        if (typeVal !== 'ALL' && t.type !== typeVal) return false;
        return true;
    });

    renderAnalytics(FILTERED_DATA);
    renderTable(FILTERED_DATA);
}

function resetFilters() {
    document.getElementById('filter-date-start').value = '';
    document.getElementById('filter-date-end').value = '';
    document.getElementById('filter-category').value = 'ALL';
    document.getElementById('filter-type').value = 'ALL';
    applyFilters();
}

function renderAnalytics(data) {
    let totalIncome = 0;
    let totalExpense = 0;
    
    const categoryMap = {}; // Для диаграммы (может быть по категориям или по тегам)
    const monthMap = {}; 
    const dayOfWeekMap = [0,0,0,0,0,0,0]; 
    const dayOfMonthMap = new Array(32).fill(0); 

    const catFrequency = {};
    const commentFrequency = {};

    // НОВОЕ: Определяем режим группировки
    const groupBy = document.getElementById('chart-group-by').value; // 'category' или 'tag'

    data.forEach(t => {
        if (t.type === 'transfer') return;

        const amount = parseFloat(t.amount);
        const dateObj = new Date(t.date);
        const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
        
        if (!monthMap[monthKey]) monthMap[monthKey] = { income: 0, expense: 0 };

        if (t.type === 'income') {
            if (t.category !== 'Депозит') {
                totalIncome += amount;
                monthMap[monthKey].income += amount;
            }
        } else if (t.type === 'expense') {
            totalExpense += amount;
            monthMap[monthKey].expense += amount;
            
            // ГРУППИРОВКА ДЛЯ ДИАГРАММЫ
            let key = 'Прочее';
            if (groupBy === 'tag') {
                key = t.tag || 'Без тега';
            } else {
                key = t.category || 'Без категории';
            }
            categoryMap[key] = (categoryMap[key] || 0) + amount;

            // Частотный анализ всегда по категориям
            const cat = t.category || 'Без категории';
            catFrequency[cat] = (catFrequency[cat] || 0) + 1;
            
            if (t.comment && t.comment.trim()) {
                const c = t.comment.trim();
                commentFrequency[c] = (commentFrequency[c] || 0) + 1;
            }

            dayOfWeekMap[dateObj.getDay()]++;
            dayOfMonthMap[dateObj.getDate()]++;
        }
    });

    CHART_DATA_CACHE = { dayOfWeekMap, dayOfMonthMap };

    document.getElementById('stat-income').textContent = formatCurrency(totalIncome);
    document.getElementById('stat-expense').textContent = formatCurrency(totalExpense);
    const balance = totalIncome - totalExpense;
    document.getElementById('stat-balance').textContent = formatCurrency(balance);
    document.getElementById('stat-balance').className = `text-xl font-bold mt-1 ${balance >= 0 ? 'text-blue-600' : 'text-red-600'}`;

    // --- ГРАФИКИ ---

    // 1. Категории / Теги
    const groupedLabels = [];
    const groupedValues = [];
    let otherSum = 0;
    
    // Сортировка и фильтрация мелочи
    Object.entries(categoryMap).sort((a, b) => b[1] - a[1]).forEach(([name, sum]) => {
        // Показываем всё, если меньше 15 пунктов, иначе группируем мелочь < 2%
        if (Object.keys(categoryMap).length > 15 && totalExpense > 0 && (sum / totalExpense) < 0.02) {
            otherSum += sum;
        } else { 
            groupedLabels.push(name); 
            groupedValues.push(sum); 
        }
    });
    if (otherSum > 0) { groupedLabels.push('Остальное'); groupedValues.push(otherSum); }

    const ctxCat = document.getElementById('chartCategories').getContext('2d');
    if (chartsInstance.cat) chartsInstance.cat.destroy();
    chartsInstance.cat = new Chart(ctxCat, {
        type: 'doughnut',
        data: {
            labels: groupedLabels,
            datasets: [{
                data: groupedValues,
                backgroundColor: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6', '#94a3b8', '#64748b', '#71717a', '#a1a1aa'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    // Drill down пока работает только для категорий, для тегов можно допилить позже
                    const label = groupedLabels[elements[0].index];
                    if (groupBy === 'category' && label !== 'Остальное') drillDownByCategory(label);
                }
            },
            plugins: { 
                legend: { position: 'right', labels: { boxWidth: 12 } },
                // НОВОЕ: Возвращаем проценты в тултип
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

    renderDayChart();

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
            responsive: true, maintainAspectRatio: false,
            onClick: (e, elements) => { if (elements.length > 0) drillDownByMonth(sortedMonths[elements[0].index]); }
        }
    });

    const topExp = data.filter(t => t.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 10);
    document.getElementById('top-expenses-list').innerHTML = topExp.map((t, i) => `
        <tr class="hover:bg-gray-50 transition border-b border-gray-100 last:border-0">
            <td class="px-4 py-2 text-xs text-gray-400 font-bold w-4">${i+1}.</td>
            <td class="px-2 py-2 font-medium text-gray-800">
                ${t.category}
                <div class="text-xs text-gray-500 font-normal sm:hidden">${t.comment || ''}</div>
            </td>
            <td class="px-2 py-2 text-xs text-gray-500 hidden sm:table-cell truncate max-w-[100px]">${t.comment || ''}</td>
            <td class="px-2 py-2 font-bold text-gray-900 text-right">${formatCurrency(t.amount)}</td>
        </tr>
    `).join('');

    const sortedFreqCat = Object.entries(catFrequency).sort((a, b) => b[1] - a[1]).slice(0, 5);
    document.getElementById('top-freq-cat-list').innerHTML = sortedFreqCat.map(([cat, count]) => `
        <tr class="hover:bg-gray-50 transition border-b border-gray-100 last:border-0">
            <td class="py-2 font-medium text-gray-800">${cat}</td>
            <td class="py-2 text-right font-semibold text-blue-600">${count}</td>
        </tr>
    `).join('');

    const sortedFreqComment = Object.entries(commentFrequency).sort((a, b) => b[1] - a[1]).slice(0, 5);
    document.getElementById('top-freq-comment-list').innerHTML = sortedFreqComment.length === 0 
        ? '<tr><td class="text-xs text-gray-400 py-2">Нет комментариев</td></tr>'
        : sortedFreqComment.map(([comm, count]) => `
            <tr class="hover:bg-gray-50 transition border-b border-gray-100 last:border-0">
                <td class="py-2 text-sm text-gray-700">"${comm}"</td>
                <td class="py-2 text-right font-semibold text-gray-500 text-xs">${count}</td>
            </tr>
        `).join('');
}

function renderDayChart() {
    const type = document.getElementById('chart-day-type').value;
    const ctx = document.getElementById('chartDays').getContext('2d');
    let labels, data;
    if (type === 'week') {
        const d = CHART_DATA_CACHE.dayOfWeekMap;
        data = [d[1], d[2], d[3], d[4], d[5], d[6], d[0]];
        labels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    } else {
        data = CHART_DATA_CACHE.dayOfMonthMap.slice(1);
        labels = Array.from({length: 31}, (_, i) => i + 1);
    }
    if (chartsInstance.days) chartsInstance.days.destroy();
    chartsInstance.days = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ label: 'Покупок', data: data, backgroundColor: '#60a5fa', borderRadius: 2 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } },
            plugins: { legend: { display: false } }
        }
    });
}

function renderTable(data) {
    const headerRow = document.getElementById('table-header');
    const body = document.getElementById('table-body');
    headerRow.innerHTML = '';
    body.innerHTML = '';

    const keys = [
        {k: 'date', label: 'Дата'}, 
        {k: 'category', label: 'Категория'}, 
        {k: 'comment', label: 'Комментарий'},
        {k: 'tag', label: 'Тег'},           
        {k: 'type', label: 'Тип'},          
        {k: 'account', label: 'Счет'},      
        {k: 'amount', label: 'Сумма'}
    ];

    keys.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col.label.toUpperCase();
        th.className = 'px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider';
        headerRow.appendChild(th);
    });
    headerRow.innerHTML += '<th class="px-6 py-3"></th>'; 

    const dataToShow = data.slice(0, 100); 

    dataToShow.forEach(item => {
        const tr = document.createElement('tr');
        const borderClass = item.type === 'income' ? 'border-l-green-500' : (item.type === 'expense' ? 'border-l-red-500' : 'border-l-gray-400');
        tr.className = `hover:bg-gray-50 transition border-b border-gray-100 border-l-4 ${borderClass}`;

        keys.forEach(col => {
            const td = document.createElement('td');
            td.className = 'px-6 py-4 text-sm text-gray-700';
            
            if (col.k === 'amount') {
                td.textContent = formatCurrency(item.amount);
                td.className += ' font-bold whitespace-nowrap';
            } else if (col.k === 'date') {
                td.textContent = new Date(item.date).toLocaleDateString('ru-RU');
                td.className += ' whitespace-nowrap';
            } else if (col.k === 'type') {
                const typeMap = {'income': 'Доход', 'expense': 'Расход', 'transfer': 'Перевод'};
                td.textContent = typeMap[item.type] || item.type;
            } else if (col.k === 'comment') {
                td.textContent = item.comment || '—';
                td.className += ' max-w-[200px] break-words leading-tight';
            } else if (col.k === 'account') {
                if (item.type === 'transfer') td.textContent = `${item.source_account} → ${item.target_account}`;
                else if (item.type === 'income') td.textContent = item.target_account || 'Основной';
                else td.textContent = item.source_account || 'Основной';
                td.className += ' text-xs text-gray-500 whitespace-nowrap';
            } else {
                td.textContent = item[col.k] || '—';
                td.className += ' whitespace-nowrap';
            }
            tr.appendChild(td);
        });

        const tdAct = document.createElement('td');
        tdAct.className = 'px-6 py-4 whitespace-nowrap text-right text-sm font-medium';
        tdAct.innerHTML = `<button onclick='openEditModal(${JSON.stringify(item)})' class="text-blue-600 hover:text-blue-900 font-bold">✎</button>`;
        tr.appendChild(tdAct);

        body.appendChild(tr);
    });
}

function drillDownByCategory(categoryName) {
    if (categoryName === 'Остальное') return alert('Используйте фильтр.');
    document.getElementById('filter-category').value = categoryName;
    document.getElementById('filter-type').value = 'expense';
    applyFilters();
    switchTab('transactions');
}

function drillDownByMonth(monthStr) {
    const [year, month] = monthStr.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    const fmt = d => {
        const offset = d.getTimezoneOffset() * 60000;
        return new Date(d.getTime() - offset).toISOString().split('T')[0];
    };
    document.getElementById('filter-date-start').value = fmt(start);
    document.getElementById('filter-date-end').value = fmt(end);
    document.getElementById('filter-type').value = 'ALL';
    applyFilters();
    switchTab('transactions');
}

function openEditModal(item) {
    document.getElementById('edit-id').value = item.id;
    document.getElementById('edit-amount').value = item.amount;
    document.getElementById('edit-comment').value = item.comment || '';
    document.getElementById('edit-tag').value = item.tag || ''; 
    
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

// ИСПРАВЛЕНИЕ БАГА ПЕРЕНАПРАВЛЕНИЯ (Заменили init() на loadData + applyFilters)
document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-id').value;
    const amount = parseFloat(document.getElementById('edit-amount').value);
    const category = document.getElementById('edit-category').value;
    const comment = document.getElementById('edit-comment').value;
    const tag = document.getElementById('edit-tag').value; 

    try {
        await fetch(API_URL_EDIT, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id, amount, category, comment, tag})
        });
        closeModal();
        await loadData(); // Просто обновляем данные
        applyFilters();   // Перерисовываем текущую вкладку
    } catch(e) { alert('Ошибка сети'); }
});

let calendarLoaded = false;
function loadCalendar() {
    if (calendarLoaded) return;
    const iframe = document.getElementById('google-calendar-frame');
    iframe.src = `https://calendar.google.com/calendar/embed?src=${CALENDAR_EMBED_ID}&ctz=Asia/Almaty&mode=WEEK`; 
    calendarLoaded = true;
}

async function loadStudents() {
    try {
        const res = await fetch(API_URL_STUDENTS);
        const students = await res.json();
        renderStudents(students);
    } catch(e) { console.error('Ошибка загрузки учеников', e); }
}

function renderStudents(students) {
    const grid = document.getElementById('students-grid');
    if (students.length === 0) {
        grid.innerHTML = '<div class="col-span-3 text-center text-gray-500 py-10">Список пуст</div>';
        return;
    }
    
    grid.innerHTML = students.map(s => `
        <div class="card p-5 hover:shadow-md transition cursor-pointer group border-l-4 ${s.subject === 'Математика' ? 'border-l-blue-500' : 'border-l-purple-500'}">
            <div onclick='openStudentModal(${JSON.stringify(s)})'>
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <h3 class="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition">${s.name}</h3>
                        <p class="text-xs text-gray-500">
                            ${s.school || 'Школа не указана'} • ${s.grade || '?'} кл.
                            ${s.lessons_per_week ? ` • <span class="font-bold text-blue-600">${s.lessons_per_week}/нед</span>` : ''}
                        </p>
                    </div>
                    <span class="text-xs font-bold px-2 py-1 rounded ${s.subject === 'Математика' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}">${s.subject}</span>
                </div>
                
                <div class="space-y-2 text-sm text-gray-600 mb-4">
                    <div class="flex items-center gap-2">
                        <span title="Телефон ученика">📱</span> <span>${s.phone || '—'}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span title="Родитель">👨‍👩‍👧</span> 
                        <span>${s.parents || '—'} <span class="text-gray-400 text-xs">${s.parent_phone ? '('+s.parent_phone+')' : ''}</span></span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span title="Место">📍</span> <span class="truncate">${s.address || '—'}</span>
                    </div>
                </div>
            </div>
            <button onclick="openStatsModal(${s.id})" class="w-full mt-2 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2">
                📊 Показать статистику
            </button>
        </div>
    `).join('');
}

function openStudentModal(s = null) {
    const modal = document.getElementById('student-modal');
    const form = document.getElementById('student-form');
    const delBtn = document.getElementById('btn-delete-student');
    form.reset();
    
    if (s) {
        document.getElementById('student-modal-title').textContent = 'Редактировать ученика';
        document.getElementById('student-id').value = s.id;
        document.getElementById('st-subject').value = s.subject || 'Математика';
        document.getElementById('st-name').value = s.name;
        document.getElementById('st-phone').value = s.phone || '';
        document.getElementById('st-parents').value = s.parents || '';
        document.getElementById('st-parent-phone').value = s.parent_phone || '';
        document.getElementById('st-school').value = s.school || '';
        document.getElementById('st-grade').value = s.grade || '';
        document.getElementById('st-teacher').value = s.teacher || '';
        document.getElementById('st-address').value = s.address || '';
        document.getElementById('st-notes').value = s.notes || '';
        document.getElementById('st-lessons-week').value = s.lessons_per_week || 0;
        delBtn.classList.remove('hidden');
    } else {
        document.getElementById('student-modal-title').textContent = 'Новый ученик';
        document.getElementById('student-id').value = '';
        document.getElementById('st-lessons-week').value = '';
        delBtn.classList.add('hidden');
    }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeStudentModal() {
    document.getElementById('student-modal').classList.add('hidden');
    document.getElementById('student-modal').classList.remove('flex');
}

// ИСПРАВЛЕНИЕ БАГА ПЕРЕНАПРАВЛЕНИЯ ДЛЯ УЧЕНИКОВ
document.getElementById('student-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('student-id').value;
    const action = id ? 'edit' : 'add';
    
    const payload = {
        action, id,
        name: document.getElementById('st-name').value,
        subject: document.getElementById('st-subject').value,
        parents: document.getElementById('st-parents').value,
        phone: document.getElementById('st-phone').value,
        parent_phone: document.getElementById('st-parent-phone').value, 
        school: document.getElementById('st-school').value,
        grade: document.getElementById('st-grade').value,
        teacher: document.getElementById('st-teacher').value,
        address: document.getElementById('st-address').value,
        notes: document.getElementById('st-notes').value,
        lessons_per_week: document.getElementById('st-lessons-week').value,
    };

    try {
        await fetch(API_URL_STUDENT_ACTION, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        closeStudentModal();
        loadStudents(); // Только обновляем список, вкладка не меняется
    } catch(e) { alert('Ошибка'); }
});

async function deleteStudent() {
    const id = document.getElementById('student-id').value;
    if (!confirm('Удалить ученика?')) return;
    try {
        await fetch(API_URL_STUDENT_ACTION, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'delete', id })
        });
        closeStudentModal();
        loadStudents();
    } catch(e) { alert('Ошибка'); }
}

// --- ПОКУПКИ ---
document.getElementById('shop-type').addEventListener('change', (e) => {
    const priceBlock = document.getElementById('shop-price-block');
    if (e.target.value === 'wish') priceBlock.classList.remove('hidden');
    else priceBlock.classList.add('hidden');
});

async function loadShoppingList() {
    try {
        const res = await fetch(API_URL_SHOPPING);
        if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
        const list = await res.json();
        if (!Array.isArray(list)) return;
        renderShoppingList(list);
    } catch(e) { console.error(e); }
}

function renderShoppingList(list) {
    const buyContainer = document.getElementById('list-buy');
    const wishContainer = document.getElementById('list-wish');
    buyContainer.innerHTML = '';
    wishContainer.innerHTML = '';

    const buyItems = list.filter(i => i.type === 'buy');
    const wishItems = list.filter(i => i.type !== 'buy');

    document.getElementById('count-buy').textContent = buyItems.length;
    document.getElementById('count-wish').textContent = wishItems.length;

    const createItemHTML = (item, isWish) => `
        <div class="card p-3 flex justify-between items-center group hover:bg-gray-50 transition cursor-move" data-id="${item.id}">
            <div class="flex items-center gap-3">
                <input type="checkbox" onchange="buyItem(${item.id})" class="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer">
                <div>
                    <p class="font-medium text-gray-800 ${isWish ? 'text-lg' : ''}">${item.item_name}</p>
                    ${isWish && item.price_estimate ? `<p class="text-xs text-green-600 font-bold">~${formatCurrency(item.price_estimate)}</p>` : ''}
                </div>
            </div>
            <button onclick="deleteItem(${item.id})" class="text-gray-300 hover:text-red-500 p-2 opacity-0 group-hover:opacity-100 transition">✕</button>
        </div>
    `;

    buyContainer.innerHTML = buyItems.length ? buyItems.map(i => createItemHTML(i, false)).join('') : '<div class="text-sm text-gray-400 text-center italic">Всё куплено</div>';
    wishContainer.innerHTML = wishItems.length ? wishItems.map(i => createItemHTML(i, true)).join('') : '<div class="text-sm text-gray-400 text-center italic">Вишлист пуст</div>';

    initSortable(buyContainer, 'buy');
    initSortable(wishContainer, 'wish');
}

function initSortable(el, type) {
    if (el.sortable) el.sortable.destroy(); 
    el.sortable = new Sortable(el, {
        animation: 150,
        ghostClass: 'bg-blue-100', 
        onEnd: async function (evt) {
            const itemEls = el.querySelectorAll('[data-id]');
            const ids = Array.from(itemEls).map(div => parseInt(div.getAttribute('data-id')));
            try {
                await fetch(API_URL_SHOPPING_ACTION, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ action: 'reorder', ids: ids })
                });
            } catch(e) { console.error('Ошибка сортировки', e); }
        }
    });
}

document.getElementById('shopping-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('shop-item').value;
    const type = document.getElementById('shop-type').value;
    const price = document.getElementById('shop-price').value;
    try {
        await fetch(API_URL_SHOPPING_ACTION, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'add', item_name: name, type: type, price_estimate: price || 0 })
        });
        document.getElementById('shop-item').value = '';
        document.getElementById('shop-price').value = '';
        loadShoppingList();
    } catch(e) { alert('Ошибка'); }
});

async function buyItem(id) {
    setTimeout(async () => {
        try {
            await fetch(API_URL_SHOPPING_ACTION, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ action: 'status', id: id, status: 'bought' })
            });
            loadShoppingList();
        } catch(e) { alert('Ошибка'); }
    }, 300);
}

async function deleteItem(id) {
    if(!confirm('Удалить без покупки?')) return;
    try {
        await fetch(API_URL_SHOPPING_ACTION, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ action: 'status', id: id, status: 'deleted' })
        });
        loadShoppingList();
    } catch(e) { alert('Ошибка'); }
}

// --- СТАТИСТИКА УЧЕНИКА ---
let studentChart = null;
async function openStatsModal(id) {
    const modal = document.getElementById('stats-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    try {
        const res = await fetch(`${API_BASE_URL}/students/stats?id=${id}`);
        const data = await res.json();
        document.getElementById('stats-title').textContent = data.name;
        let total = 0;
        data.transactions.forEach(t => total += t.amount);
        document.getElementById('stats-total').textContent = formatCurrency(total);
        document.getElementById('stats-count').textContent = data.transactions.length;
        const historyEl = document.getElementById('stats-history');
        historyEl.innerHTML = data.transactions.slice(0, 10).map(t => `
            <div class="flex justify-between border-b border-gray-100 pb-1 last:border-0">
                <span>${new Date(t.date).toLocaleDateString('ru-RU')} <span class="text-xs text-gray-400">(${t.comment})</span></span>
                <span class="font-bold text-green-600">+${formatCurrency(t.amount)}</span>
            </div>
        `).join('') || '<div class="text-gray-400">Оплат пока нет</div>';
        const months = {};
        data.transactions.forEach(t => {
            const date = new Date(t.date);
            const key = `${date.toLocaleString('ru', { month: 'short' })} ${date.getFullYear()}`; 
            months[key] = (months[key] || 0) + t.amount;
        });
        const ctx = document.getElementById('studentChart').getContext('2d');
        if (studentChart) studentChart.destroy();
        studentChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Object.keys(months),
                datasets: [{ label: 'Оплаты', data: Object.values(months), backgroundColor: '#3b82f6', borderRadius: 4 }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
        });
    } catch (e) { console.error(e); alert('Ошибка загрузки статистики'); }
}
function closeStatsModal() {
    document.getElementById('stats-modal').classList.add('hidden');
    document.getElementById('stats-modal').classList.remove('flex');
}

window.onclick = function(event) {
    const modals = [document.getElementById('edit-modal'), document.getElementById('student-modal'), document.getElementById('stats-modal')];
    modals.forEach(modal => { if (event.target === modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); } });
}

init();
