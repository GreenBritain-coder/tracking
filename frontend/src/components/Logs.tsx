import { useState, useEffect } from 'react';
import { api, StatusChangeLog, Box } from '../api/api';
import './Logs.css';

export default function Logs() {
  const [logs, setLogs] = useState<StatusChangeLog[]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);
  const [changeTypeFilter, setChangeTypeFilter] = useState<'all' | 'status_change' | 'details_update'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'not_scanned' | 'scanned' | 'delivered'>('all');
  const [boxFilter, setBoxFilter] = useState<number | null>(null);
  const [trackingNumberSearch, setTrackingNumberSearch] = useState<string>('');

  useEffect(() => {
    loadBoxes();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [limit, changeTypeFilter, statusFilter, boxFilter, trackingNumberSearch]);

  const loadBoxes = async () => {
    try {
      const response = await api.getBoxes();
      setBoxes(response.data);
    } catch (err) {
      console.error('Failed to load boxes:', err);
    }
  };

  const loadLogs = async () => {
    try {
      setLoading(true);
      const response = await api.getStatusChangeLogs(
        limit,
        changeTypeFilter !== 'all' ? changeTypeFilter : undefined,
        statusFilter !== 'all' ? statusFilter : undefined,
        boxFilter || undefined,
        trackingNumberSearch || undefined
      );
      setLogs(response.data);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'not_scanned': return '🔴';
      case 'scanned': return '🟡';
      case 'delivered': return '🟢';
      default: return '⚪';
    }
  };

  const getChangeTypeIcon = (changeType: string) => {
    return changeType === 'status_change' ? '📈' : '📝';
  };

  if (loading) {
    return (
      <div className="logs">
        <h2>Status Change Logs</h2>
        <div className="loading">Loading logs...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="logs">
        <h2>Status Change Logs</h2>
        <div className="error">Error: {error}</div>
        <button onClick={loadLogs} className="retry-btn">Retry</button>
      </div>
    );
  }

  return (
    <div className="logs">
      <div className="logs-header">
        <h2>📋 Status Change Logs</h2>
        <div className="logs-controls">
          <label>
            Show last:
            <select
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value))}
            >
              <option value={50}>50 entries</option>
              <option value={100}>100 entries</option>
              <option value={200}>200 entries</option>
            </select>
          </label>
          <button onClick={loadLogs} className="refresh-btn">
            🔄 Refresh
          </button>
        </div>
      </div>

      <div className="logs-filters">
        <div className="filter-group">
          <label>
            <span>Change Type:</span>
            <select
              value={changeTypeFilter}
              onChange={(e) => setChangeTypeFilter(e.target.value as 'all' | 'status_change' | 'details_update')}
            >
              <option value="all">All Types</option>
              <option value="status_change">📈 Status Change</option>
              <option value="details_update">📝 Details Update</option>
            </select>
          </label>
        </div>

        <div className="filter-group">
          <label>
            <span>Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'not_scanned' | 'scanned' | 'delivered')}
            >
              <option value="all">All Statuses</option>
              <option value="not_scanned">🔴 Not Scanned</option>
              <option value="scanned">🟡 Scanned</option>
              <option value="delivered">🟢 Delivered</option>
            </select>
          </label>
        </div>

        <div className="filter-group">
          <label>
            <span>Box:</span>
            <select
              value={boxFilter || ''}
              onChange={(e) => setBoxFilter(e.target.value ? parseInt(e.target.value) : null)}
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

        <div className="filter-group">
          <label>
            <span>🔍 Search Tracking:</span>
            <input
              type="text"
              placeholder="Enter tracking number..."
              value={trackingNumberSearch}
              onChange={(e) => setTrackingNumberSearch(e.target.value)}
            />
          </label>
        </div>

        {(changeTypeFilter !== 'all' || statusFilter !== 'all' || boxFilter !== null || trackingNumberSearch) && (
          <button
            onClick={() => {
              setChangeTypeFilter('all');
              setStatusFilter('all');
              setBoxFilter(null);
              setTrackingNumberSearch('');
            }}
            className="clear-filters-btn"
          >
            Clear Filters
          </button>
        )}
      </div>

      {logs.length === 0 ? (
        <div className="no-logs">
          <p>No status changes recorded yet.</p>
          <p>Status changes will appear here when tracking numbers are updated automatically or manually.</p>
        </div>
      ) : (
        <div className="logs-table-container">
          <table className="logs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Tracking Number</th>
                <th>Change Type</th>
                <th>Status Change</th>
                <th>Details</th>
                <th>Box</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="timestamp">
                    {formatDate(log.changed_at)}
                  </td>
                  <td className="tracking-number">
                    <code>{log.tracking_number}</code>
                  </td>
                  <td className="change-type">
                    {getChangeTypeIcon(log.change_type)}
                    {log.change_type === 'status_change' ? 'Status Change' : 'Details Update'}
                  </td>
                  <td className="status-change">
                    {log.change_type === 'status_change' ? (
                      <span>
                        {log.old_status && (
                          <span className="old-status">
                            {getStatusIcon(log.old_status)} {log.old_status}
                          </span>
                        )}
                        <span className="arrow"> → </span>
                        <span className="new-status">
                          {getStatusIcon(log.new_status)} {log.new_status}
                        </span>
                      </span>
                    ) : (
                      <span className="details-only">Details only</span>
                    )}
                  </td>
                  <td className="status-details">
                    {log.status_details || <em>(none)</em>}
                  </td>
                  <td className="box-name">
                    {log.box_name || <em>(none)</em>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="logs-info">
        <p>
          <strong>Note:</strong> These logs show recent status changes for tracking numbers.
          Status changes occur through automatic updates (every 4 hours) or manual refreshes.
        </p>
      </div>
    </div>
  );
}
