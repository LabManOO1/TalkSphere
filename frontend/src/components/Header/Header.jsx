import { useState } from "react";
import { Link } from "react-router-dom";
import styles from "./Header.module.scss";
import profileIcon from "../../assets/icons/profile.svg";

function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const closeMenu = () => setIsMenuOpen(false);

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <Link to="/" className={styles.logo}>
          TalkSphere
        </Link>

        <div className={styles.right}>
          <nav
            className={`${styles.navigation} ${
              isMenuOpen ? styles.navigationOpen : ""
            }`}
          >
            <Link to="/" onClick={closeMenu}>
              Главная
            </Link>
            <Link to="/meetings" onClick={closeMenu}>
              Встречи
            </Link>
            <Link to="/calendar" onClick={closeMenu}>
              Календарь
            </Link>
          </nav>

          <Link to="/login" className={styles.profileButton}>
            <img src={profileIcon} alt="Профиль" />
          </Link>

          <button
            className={`${styles.burger} ${
              isMenuOpen ? styles.burgerOpen : ""
            }`}
            onClick={() => setIsMenuOpen((prev) => !prev)}
            aria-label="Открыть меню"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </div>
    </header>
  );
}

export default Header;