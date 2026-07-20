import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../../components/Header/Header";
import Footer from "../../components/Footer/Footer";
import { useAuth } from "../../context/AuthContext";
import styles from "./Calendar.module.scss";

const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const pad = (value) => String(value).padStart(2, "0");

const toDateKey = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const fromDateKey = (value) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

const isSameDay = (first, second) =>
  first.getFullYear() === second.getFullYear() &&
  first.getMonth() === second.getMonth() &&
  first.getDate() === second.getDate();

const formatSelectedDate = (date) => {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (isSameDay(date, today)) return "Сегодня";
  if (isSameDay(date, tomorrow)) return "Завтра";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
  }).format(date);
};

function ChevronIcon({ direction = "down" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={direction === "left" ? styles.chevronLeft : direction === "right" ? styles.chevronRight : ""}
    >
      <path d="m7 9 5 5 5-5" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M13 5v8M35 5v8" />
      <rect x="5" y="10" width="38" height="33" rx="5" />
      <path d="M5 20h38" />
      <path d="m27 36 9-9M29 27h7v7" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 34 28" aria-hidden="true">
      <circle cx="11" cy="8" r="5" />
      <circle cx="23" cy="8" r="5" />
      <path d="M1 26c.3-8 3.7-12 10-12 4.5 0 7.5 2.2 9 6.5" />
      <path d="M13 26c.3-8 3.7-12 10-12s9.7 4 10 12H13Z" />
    </svg>
  );
}

