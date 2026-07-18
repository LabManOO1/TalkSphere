import { Link } from "react-router-dom";
import styles from "./GetStarted.module.scss";

const steps = [
  "Зарегистрироваться за минуту",
  "Создать встречу за 10 секунд",
  "Пригласить участников",
];

function GetStarted() {
  return (
    <section className={styles.getStarted}>
      <img
        className={styles.wave}
        src="/wave-lines.svg"
        alt=""
        aria-hidden="true"
      />
      <div className={`container ${styles.content}`}>
        <h2 className={styles.heading}>Как начать работу?</h2>

        <div className={styles.steps}>
          {steps.map((step, index) => (
            <div className={styles.stepWrapper} key={step}>
              <div className={styles.step}>{step}</div>

              {index < steps.length - 1 && (
                <span className={styles.arrow} aria-hidden="true">
                  →
                </span>
              )}
            </div>
          ))}
        </div>

        <h3 className={styles.subheading}>
          Создайте аккаунт и проведите первую встречу через 5 минут
        </h3>

        <Link to="/register" className={styles.cta}>
          Попробовать бесплатно
        </Link>

        <p className={styles.footNote}>
          Начните использовать TalkSphere уже сегодня!
        </p>
      </div>
    </section>
  );
}

export default GetStarted;
