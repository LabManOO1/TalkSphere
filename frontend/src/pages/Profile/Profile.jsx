import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../../components/Header/Header";
import Footer from "../../components/Footer/Footer";
import { useAuth } from "../../context/AuthContext";
import styles from "./Profile.module.scss";

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c.4-6 3-9 8-9s7.6 3 8 9" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 20 6v6c0 5-3 8-8 10-5-2-8-5-8-10V6l8-3Z" />
      <path d="m8.5 12 2.2 2.2 4.8-5" />
    </svg>
  );
}

function Profile() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const username = user?.username?.trim() || "Пользователь";
  const email = user?.email?.trim() || "Email не указан";
  const userId = user?.id == null ? "Не указан" : String(user.id);

  const initials = useMemo(
    () =>
      username
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "П",
    [username],
  );

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className={styles.page}>
      <Header />

      <main className={styles.main}>
        <section className={styles.profileCard} aria-labelledby="profile-title">
          <div className={styles.profileHero}>
            <div className={styles.avatar} aria-label={`Аватар пользователя ${username}`}>
              {initials}
            </div>

            <div className={styles.identity}>
              <span className={styles.eyebrow}>Личный кабинет</span>
              <h1 id="profile-title">{username}</h1>
              <p>{email}</p>
            </div>

            <span className={styles.status}>Аккаунт активен</span>
          </div>

          <div className={styles.contentGrid}>
            <section className={styles.details} aria-labelledby="account-details-title">
              <div className={styles.sectionHeading}>
                <h2 id="account-details-title">Информация об аккаунте</h2>
                <p>Основные данные, связанные с вашей учётной записью.</p>
              </div>

              <dl className={styles.infoList}>
                <div className={styles.infoItem}>
                  <span className={styles.infoIcon}><UserIcon /></span>
                  <div>
                    <dt>Имя пользователя</dt>
                    <dd>{username}</dd>
                  </div>
                </div>

                <div className={styles.infoItem}>
                  <span className={styles.infoIcon}><MailIcon /></span>
                  <div>
                    <dt>Email</dt>
                    <dd className={!user?.email ? styles.missingValue : ""}>{email}</dd>
                  </div>
                </div>

                <div className={styles.infoItem}>
                  <span className={styles.infoIcon}><ShieldIcon /></span>
                  <div>
                    <dt>ID пользователя</dt>
                    <dd className={styles.userId}>{userId}</dd>
                  </div>
                </div>
              </dl>
            </section>

            <aside className={styles.sideCard}>
              <h2>Профиль</h2>
              <p>
                Фото пока не хранится в базе данных, поэтому используется аватар
                с вашими инициалами.
              </p>

              <div className={styles.accountNote}>
                <strong>Безопасность</strong>
                <span>Пароль никогда не отображается на странице профиля.</span>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => navigate("/meetings")}
                >
                  Перейти к встречам
                </button>
                <button
                  type="button"
                  className={styles.logoutButton}
                  onClick={handleLogout}
                >
                  Выйти из аккаунта
                </button>
              </div>
            </aside>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

export default Profile;
