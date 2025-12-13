import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Layout.css';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="layout">
      <nav className="navbar">
        <div className="nav-container">
          <h1 className="nav-title">RM Tracking</h1>
          <div className="nav-links">
            <Link
              to="/"
              className={location.pathname === '/' ? 'active' : ''}
            >
              Dashboard
            </Link>
            <Link
              to="/add"
              className={location.pathname === '/add' ? 'active' : ''}
            >
              Add Tracking
            </Link>
            <Link
              to="/analytics"
              className={location.pathname === '/analytics' ? 'active' : ''}
            >
              Analytics
            </Link>
          </div>
          <div className="nav-user">
            <span>{user?.email}</span>
            <button onClick={logout} className="logout-btn">
              Logout
            </button>
          </div>
        </div>
      </nav>
      <main className="main-content">{children}</main>
    </div>
  );
}