function Calendar() {
  const navigate = useNavigate();
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const today = useMemo(() => new Date(), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [visibleMonth, setVisibleMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [meetings, setMeetings] = useState([]);
  const [storageReady, setStorageReady] = useState(false);
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState(toDateKey(today));
  const [meetingTime, setMeetingTime] = useState("14:00");
  const [participantsCount, setParticipantsCount] = useState("");
  const [formError, setFormError] = useState("");
  const calendarRef = useRef(null);

  const storageKey = useMemo(() => {
    if (!isAuthenticated) return null;
    return `talksphere:calendar:${user?.id || user?.username || "account"}`;
  }, [isAuthenticated, user?.id, user?.username]);

  useEffect(() => {
    setStorageReady(false);

    if (!storageKey) {
      setMeetings([]);
      setStorageReady(true);
      return;
    }

    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      setMeetings(Array.isArray(saved) ? saved : []);
    } catch {
      setMeetings([]);
    } finally {
      setStorageReady(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageReady || !storageKey) return;
    localStorage.setItem(storageKey, JSON.stringify(meetings));
  }, [meetings, storageKey, storageReady]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target)) {
        setCalendarOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setCalendarOpen(false);
        setDialogOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(
      visibleMonth.getFullYear(),
      visibleMonth.getMonth(),
      1,
    );
    const mondayOffset = (firstDay.getDay() + 6) % 7;
    const gridStart = new Date(firstDay);
    gridStart.setDate(firstDay.getDate() - mondayOffset);

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return date;
    });
  }, [visibleMonth]);

  const selectedDateKey = toDateKey(selectedDate);
  const selectedMeetings = useMemo(
    () =>
      meetings
        .filter((meeting) => meeting.date === selectedDateKey)
        .sort((first, second) => first.time.localeCompare(second.time)),
    [meetings, selectedDateKey],
  );

  const chooseDate = (date) => {
    setSelectedDate(date);
    setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setMeetingDate(toDateKey(date));
    setCalendarOpen(false);
  };

  const moveMonth = (offset) => {
    setVisibleMonth(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + offset, 1),
    );
  };

  const requestAuthentication = () => {
    sessionStorage.setItem("redirect_after_login", "/calendar");
    sessionStorage.setItem("talksphere:calendar:open-schedule", "1");
    navigate("/login", {
      state: {
        from: "/calendar",
        message: "Войдите или зарегистрируйтесь, чтобы запланировать встречу",
      },
    });
  };

  const openScheduleDialog = () => {
    if (authLoading) return;

    if (!isAuthenticated) {
      requestAuthentication();
      return;
    }

    setFormError("");
    setTitle("");
    setMeetingDate(selectedDateKey);
    setMeetingTime("14:00");
    setParticipantsCount("");
    setDialogOpen(true);
  };

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;

    if (sessionStorage.getItem("talksphere:calendar:open-schedule") === "1") {
      sessionStorage.removeItem("talksphere:calendar:open-schedule");
      setFormError("");
      setTitle("");
      setMeetingDate(selectedDateKey);
      setMeetingTime("14:00");
      setParticipantsCount("");
      setDialogOpen(true);
    }
  }, [authLoading, isAuthenticated, selectedDateKey]);

  const scheduleMeeting = (event) => {
    event.preventDefault();

    if (!isAuthenticated) {
      setDialogOpen(false);
      requestAuthentication();
      return;
    }

    setFormError("");

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setFormError("Введите название встречи");
      return;
    }

    const meeting = {
      id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      title: normalizedTitle,
      date: meetingDate,
      time: meetingTime,
      participantsCount: participantsCount ? Number(participantsCount) : null,
      createdAt: new Date().toISOString(),
    };

    setMeetings((current) => [...current, meeting]);
    chooseDate(fromDateKey(meetingDate));
    setDialogOpen(false);
  };

  const removeMeeting = (meetingId) => {
    setMeetings((current) =>
      current.filter((meeting) => meeting.id !== meetingId),
    );
  };

  return (
    <div className={styles.page}>
      <Header />

      <main className={styles.main}>
        <div className={styles.datePicker} ref={calendarRef}>
          <button
            type="button"
            className={styles.dateButton}
            onClick={() => setCalendarOpen((value) => !value)}
            aria-expanded={calendarOpen}
            aria-haspopup="dialog"
          >
            <span>{formatSelectedDate(selectedDate)}</span>
            <ChevronIcon />
          </button>

          {calendarOpen && (
            <section
              className={styles.calendarPopover}
              role="dialog"
              aria-label="Выбор даты"
            >
              <div className={styles.calendarHeader}>
                <button
                  type="button"
                  onClick={() => moveMonth(-1)}
                  aria-label="Предыдущий месяц"
                >
                  <ChevronIcon direction="left" />
                </button>

                <strong>
                  {MONTHS[visibleMonth.getMonth()]} {visibleMonth.getFullYear()}
                </strong>

                <button
                  type="button"
                  onClick={() => moveMonth(1)}
                  aria-label="Следующий месяц"
                >
                  <ChevronIcon direction="right" />
                </button>
              </div>

              <div className={styles.weekdays} aria-hidden="true">
                {WEEKDAYS.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>

              <div className={styles.calendarGrid}>
                {calendarDays.map((date) => {
                  const dateKey = toDateKey(date);
                  const hasMeeting = meetings.some(
                    (meeting) => meeting.date === dateKey,
                  );
                  const outsideMonth =
                    date.getMonth() !== visibleMonth.getMonth();

                  return (
                    <button
                      type="button"
                      key={dateKey}
                      className={`${styles.dayButton} ${
                        outsideMonth ? styles.outsideMonth : ""
                      } ${
                        isSameDay(date, selectedDate) ? styles.selectedDay : ""
                      } ${isSameDay(date, today) ? styles.today : ""}`}
                      onClick={() => chooseDate(date)}
                      aria-label={new Intl.DateTimeFormat("ru-RU", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      }).format(date)}
                    >
                      {date.getDate()}
                      {hasMeeting && <span className={styles.meetingDot} />}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className={styles.goTodayButton}
                onClick={() => chooseDate(new Date())}
              >
                Перейти к сегодняшнему дню
              </button>
            </section>
          )}
        </div>

        <section className={styles.calendarContent}>
          <div className={styles.meetingsList} aria-live="polite">
            {selectedMeetings.length === 0 ? (
              <article className={`${styles.meetingCard} ${styles.emptyCard}`}>
                Встреч не запланировано
              </article>
            ) : (
              selectedMeetings.map((meeting) => (
                <article className={styles.meetingCard} key={meeting.id}>
                  <button
                    type="button"
                    className={styles.removeMeeting}
                    onClick={() => removeMeeting(meeting.id)}
                    aria-label={`Удалить встречу ${meeting.title}`}
                  >
                    ×
                  </button>

                  <h2>{meeting.title}</h2>

                  <div className={styles.meetingMeta}>
                    <span className={styles.participantsMeta}>
                      <UsersIcon />
                      {meeting.participantsCount
                        ? `Участников: ${meeting.participantsCount}`
                        : "Кол-во участников"}
                    </span>
                    <time dateTime={`${meeting.date}T${meeting.time}`}>
                      {meeting.time}
                    </time>
                  </div>
                </article>
              ))
            )}
          </div>

          <button
            type="button"
            className={styles.scheduleButton}
            onClick={openScheduleDialog}
            disabled={authLoading}
          >
            <CalendarIcon />
            <span>Запланировать встречу</span>
          </button>
        </section>
      </main>

      <Footer />

      {dialogOpen && (
        <div
          className={styles.overlay}
          onMouseDown={() => setDialogOpen(false)}
        >
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.closeButton}
              onClick={() => setDialogOpen(false)}
              aria-label="Закрыть"
            >
              ×
            </button>

            <h2 id="schedule-title">Запланировать встречу</h2>

            <form onSubmit={scheduleMeeting} className={styles.form}>
              <label className={styles.field}>
                <span>Название</span>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Например, встреча команды"
                  maxLength={120}
                  autoFocus
                />
              </label>

              <div className={styles.formRow}>
                <label className={styles.field}>
                  <span>Дата</span>
                  <input
                    type="date"
                    value={meetingDate}
                    onChange={(event) => setMeetingDate(event.target.value)}
                    required
                  />
                </label>

                <label className={styles.field}>
                  <span>Время</span>
                  <input
                    type="time"
                    value={meetingTime}
                    onChange={(event) => setMeetingTime(event.target.value)}
                    required
                  />
                </label>
              </div>

              <label className={styles.field}>
                <span>Количество участников</span>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={participantsCount}
                  onChange={(event) => setParticipantsCount(event.target.value)}
                  placeholder="Необязательно"
                />
              </label>

              {formError && (
                <p className={styles.formError} role="alert">
                  {formError}
                </p>
              )}

              <p className={styles.formHint}>
                В текущем API нет сущности запланированной встречи, поэтому
                запись сохраняется в этом браузере для вашего аккаунта.
              </p>

              <button type="submit" className={styles.submitButton}>
                Запланировать
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default Calendar;
