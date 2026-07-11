// =====================================================
//  app.js  — Firebase Firestore 版
// =====================================================
const app = (() => {

    // ---- Firestore コレクション名 ----
    const COL_SHIFTS     = 'shifts';
    const COL_CLOSED     = 'closedDays';
    const COL_SETTINGS   = 'settings';

    // ---- localStorage キー（セッション管理のみ） ----
    const AUTH_KEY       = 'shift_admin_authed';
    const STAFF_NAME_KEY = 'shift_last_name';
    const STAFF_COUNT_KEY= 'shift_staff_count';
    const DEFAULT_PIN    = '1234';

    // ---- Firestore ドキュメント ID ----
    // "2026-07_first_山田太郎" のような形式でユニークを保証
    const shiftDocId = (yearMonth, half, name) =>
        `${yearMonth}_${half}_${name.trim()}`;
    const assignmentDocId = (yearMonth, half) =>
        `assigned_${yearMonth}_${half}`;

    // ---- Firestore: シフト保存（上書き） ----
    const saveShift = async (submission) => {
        const docId = shiftDocId(
            submission.targetMonth, submission.targetHalf, submission.name
        );
        await db.collection(COL_SHIFTS).doc(docId).set({
            ...submission,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    };

    // ---- Firestore: 月＋期間のシフト全件取得（1回読み） ----
    const getShifts = async (yearMonth, half) => {
        const snap = await db.collection(COL_SHIFTS)
            .where('targetMonth', '==', yearMonth)
            .where('targetHalf',  '==', half)
            .get();
        return snap.docs.map(d => d.data());
    };

    // ---- Firestore: 特定スタッフのシフト1件取得 ----
    const getMyShift = async (yearMonth, half, name) => {
        const docId = shiftDocId(yearMonth, half, name);
        const snap  = await db.collection(COL_SHIFTS).doc(docId).get();
        return snap.exists ? snap.data() : null;
    };

    // ---- Firestore: 休業日取得 ----
    const getClosedDays = async (yearMonth) => {
        const snap = await db.collection(COL_CLOSED).doc(yearMonth).get();
        return snap.exists ? (snap.data().days || []) : [];
    };

    // ---- Firestore: 休業日トグル ----
    const toggleClosedDay = async (yearMonth, day) => {
        const ref  = db.collection(COL_CLOSED).doc(yearMonth);
        const snap = await ref.get();
        let days = snap.exists ? (snap.data().days || []) : [];
        const idx = days.indexOf(day);
        if (idx >= 0) days.splice(idx, 1);
        else          { days.push(day); days.sort((a, b) => a - b); }
        await ref.set({ days });
    };

    // ---- Firestore: 店長確定シフト保存 ----
    const saveAssignments = async (yearMonth, half, day, assignments) => {
        const cleaned = assignments
            .filter(a => a && a.name && a.startTime)
            .map(a => ({ name: String(a.name).trim(), startTime: String(a.startTime).trim() }));
        const docRef = db.collection(COL_SETTINGS).doc(assignmentDocId(yearMonth, half));
        try {
            await docRef.update({
                [`days.${day}`]: cleaned,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
            if (e.code === 'not-found') {
                await docRef.set({
                    targetMonth: yearMonth,
                    targetHalf: half,
                    days: { [day]: cleaned },
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                throw e;
            }
        }
    };

    const getAssignments = async (yearMonth, half) => {
        const snap = await db.collection(COL_SETTINGS)
            .doc(assignmentDocId(yearMonth, half))
            .get();
        return snap.exists ? (snap.data().days || {}) : {};
    };

    // ---- PIN 管理（Firestore） ----
    const getPinFromFirestore = async () => {
        const snap = await db.collection(COL_SETTINGS).doc('adminPin').get();
        return snap.exists ? (snap.data().pin || DEFAULT_PIN) : DEFAULT_PIN;
    };
    const savePinToFirestore = async (pin) => {
        await db.collection(COL_SETTINGS).doc('adminPin').set({ pin });
    };
    const isAuthed  = ()    => sessionStorage.getItem(AUTH_KEY) === '1';
    const setAuthed = ()    => sessionStorage.setItem(AUTH_KEY, '1');
    const clearAuth = ()    => sessionStorage.removeItem(AUTH_KEY);

    // ---- スタッフ人数設定（localStorage） ----
    const getStaffCount = ()    => parseInt(localStorage.getItem(STAFF_COUNT_KEY) || '0', 10);
    const setStaffCount = (n)   => localStorage.setItem(STAFF_COUNT_KEY, String(n));

    // ---- 祝日キャッシュ ----
    let holidays = {};
    const fetchHolidays = async () => {
        try {
            const res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
            if (res.ok) holidays = await res.json();
        } catch (_) { /* オフライン時は無視 */ }
    };
    const isHoliday = (year, month, date) =>
        !!holidays[`${year}-${String(month).padStart(2,'0')}-${String(date).padStart(2,'0')}`];

    // ---- 日付リスト生成 ----
    const getDaysInPeriod = (yearMonthStr, half, closedDaysArr = []) => {
        if (!yearMonthStr) return [];
        const [year, month] = yearMonthStr.split('-');
        const daysInMonth   = new Date(year, month, 0).getDate();
        const dayNames      = ['日','月','火','水','木','金','土'];
        let startDay = 1, endDay = daysInMonth;
        if (half === 'first')  endDay   = 15;
        if (half === 'second') startDay = 16;

        const days = [];
        for (let i = startDay; i <= endDay; i++) {
            const dow     = new Date(year, month - 1, i).getDay();
            const holiday = isHoliday(year, month, i);
            days.push({
                label:              `${parseInt(month)}/${i}`,
                day:                i,
                dayName:            dayNames[dow],
                dayOfWeek:          dow,
                isHoliday:          holiday,
                isWeekendOrHoliday: dow === 0 || dow === 6 || holiday,
                isWednesday:        dow === 3,
                isClosedDay:        closedDaysArr.includes(i),
                get isUnavailable() { return this.isWednesday || this.isClosedDay; }
            });
        }
        return days;
    };

    // =====================================================
    //  スタッフ画面
    // =====================================================
    const initStaffView = async () => {
        await fetchHolidays();
        const form = document.getElementById('shift-form');
        if (!form) return;

        const monthInput    = document.getElementById('target-month');
        const halfInput     = document.getElementById('target-half');
        const nameInput     = document.getElementById('staff-name');
        const dateGrid      = document.getElementById('date-grid');
        const specificCont  = document.getElementById('specific-days-container');
        const allDaysOpts   = document.getElementById('all-days-options');
        const weekendSel    = document.getElementById('all-days-weekend-time');
        const notesInput    = document.getElementById('notes');
        const submitBtn     = document.getElementById('submit-btn');
        const loadStatus    = document.getElementById('load-status');

        // 前回入力した名前を復元
        const savedName = localStorage.getItem(STAFF_NAME_KEY);
        if (savedName) nameInput.value = savedName;

        // 来月をデフォルト
        const today = new Date();
        let nm = today.getMonth() + 2, ny = today.getFullYear();
        if (nm > 12) { nm = 1; ny++; }
        monthInput.value = `${ny}-${String(nm).padStart(2,'0')}`;

        let selectedDates = new Map();
        let currentClosedDays = [];

        // ---- 既存シフト読み込み ----
        const loadExisting = async () => {
            const name       = nameInput.value.trim();
            const yearMonth  = monthInput.value;
            const half       = halfInput.value;
            if (!name || !yearMonth) return;

            loadStatus.textContent = '読み込み中…';
            try {
                const existing = await getMyShift(yearMonth, half, name);
                if (existing) {
                    loadStatus.textContent = '✓ 前回の提出内容を読み込みました（編集して再提出できます）';
                    loadStatus.className = 'load-status loaded';
                    // シフトタイプを復元
                    const typeRadio = document.querySelector(
                        `input[name="shift-type"][value="${existing.shiftType}"]`
                    );
                    if (typeRadio) {
                        typeRadio.checked = true;
                        typeRadio.dispatchEvent(new Event('change'));
                    }
                    if (existing.shiftType === 'all') {
                        if (weekendSel) weekendSel.value = existing.allDaysWeekendTime || '17:30';
                    }
                    if (existing.notes) notesInput.value = existing.notes;
                    // 日付を復元（renderDates の後に適用）
                    restoreSelectedDates(existing.dates || []);
                } else {
                    loadStatus.textContent = '';
                    loadStatus.className = 'load-status';
                }
            } catch (e) {
                loadStatus.textContent = '読み込みに失敗しました（オフライン？）';
                loadStatus.className = 'load-status error';
            }
        };

        const restoreSelectedDates = (dates) => {
            if (!dates || !dates.length) return;
            document.querySelectorAll('.date-btn:not(.day-teikyu):not(.day-closed)').forEach(btn => {
                const label = btn.dataset.label;
                const match = dates.find(d => d.dateLabel === label);
                if (!match) return;
                const timeBadge = btn.querySelector('.time-badge');
                selectedDates.set(label, match.time);
                btn.classList.add('selected');
                if (timeBadge) {
                    timeBadge.textContent = match.time;
                    timeBadge.classList.remove('hidden');
                    if (match.time === '16:30') timeBadge.classList.add('early');
                }
            });
        };

        // ---- 日付グリッド描画 ----
        const renderDates = async () => {
            dateGrid.innerHTML = '';
            selectedDates.clear();

            currentClosedDays = await getClosedDays(monthInput.value).catch(() => []);
            const days = getDaysInPeriod(monthInput.value, halfInput.value, currentClosedDays);

            days.forEach(day => {
                const btn = document.createElement('div');
                btn.className = 'date-btn';
                btn.dataset.label = day.label;

                if (day.isWednesday) {
                    btn.classList.add('day-teikyu');
                    btn.innerHTML = `<span class="day-label">${day.label}<small>(${day.dayName})</small></span><span class="day-tag">定休日</span>`;
                } else if (day.isClosedDay) {
                    btn.classList.add('day-closed');
                    btn.innerHTML = `<span class="day-label">${day.label}<small>(${day.dayName})</small></span><span class="day-tag">休業日</span>`;
                } else {
                    if (day.isHoliday || day.dayOfWeek === 0) btn.classList.add('color-sun');
                    else if (day.dayOfWeek === 6)             btn.classList.add('color-sat');

                    const timeBadge = document.createElement('span');
                    timeBadge.className = 'time-badge hidden';

                    const fixedLabel = !day.isWeekendOrHoliday
                        ? '<span class="fixed-time">17:30固定</span>' : '';
                    btn.innerHTML = `<span class="day-label">${day.label}<small>(${day.dayName})</small></span>${fixedLabel}`;
                    btn.appendChild(timeBadge);

                    btn.addEventListener('click', () => {
                        let cur = selectedDates.get(day.label);
                        if (day.isWeekendOrHoliday) {
                            if (!cur) {
                                selectedDates.set(day.label, '17:30');
                                btn.classList.add('selected');
                                timeBadge.textContent = '17:30';
                                timeBadge.classList.remove('hidden','early');
                            } else if (cur === '17:30') {
                                selectedDates.set(day.label, '16:30');
                                timeBadge.textContent = '16:30';
                                timeBadge.classList.add('early');
                            } else {
                                selectedDates.delete(day.label);
                                btn.classList.remove('selected');
                                timeBadge.classList.add('hidden');
                                timeBadge.classList.remove('early');
                            }
                        } else {
                            if (!cur) {
                                selectedDates.set(day.label, '17:30');
                                btn.classList.add('selected');
                                timeBadge.textContent = '17:30';
                                timeBadge.classList.remove('hidden');
                            } else {
                                selectedDates.delete(day.label);
                                btn.classList.remove('selected');
                                timeBadge.classList.add('hidden');
                            }
                        }
                    });
                }
                dateGrid.appendChild(btn);
            });
        };

        // ---- ラジオ切替 ----
        document.querySelectorAll('input[name="shift-type"]').forEach(r =>
            r.addEventListener('change', e => {
                if (e.target.value === 'specific') {
                    specificCont.classList.remove('hidden');
                    allDaysOpts.classList.add('hidden');
                } else {
                    specificCont.classList.add('hidden');
                    allDaysOpts.classList.remove('hidden');
                }
            })
        );

        // ---- 月・期間・名前 変更時に再描画＋既存データ読み込み ----
        const onContextChange = async () => {
            await renderDates();
            await loadExisting();
        };

        monthInput.addEventListener('change', onContextChange);
        halfInput.addEventListener('change',  onContextChange);

        // 名前の入力確定時（blur）に既存データ読み込み
        nameInput.addEventListener('blur', async () => {
            if (nameInput.value.trim()) await loadExisting();
        });

        await renderDates();

        // ---- フォーム送信 ----
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name      = nameInput.value.trim();
            const shiftType = document.querySelector('input[name="shift-type"]:checked').value;
            const notes     = notesInput.value.trim();
            const yearMonth = monthInput.value;
            const half      = halfInput.value;

            if (!name)      { alert('お名前を入力してください。'); return; }
            if (!yearMonth) { alert('対象月を選択してください。'); return; }

            const submission = { name, targetMonth: yearMonth, targetHalf: half, shiftType, notes };

            if (shiftType === 'specific') {
                if (selectedDates.size === 0 && !notes) {
                    alert('出勤可能日を選択するか、備考を入力してください。');
                    return;
                }
                submission.dates = Array.from(selectedDates.entries())
                    .map(([dateLabel, time]) => ({ dateLabel, time }))
                    .sort((a, b) => parseInt(a.dateLabel.split('/')[1]) - parseInt(b.dateLabel.split('/')[1]));
            } else {
                submission.allDaysWeekendTime = weekendSel ? weekendSel.value : '17:30';
            }

            submitBtn.disabled   = true;
            submitBtn.textContent = '送信中…';

            try {
                await saveShift(submission);
                localStorage.setItem(STAFF_NAME_KEY, name);
                form.classList.add('hidden');
                document.getElementById('success-message').classList.remove('hidden');
            } catch (err) {
                console.error(err);
                alert('送信に失敗しました。インターネット接続を確認してください。\n' + err.message);
                submitBtn.disabled    = false;
                submitBtn.textContent = 'シフトを提出する';
            }
        });
    };

    // =====================================================
    //  PIN 認証
    // =====================================================
    const initAdminAuth = async () => {
        const overlay = document.getElementById('pin-overlay');
        const content = document.getElementById('admin-content');

        const showDashboard = async () => {
            overlay.style.display = 'none';
            content.classList.remove('hidden');
            await initAdminView();
        };

        if (isAuthed()) { await showDashboard(); return; }

        let entered = '';
        const dots    = document.querySelectorAll('#pin-dots span');
        const errorEl = document.getElementById('pin-error');

        const updateDots = () =>
            dots.forEach((d, i) => d.classList.toggle('filled', i < entered.length));

        const shake = () => {
            const card = document.querySelector('.pin-card');
            card.classList.add('shake');
            setTimeout(() => card.classList.remove('shake'), 400);
        };

        document.querySelectorAll('.key-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const val = btn.dataset.val;
                if      (val === 'clear') { entered = ''; errorEl.textContent = ''; }
                else if (val === 'del')   { entered = entered.slice(0, -1); }
                else if (entered.length < 4) entered += val;

                updateDots();

                if (entered.length === 4) {
                    // Firestore からPINを取得して照合
                    const correctPin = await getPinFromFirestore();
                    if (entered === correctPin) {
                        setAuthed();
                        showDashboard();
                    } else {
                        errorEl.textContent = 'PINが違います';
                        shake();
                        setTimeout(() => { entered = ''; updateDots(); }, 600);
                    }
                }
            });
        });

        document.addEventListener('keydown', e => {
            if (overlay.style.display === 'none') return;
            if (/^[0-9]$/.test(e.key)) document.querySelector(`[data-val="${e.key}"]`)?.click();
            else if (e.key === 'Backspace') document.querySelector('[data-val="del"]')?.click();
            else if (e.key === 'Escape')    document.querySelector('[data-val="clear"]')?.click();
        });
    };

    // =====================================================
    //  店長ダッシュボード
    // =====================================================
    const initAdminView = async () => {
        await fetchHolidays();
        const calendarHeader   = document.getElementById('calendar-header');
        const calendarGrid     = document.getElementById('calendar-grid');
        const noData           = document.getElementById('no-data');
        const filterMonth      = document.getElementById('filter-month');
        const filterHalf       = document.getElementById('filter-half');
        const staffCountInput  = document.getElementById('staff-count-input');
        if (!calendarGrid) return;

        // 来月をデフォルト
        const today = new Date();
        let nm = today.getMonth() + 2, ny = today.getFullYear();
        if (nm > 12) { nm = 1; ny++; }
        filterMonth.value = `${ny}-${String(nm).padStart(2,'0')}`;

        // スタッフ総数を復元
        if (staffCountInput) {
            staffCountInput.value = getStaffCount() || '';
            staffCountInput.addEventListener('change', () => {
                setStaffCount(parseInt(staffCountInput.value, 10) || 0);
                renderCalendar(currentShifts, currentClosedDays);
            });
        }

        const dayNames = ['日','月','火','水','木','金','土'];
        let unsubscribeShifts = null;
        let unsubscribeClosed = null;
        let currentShifts     = [];
        let currentClosedDays = [];

        // ---- リアルタイムリスナー開始 ----
        const startListeners = (yearMonth, half) => {
            // 前回のリスナーを解除
            if (unsubscribeShifts) unsubscribeShifts();
            if (unsubscribeClosed) unsubscribeClosed();

            // シフトのリアルタイム購読
            unsubscribeShifts = db.collection(COL_SHIFTS)
                .where('targetMonth', '==', yearMonth)
                .where('targetHalf',  '==', half)
                .onSnapshot(snap => {
                    currentShifts = snap.docs.map(d => d.data());
                    renderCalendar(currentShifts, currentClosedDays);
                }, err => {
                    console.error('シフト購読エラー:', err);
                    noData.textContent = 'データ取得エラー: ' + err.message;
                    noData.classList.remove('hidden');
                });

            // 休業日のリアルタイム購読
            unsubscribeClosed = db.collection(COL_CLOSED).doc(yearMonth)
                .onSnapshot(snap => {
                    currentClosedDays = snap.exists ? (snap.data().days || []) : [];
                    renderCalendar(currentShifts, currentClosedDays);
                });
        };

        // ---- モーダル：スタッフ詳細表示 ----
        const showDetailModal = (sub) => {
            const modal    = document.getElementById('detail-modal');
            const title    = document.getElementById('modal-title');
            const body     = document.getElementById('modal-body');
            const [y, m]   = (sub.targetMonth || '').split('-');
            const halfLabel = sub.targetHalf === 'first' ? '前半（1〜15日）' : '後半（16日〜月末）';

            title.textContent = `${sub.name} — ${parseInt(m)}月 ${halfLabel}`;

            let html = '';

            // シフトタイプ
            if (sub.shiftType === 'all') {
                html += `<div class="modal-row"><span class="modal-label">提出内容</span><span class="modal-value">全日出勤可能</span></div>`;
                html += `<div class="modal-row"><span class="modal-label">土日祝の時間</span><span class="modal-value">${sub.allDaysWeekendTime || '17:30'} から</span></div>`;
            } else {
                const dates = (sub.dates || []);
                if (dates.length > 0) {
                    const dateStr = dates.map(d => `${d.dateLabel}(${d.time})`).join('　');
                    html += `<div class="modal-row"><span class="modal-label">出勤可能日</span><span class="modal-value modal-dates">${dateStr}</span></div>`;
                } else {
                    html += `<div class="modal-row"><span class="modal-label">出勤可能日</span><span class="modal-value" style="color:var(--danger);">なし（休み希望）</span></div>`;
                }
            }

            // 備考
            html += `<div class="modal-row modal-notes-row">
                <span class="modal-label">備考</span>
                <span class="modal-value modal-notes">${sub.notes ? sub.notes.replace(/\n/g, '<br>') : '<span style="color:#bbb;">なし</span>'}</span>
            </div>`;

            // 提出日時
            if (sub.updatedAt) {
                const d = sub.updatedAt.toDate ? sub.updatedAt.toDate() : new Date(sub.updatedAt);
                html += `<div class="modal-row"><span class="modal-label">提出日時</span><span class="modal-value modal-timestamp">${d.toLocaleString('ja-JP')}</span></div>`;
            }

            body.innerHTML = html;
            modal.classList.remove('hidden');
        };

        // モーダルを閉じる
        document.getElementById('modal-close')?.addEventListener('click', () => {
            document.getElementById('detail-modal').classList.add('hidden');
        });
        document.getElementById('detail-modal')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget)
                e.currentTarget.classList.add('hidden');
        });

        // ---- 提出一覧描画（備考確認用） ----
        const renderSubmissionsList = (submissions) => {
            const section = document.getElementById('submissions-list-section');
            const list    = document.getElementById('submissions-list');
            if (!section || !list) return;

            if (submissions.length === 0) {
                section.style.display = 'none';
                return;
            }
            section.style.display = 'block';
            list.innerHTML = '';

            const sorted = [...submissions].sort((a, b) =>
                (a.name || '').localeCompare(b.name || '', 'ja')
            );

            sorted.forEach(sub => {
                const row = document.createElement('div');
                row.className = 'submission-row';

                const typeLabel = sub.shiftType === 'all'
                    ? `全日（土日祝: ${sub.allDaysWeekendTime || '17:30'}〜）`
                    : `個別 ${(sub.dates || []).length}日`;

                const hasNotes = sub.notes && sub.notes.trim();

                row.innerHTML = `
                    <div class="submission-name">${sub.name}</div>
                    <div class="submission-meta">
                        <span class="sub-type-badge">${typeLabel}</span>
                        ${hasNotes ? '<span class="sub-notes-badge">備考あり</span>' : ''}
                    </div>
                `;
                row.addEventListener('click', () => showDetailModal(sub));
                list.appendChild(row);
            });
        };

        // ---- カレンダー描画 ----
        const renderCalendar = (submissions, closedDays) => {
            calendarHeader.innerHTML = '';
            calendarGrid.innerHTML   = '';

            // 提出一覧も同時更新
            renderSubmissionsList(submissions);

            dayNames.forEach(d => {
                const div = document.createElement('div');
                div.textContent = d;
                calendarHeader.appendChild(div);
            });

            const yearMonth = filterMonth.value;
            const half      = filterHalf.value;

            if (!yearMonth || half === 'all') {
                noData.textContent = '月と期間（前半または後半）を選択してください。';
                noData.classList.remove('hidden');
                calendarHeader.style.display = 'none';
                calendarGrid.style.display   = 'none';
                return;
            }
            calendarHeader.style.display = '';
            noData.classList.add('hidden');
            calendarGrid.style.display   = 'grid';

            // 集計
            const staffCount  = getStaffCount();
            const canWorkList = submissions.filter(s =>
                s.shiftType === 'all' || (s.dates && s.dates.length > 0)
            );
            const wantRestList = submissions.filter(s =>
                s.shiftType === 'specific' && (!s.dates || s.dates.length === 0)
            );

            document.getElementById('stat-submitted').textContent  = submissions.length;
            document.getElementById('stat-not-yet').textContent    = staffCount
                ? Math.max(0, staffCount - submissions.length) : '—';
            document.getElementById('stat-can-work').textContent   = canWorkList.length;
            document.getElementById('stat-want-rest').textContent  = wantRestList.length;
            document.getElementById('stat-closed').textContent     = closedDays.length;

            const warning = document.getElementById('closed-days-warning');
            if (warning) warning.style.display = closedDays.length === 0 ? 'block' : 'none';

            // カレンダーグリッド生成
            const [yearStr, monthStr] = yearMonth.split('-');
            const year = parseInt(yearStr), month = parseInt(monthStr);
            const daysInMonth      = new Date(year, month, 0).getDate();
            const firstDayOfMonth  = new Date(year, month - 1, 1).getDay();
            const startDay = half === 'first' ? 1 : 16;
            const endDay   = half === 'first' ? 15 : daysInMonth;
            const isMobile = window.innerWidth <= 640;

            // 月頭の空白セル
            for (let i = 0; i < firstDayOfMonth; i++) {
                const cell = document.createElement('div');
                cell.className = 'calendar-cell out-of-range';
                calendarGrid.appendChild(cell);
            }

            for (let i = 1; i <= daysInMonth; i++) {
                const cell = document.createElement('div');
                cell.className = 'calendar-cell';

                const isOutOfRange = i < startDay || i > endDay;
                const dow     = (firstDayOfMonth + i - 1) % 7;
                const isHoli  = isHoliday(year, month, i);
                const isWed   = dow === 3;
                const isClosed= closedDays.includes(i);

                if (isOutOfRange) cell.classList.add('out-of-range');

                const dateHeader = document.createElement('div');
                dateHeader.className = 'cell-date';
                if      (dow === 0 || isHoli) dateHeader.classList.add('sun');
                else if (dow === 6)           dateHeader.classList.add('sat');
                else if (isWed)               dateHeader.classList.add('wed');

                dateHeader.textContent = isMobile
                    ? `${month}/${i}(${dayNames[dow]})` : `${month}/${i}`;
                cell.appendChild(dateHeader);

                if (!isOutOfRange) {
                    if (isWed) {
                        cell.classList.add('cell-teikyu');
                        const tag = document.createElement('div');
                        tag.className = 'day-tag-cell teikyu';
                        tag.textContent = '定休日';
                        cell.appendChild(tag);

                    } else if (isClosed) {
                        cell.classList.add('cell-kyugyo');
                        const tag = document.createElement('div');
                        tag.className = 'day-tag-cell kyugyo';
                        tag.textContent = '休業日 ✕';
                        cell.appendChild(tag);
                        cell.style.cursor = 'pointer';
                        cell.addEventListener('click', async () => {
                            if (confirm(`${month}/${i} の休業日を解除しますか？`)) {
                                await toggleClosedDay(yearMonth, i);
                            }
                        });

                    } else {
                        const shiftsContainer = document.createElement('div');
                        shiftsContainer.className = 'cell-shifts';

                        submissions.forEach(sub => {
                            let willWork = false, workTime = '17:30';
                            const isWeekendOrHoli = dow === 0 || dow === 6 || isHoli;
                            if (sub.shiftType === 'all') {
                                willWork = true;
                                if (isWeekendOrHoli) workTime = sub.allDaysWeekendTime || '17:30';
                            } else if (sub.dates) {
                                const match = sub.dates.find(d => d.dateLabel === `${month}/${i}`);
                                if (match) { willWork = true; workTime = match.time; }
                            }
                            if (willWork) {
                                const badge = document.createElement('div');
                                badge.className = 'shift-badge' + (workTime === '16:30' ? ' time-1630' : '');
                                badge.textContent = `${sub.name} (${workTime})`;
                                // バッジタップで詳細モーダル（セルの休業日設定と区別）
                                badge.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    showDetailModal(sub);
                                });
                                shiftsContainer.appendChild(badge);
                            }
                        });

                        cell.appendChild(shiftsContainer);
                        cell.style.cursor = 'pointer';
                        cell.title = 'タップして休業日に設定';
                        cell.addEventListener('click', async () => {
                            if (confirm(`${month}/${i} を休業日に設定しますか？`)) {
                                await toggleClosedDay(yearMonth, i);
                            }
                        });
                    }
                }
                calendarGrid.appendChild(cell);
            }
        };

        // ---- フィルター変更 ----
        const onFilterChange = () => {
            const yearMonth = filterMonth.value;
            const half      = filterHalf.value;
            if (yearMonth && half !== 'all') {
                startListeners(yearMonth, half);
            } else {
                if (unsubscribeShifts) unsubscribeShifts();
                if (unsubscribeClosed) unsubscribeClosed();
                currentShifts     = [];
                currentClosedDays = [];
                renderCalendar([], []);
            }
        };

        filterMonth.addEventListener('change', onFilterChange);
        filterHalf.addEventListener('change',  onFilterChange);
        window.addEventListener('resize', () => renderCalendar(currentShifts, currentClosedDays));

        // 初期読み込み（来月・期間未選択状態）
        renderCalendar([], []);

        // ---- PIN変更（Firestore保存） ----
        document.getElementById('change-pin-btn')?.addEventListener('click', async () => {
            const newPin = prompt('新しい4桁のPINを入力してください:');
            if (!newPin) return;
            if (!/^\d{4}$/.test(newPin)) { alert('4桁の数字で入力してください。'); return; }
            await savePinToFirestore(newPin);
            alert('PINを変更しました。全端末に反映されました。');
        });

        // ---- ログアウト ----
        document.getElementById('logout-btn')?.addEventListener('click', () => {
            if (unsubscribeShifts) unsubscribeShifts();
            if (unsubscribeClosed) unsubscribeClosed();
            clearAuth();
            location.reload();
        });

        // ---- スタッフ総数設定 ----
        document.getElementById('set-staff-count-btn')?.addEventListener('click', () => {
            const n = parseInt(prompt('スタッフ総数を入力してください（未提出人数の計算に使います）:') || '0', 10);
            if (isNaN(n) || n < 0) return;
            setStaffCount(n);
            if (staffCountInput) staffCountInput.value = n || '';
            renderCalendar(currentShifts, currentClosedDays);
        });

        // ---- 画像エクスポート ----
        const normalizeAssignments = (items) =>
            [...(items || [])]
                .filter(a => a && a.name)
                .sort((a, b) => {
                    const at = a.startTime || '', bt = b.startTime || '';
                    return at !== bt ? at.localeCompare(bt) : (a.name || '').localeCompare(b.name || '', 'ja');
                });

        const drawRoundRect = (ctx, x, y, w, h, r) => {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
        };

        const exportShiftImage = async (half) => {
            const yearMonth = filterMonth.value;
            if (!yearMonth) { alert('対象月を選択してください。'); return; }

            const [yearStr, monthStr] = yearMonth.split('-');
            const year = parseInt(yearStr, 10);
            const month = parseInt(monthStr, 10);
            const closedDays = await getClosedDays(yearMonth).catch(() => []);
            const assignments = await getAssignments(yearMonth, half).catch(err => {
                alert('確定シフトの取得に失敗しました: ' + err.message);
                return {};
            });

            const days = getDaysInPeriod(yearMonth, half, closedDays).filter(d => !d.isUnavailable);
            const halfLabel = half === 'first' ? '前半' : '後半';
            const scale = 2;
            const width = 1080;
            const rowHeight = 96;
            const headerHeight = 190;  // タイトル・サブタイトル・テーブルヘッダーが重ならない高さ
            const footerHeight = 46;
            const height = headerHeight + days.length * rowHeight + footerHeight;

            const canvas = document.createElement('canvas');
            canvas.width = width * scale;
            canvas.height = height * scale;
            const ctx = canvas.getContext('2d');
            ctx.scale(scale, scale);

            ctx.fillStyle = '#f6f8fb';
            ctx.fillRect(0, 0, width, height);

            // タイトル
            ctx.fillStyle = '#1f2937';
            ctx.font = '700 44px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
            ctx.fillText(`${year}年${month}月 シフト表（${halfLabel}）`, 48, 72);

            // サブタイトル（テーブルヘッダーと重ならない位置）
            ctx.font = '500 22px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.fillText('確定済みの開始時間のみ表示', 50, 112);

            const x = 40;
            const tableW = width - 80;
            const dateW = 190;
            const staffW = tableW - dateW;
            const tableHeaderY = headerHeight;  // 190

            // テーブルヘッダー背景（サブタイトルより十分下に配置）
            ctx.fillStyle = '#e8f5e9';
            drawRoundRect(ctx, x, tableHeaderY - 44, tableW, 44, 12);
            ctx.fill();
            ctx.fillStyle = '#1b5e20';
            ctx.font = '700 22px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
            ctx.fillText('日付', x + 26, tableHeaderY - 14);
            ctx.fillText('確定シフト', x + dateW + 26, tableHeaderY - 14);

            // 各行
            days.forEach((day, index) => {
                const rowY = tableHeaderY + index * rowHeight;
                const isSun = day.dayOfWeek === 0 || day.isHoliday;
                const isSat = day.dayOfWeek === 6;
                const entries = normalizeAssignments(assignments[day.day]);
                const bg = index % 2 === 0 ? '#ffffff' : '#fbfdff';

                ctx.fillStyle = bg;
                drawRoundRect(ctx, x, rowY, tableW, rowHeight - 10, 10);
                ctx.fill();

                ctx.fillStyle = isSun ? '#c62828' : isSat ? '#1565c0' : '#111827';
                ctx.font = '700 28px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
                ctx.fillText(`${month}/${day.day}`, x + 26, rowY + 38);
                ctx.font = '500 19px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
                ctx.fillText(`(${day.dayName})`, x + 106, rowY + 38);

                ctx.fillStyle = '#d8dee9';
                ctx.fillRect(x + dateW, rowY + 15, 1, rowHeight - 40);

                if (entries.length === 0) {
                    ctx.fillStyle = '#94a3b8';
                    ctx.font = '500 24px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
                    ctx.fillText('未確定', x + dateW + 26, rowY + 43);
                } else {
                    ctx.fillStyle = '#111827';
                    ctx.font = '700 25px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
                    const text = entries.map(e => `${e.startTime} ${e.name}`).join('   /   ');
                    ctx.fillText(text, x + dateW + 26, rowY + 43, staffW - 52);
                }
            });

            ctx.fillStyle = '#94a3b8';
            ctx.font = '500 18px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
            ctx.fillText('Hoobi Shift', 48, height - 18);

            const link = document.createElement('a');
            link.download = `shift_${yearMonth}_${halfLabel}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        };

        document.getElementById('export-first-btn')?.addEventListener('click', () => exportShiftImage('first'));
        document.getElementById('export-second-btn')?.addEventListener('click', () => exportShiftImage('second'));
    };

    return { initStaffView, initAdminAuth };
})();
