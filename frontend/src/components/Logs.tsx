import { useState, useEffect } from 'react';
import { api, StatusChangeLog } from '../api/api';
import './Logs.css';

export default function Logs() {
  const [logs, setLogs] = useState<StatusChangeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    loadLogs();
  }, [limit]);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const response = await api.getStatusChangeLogs(limit);
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
