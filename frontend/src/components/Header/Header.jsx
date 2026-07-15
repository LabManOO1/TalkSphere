import { useState } from "react";
import styles from "./Header.module.scss";
import profileIcon from "../../assets/icons/profile.svg";


function Header() {

    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const closeMenu = () => setIsMenuOpen(false);

    return (
        <header className={styles.header}>
            <div className={styles.container}>

                <div className={styles.logo}>
                    TalkSphere
                </div>


                <div className={styles.right}>

                    <nav className={`${styles.navigation} ${isMenuOpen ? styles.navigationOpen : ""}`}>

                        <a href="#" onClick={closeMenu}>
                            Главная
                        </a>

                        <a href="#" onClick={closeMenu}>
                            Встречи
                        </a>

                        <a href="#" onClick={closeMenu}>
                            Календарь
                        </a>

                    </nav>


                    <button className={styles.profileButton}>
                        <img
                            src={profileIcon}
                            alt="Профиль"
                        />
                    </button>


                    <button
                        className={`${styles.burger} ${isMenuOpen ? styles.burgerOpen : ""}`}
                        onClick={() => setIsMenuOpen((prev) => !prev)}
                        aria-label="Открыть меню"
                        aria-expanded={isMenuOpen}
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
