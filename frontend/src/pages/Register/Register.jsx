import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import styles from './Register.module.scss';

function Register() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    if (password.length < 6) {
      setError('Пароль должен быть не менее 6 символов');
      return;
    }

    setIsLoading(true);

    const result = await register(username, email, password);

    if (result.success) {
      navigate('/');
    } else {
      setError(result.error);
    }

    setIsLoading(false);
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Логотип сверху */}
        <Link to="/" className={styles.logo}>
          TalkSphere
        </Link>

        {/* Табы */}
        <div className={styles.tabs}>
          <Link to="/login" className={styles.tab}>
            Вход
          </Link>
          <Link to="/register" className={`${styles.tab} ${styles.active}`}>
            Регистрация
          </Link>
        </div>

        {/* Заголовок */}
        <h1 className={styles.title}>Добро пожаловать!</h1>

        {/* Форма */}
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label}>Email или имя пользователя</label>
            <input
              type="text"
              className={styles.input}
              placeholder="Введите email или имя"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Введите пароль</label>
            <input
              type="password"
              className={styles.input}
              placeholder="Введите пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Повторите пароль</label>
            <input
              type="password"
              className={styles.input}
              placeholder="Повторите пароль"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <button
            type="submit"
            className={styles.button}
            disabled={isLoading}
          >
            {isLoading ? 'Регистрация...' : 'ЗАРЕГИСТРИРОВАТЬСЯ'}
          </button>
        </form>

        {/* Копирайт */}
        <p className={styles.copyright}>© TalkSphere</p>
      </div>
    </div>
  );
}

export default Register;