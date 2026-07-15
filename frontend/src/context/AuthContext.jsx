import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import apiClient from '../api/client';

const AuthContext = createContext(null);

const TOKEN_KEY = 'token';
const USER_KEY = 'auth_user';

const parseApiError = (error, fallbackMessage) => {
  const detail = error.response?.data?.detail;

  if (typeof detail === 'string') {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => item?.msg)
      .filter(Boolean)
      .join('. ') || fallbackMessage;
  }

  if (!error.response) {
    return 'Не удалось подключиться к серверу';
  }

  return fallbackMessage;
};

const decodeTokenPayload = (token) => {
  try {
    const payload = token.split('.')[1];

    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    );

    return JSON.parse(window.atob(padded));
  } catch {
    return null;
  }
};

const isExpired = (token) => {
  const payload = decodeTokenPayload(token);

  if (!payload?.exp) {
    return false;
  }

  return payload.exp * 1000 <= Date.now();
};

const readStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const clearSession = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setIsAuthenticated(false);
  };

  const saveSession = (token, userData) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
    setUser(userData);
    setIsAuthenticated(true);
  };

  useEffect(() => {
    const handleUnauthorized = () => {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      setUser(null);
      setIsAuthenticated(false);
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);

    const token = localStorage.getItem(TOKEN_KEY);

    if (!token || isExpired(token)) {
      handleUnauthorized();
      setLoading(false);

      return () => {
        window.removeEventListener('auth:unauthorized', handleUnauthorized);
      };
    }

    const payload = decodeTokenPayload(token);
    const storedUser = readStoredUser();

    setUser(
      storedUser || {
        id: payload?.sub || null,
      },
    );
    setIsAuthenticated(true);
    setLoading(false);

    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);

  const register = async (username, email, password) => {
    try {
      const response = await apiClient.post('/auth/register', {
        username,
        email,
        password,
      });

      const token = response.data?.access_token;

      if (!token) {
        return {
          success: false,
          error: 'Сервер не вернул токен доступа',
        };
      }

      const payload = decodeTokenPayload(token);
      saveSession(token, {
        id: payload?.sub || null,
        username,
        email,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: parseApiError(error, 'Ошибка регистрации'),
      };
    }
  };

  const login = async (username, password) => {
    try {
      const body = new URLSearchParams();
      body.set('username', username);
      body.set('password', password);

      const response = await apiClient.post('/auth/login', body, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const token = response.data?.access_token;

      if (!token) {
        return {
          success: false,
          error: 'Сервер не вернул токен доступа',
        };
      }

      const payload = decodeTokenPayload(token);
      saveSession(token, {
        id: payload?.sub || null,
        username,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: parseApiError(error, 'Ошибка входа'),
      };
    }
  };

  const logout = () => {
    clearSession();
  };

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated,
      register,
      login,
      logout,
    }),
    [user, loading, isAuthenticated],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth должен использоваться внутри AuthProvider');
  }

  return context;
};