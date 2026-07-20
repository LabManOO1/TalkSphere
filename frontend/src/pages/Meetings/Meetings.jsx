import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../../components/Header/Header";
import Footer from "../../components/Footer/Footer";
import { useAuth } from "../../context/AuthContext";
import apiClient from "../../api/client";
import styles from "./Meetings.module.scss";

const getErrorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail;

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    return (
      detail
        .map((item) => item?.msg)
        .filter(Boolean)
        .join(". ") || fallback
    );
  }

  if (!error.response) return "Не удалось подключиться к серверу";

  return fallback;
};

function CameraIcon() {
  return (
    <svg viewBox="0 0 120 96" aria-hidden="true">
      <rect x="13" y="17" width="72" height="62" rx="14" />
      <path d="M85 39 108 26v44L85 57" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 112 112" aria-hidden="true">
      <path d="M25 18v15M87 18v15" />
      <path d="M19 29h74a8 8 0 0 1 8 8v54a8 8 0 0 1-8 8H19a8 8 0 0 1-8-8V37a8 8 0 0 1 8-8Z" />
      <path d="M11 47h90" />
      <path d="M72 99V75h29" />
      <path d="m73 98 27-26" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 120 112" aria-hidden="true">
      <circle cx="42" cy="39" r="16" />
      <circle cx="79" cy="39" r="16" />
      <path d="M12 91c1-21 12-31 30-31 13 0 22 6 27 18" />
      <path d="M49 91c1-21 12-31 30-31s29 10 30 31H49Z" />
    </svg>
  );
}

function Meetings() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const [dialog, setDialog] = useState(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const closeDialog = () => {
    if (isLoading) return;
    setDialog(null);
    setError("");
  };

  const openCreateDialog = () => {
    setError("");

    if (!isAuthenticated) {
      setDialog("auth");
      return;
    }

    setDialog("create");
  };

  const handleCreateRoom = async (event) => {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const response = await apiClient.post("/rooms/create", {
        title: title.trim() || "Новая конференция",
      });

      const room = response.data;
      sessionStorage.setItem("selected_room", JSON.stringify(room));
      navigate(`/conference/${encodeURIComponent(room.invite_code)}`, {
        state: { room },
      });
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Не удалось создать конференцию"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <Header />

      <main className={styles.main}>
        <section className={styles.actions} aria-label="Действия со встречами">
          <button
            type="button"
            className={`${styles.action} ${styles.primaryAction}`}
            onClick={openCreateDialog}
          >
            <span className={styles.iconBox}>
              <CameraIcon />
            </span>
            <span className={styles.actionLabel}>Создать конференцию</span>
          </button>

          <div className={styles.secondaryRow}>
            <button
              type="button"
              className={`${styles.action} ${styles.secondaryAction}`}
              onClick={() => navigate("/calendar")}
            >
              <span className={styles.iconBox}>
                <CalendarIcon />
              </span>
              <span className={styles.actionLabel}>Запланировать</span>
            </button>

            <button
              type="button"
              className={`${styles.action} ${styles.secondaryAction}`}
              onClick={() => navigate("/meetings/join")}
            >
              <span className={`${styles.iconBox} ${styles.usersIconBox}`}>
                <UsersIcon />
              </span>
              <span className={styles.actionLabel}>Подключиться</span>
            </button>
          </div>
        </section>
      </main>

      <Footer />

      {dialog && (
        <div className={styles.overlay} onMouseDown={closeDialog}>
          <div
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="meeting-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.closeButton}
              onClick={closeDialog}
              aria-label="Закрыть окно"
            >
              ×
            </button>

            {dialog === "auth" && (
              <>
                <h2 id="meeting-dialog-title">Нужно войти</h2>
                <p className={styles.dialogText}>
                  Создавать конференции могут только авторизованные пользователи.
                </p>
                <button
                  type="button"
                  className={styles.dialogButton}
                  onClick={() => navigate("/login")}
                >
                  Перейти ко входу
                </button>
              </>
            )}

            {dialog === "create" && (
              <form onSubmit={handleCreateRoom}>
                <h2 id="meeting-dialog-title">Новая конференция</h2>
                <label className={styles.field}>
                  <span>Название</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Новая конференция"
                    maxLength={120}
                    autoFocus
                  />
                </label>

                {error && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  className={styles.dialogButton}
                  disabled={isLoading}
                >
                  {isLoading ? "Создаём..." : "Создать и войти"}
                </button>
              </form>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

export default Meetings;
