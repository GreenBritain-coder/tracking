import { useEffect, useState } from 'react';
import { api, TrackingNumber, Box } from '../api/api';
import './Dashboard.css';

const STATUS_COLORS = {
  not_scanned: '#e74c3c',
  scanned: '#f39c12',
  delivered: '#27ae60',
};

const STATUS_EMOJIS = {
  not_scanned: '🔴',
  scanned: '🟡',
  delivered: '🟢',
};

const STATUS_LABELS = {
  not_scanned: 'Not Scanned',
  scanned: 'Scanned by RM',
  delivered: 'Delivered',
};

export default function Dashboard() {
  const [trackingNumbers, setTrackingNumbers] = useState<TrackingNumber[]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selectedBox, setSelectedBox] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadData();
    // Refresh every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [selectedBox]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [trackingRes, boxesRes] = await Promise.all([
        api.getTrackingNumbers(selectedBox || undefined),
        api.getBoxes(),
      ]);
      setTrackingNumbers(trackingRes.data);
      setBoxes(boxesRes.data);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this tracking number?')) {
      return;
    }

    try {
      await api.deleteTrackingNumber(id);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  };

  const handleRefresh = async () => {
    if (!confirm('This will refresh all tracking statuses. This may take a few minutes. Continue?')) {
      return;
    }

    try {
      setRefreshing(true);
      await api.refreshTrackingStatuses();
      alert('Refresh started! Statuses will update shortly. The page will refresh in 10 seconds.');
      // Reload data after a delay to see updated statuses
      setTimeout(() => {
        loadData();
        setRefreshing(false);
      }, 10000);
    } catch (err: any) {
      setRefreshing(false);
      alert(err.response?.data?.error || 'Failed to start refresh');
    }
  };

  const handleStatusChange = async (id: number, newStatus: 'not_scanned' | 'scanned' | 'delivered') => {
    try {
      await api.updateTrackingStatus(id, newStatus);
      // Reload data to show updated status
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update status');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  // Get the most recently updated tracking number
  const getMostRecentUpdate = () => {
    if (trackingNumbers.length === 0) return null;
    return trackingNumbers.reduce((latest, current) => {
      return new Date(current.updated_at) > new Date(latest.updated_at) ? current : latest;
    });
  };

  const mostRecent = getMostRecentUpdate();

  if (loading && trackingNumbers.length === 0) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Tracking Dashboard</h2>
        <div className="dashboard-actions">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="refresh-btn"
            style={{ marginRight: '10px', padding: '8px 16px', cursor: refreshing ? 'not-allowed' : 'pointer' }}
          >
            {refreshing ? 'Refreshing...' : '🔄 Refresh All Statuses'}
          </button>
          <div className="filter-controls">
            <label>
              Filter by Box:
              <select
                value={selectedBox || ''}
                onChange={(e) =>
                  setSelectedBox(e.target.value ? parseInt(e.target.value) : null)
                }
              >
                <option value="">All Boxes</option>
                {boxes.map((box) => (
                  <option key={box.id} value={box.id}>
                    {box.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="stats">
        <div className="stat-card" style={{ borderColor: STATUS_COLORS.not_scanned }}>
          <div className="stat-emoji">{STATUS_EMOJIS.not_scanned}</div>
          <div className="stat-value">
            {trackingNumbers.filter((t) => t.current_status === 'not_scanned').length}
          </div>
          <div className="stat-label">Not Scanned</div>
        </div>
        <div className="stat-card" style={{ borderColor: STATUS_COLORS.scanned }}>
          <div className="stat-emoji">{STATUS_EMOJIS.scanned}</div>
          <div className="stat-value">
            {trackingNumbers.filter((t) => t.current_status === 'scanned').length}
          </div>
          <div className="stat-label">Scanned</div>
        </div>
        <div className="stat-card" style={{ borderColor: STATUS_COLORS.delivered }}>
          <div className="stat-emoji">{STATUS_EMOJIS.delivered}</div>
          <div className="stat-value">
            {trackingNumbers.filter((t) => t.current_status === 'delivered').length}
          </div>
          <div className="stat-label">Delivered</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{trackingNumbers.length}</div>
          <div className="stat-label">Total</div>
        </div>
      </div>

      {mostRecent && (
        <div className="last-update-banner">
          <div className="last-update-icon">
            {STATUS_EMOJIS[mostRecent.current_status]}
          </div>
          <div className="last-update-content">
            <div className="last-update-label">Last Status Update</div>
            <div className="last-update-text">
              <strong>{mostRecent.tracking_number}</strong> - {STATUS_LABELS[mostRecent.current_status]} 
              {mostRecent.box_name && ` (${mostRecent.box_name})`}
            </div>
            <div className="last-update-time">Updated {formatDate(mostRecent.updated_at)}</div>
          </div>
        </div>
      )}

      <div className="tracking-table-container">
        <table className="tracking-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Status Details</th>
              <th>Tracking Number</th>
              <th>Box</th>
              <th>Created</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {trackingNumbers.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-state">
                  No tracking numbers found
                </td>
              </tr>
            ) : (
              trackingNumbers.map((tn) => (
                <tr key={tn.id}>
                  <td>
                    <span
                      className="status-badge"
                      style={{ backgroundColor: STATUS_COLORS[tn.current_status] }}
                    >
                      {STATUS_EMOJIS[tn.current_status]} {STATUS_LABELS[tn.current_status]}
                    </span>
                  </td>
                  <td className="status-details">{tn.status_details || '-'}</td>
                  <td className="tracking-number">{tn.tracking_number}</td>
                  <td>{tn.box_name || '-'}</td>
                  <td>{formatDate(tn.created_at)}</td>
                  <td>{formatDate(tn.updated_at)}</td>
                  <td>
                    <div className="action-buttons">
                      <select
                        value={tn.current_status}
                        onChange={(e) => handleStatusChange(tn.id, e.target.value as 'not_scanned' | 'scanned' | 'delivered')}
                        className="status-select"
                      >
                        <option value="not_scanned">🔴 Not Scanned</option>
                        <option value="scanned">🟡 Scanned</option>
                        <option value="delivered">🟢 Delivered</option>
                      </select>
                      <button
                        onClick={() => handleDelete(tn.id)}
                        className="delete-btn"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

