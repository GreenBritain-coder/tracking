import { useEffect, useState } from 'react';
import { api, TrackingNumber, Box, Postbox } from '../api/api';
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
  const [postboxes, setPostboxes] = useState<Postbox[]>([]);
  const [selectedBox, setSelectedBox] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showPostboxManager, setShowPostboxManager] = useState(false);
  const [editingPostbox, setEditingPostbox] = useState<Postbox | null>(null);
  const [newPostboxName, setNewPostboxName] = useState('');
  const [editingTrackingId, setEditingTrackingId] = useState<number | null>(null);
  const [customTimestamp, setCustomTimestamp] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [totalItems, setTotalItems] = useState(0);
  const [stats, setStats] = useState({
    not_scanned: 0,
    scanned: 0,
    delivered: 0,
    total: 0
  });

  useEffect(() => {
    loadData();
    // Refresh every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [selectedBox, currentPage, itemsPerPage]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [trackingRes, boxesRes, postboxesRes] = await Promise.all([
        api.getTrackingNumbers(selectedBox || undefined, currentPage, itemsPerPage),
        api.getBoxes(),
        api.getPostboxes(),
      ]);
      setTrackingNumbers(trackingRes.data.data);
      setTotalItems(trackingRes.data.total);
      setStats(trackingRes.data.stats);
      setBoxes(boxesRes.data);
      setPostboxes(postboxesRes.data);
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

  const handleRefreshSingle = async (id: number) => {
    try {
      await api.refreshTrackingNumber(id);
      loadData(); // Reload data to show updated status
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to refresh tracking number');
    }
  };

  const handleDeleteAll = async () => {
    const confirmMessage = `⚠️ WARNING: This will delete ALL ${stats.total} tracking numbers. This action cannot be undone!\n\nType "DELETE ALL" to confirm:`;
    const userInput = prompt(confirmMessage);
    
    if (userInput !== 'DELETE ALL') {
      return;
    }

    if (!confirm(`Are you absolutely sure you want to delete ALL ${stats.total} tracking numbers? This cannot be undone!`)) {
      return;
    }

    try {
      const response = await api.deleteAllTrackingNumbers();
      alert(response.data.message || 'All tracking numbers deleted successfully');
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete all tracking numbers');
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

  const handleStatusChange = async (
    id: number, 
    newStatus: 'not_scanned' | 'scanned' | 'delivered',
    postboxId?: number | null,
    timestamp?: string | null
  ) => {
    try {
      await api.updateTrackingStatus(id, newStatus, postboxId, timestamp);
      // Reload data to show updated status
      loadData();
      setEditingTrackingId(null);
      setCustomTimestamp('');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update status');
    }
  };

  const handlePostboxChange = async (id: number, postboxId: number | null) => {
    const tracking = trackingNumbers.find(t => t.id === id);
    if (!tracking) return;
    
    await handleStatusChange(
      id, 
      tracking.current_status, 
      postboxId,
      tracking.custom_timestamp || null
    );
  };

  const handlePostboxCreate = async () => {
    if (!newPostboxName.trim()) {
      alert('Please enter a postbox name');
      return;
    }
    try {
      await api.createPostbox(newPostboxName.trim());
      setNewPostboxName('');
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to create postbox');
    }
  };

  const handlePostboxUpdate = async (id: number, name: string) => {
    try {
      await api.updatePostbox(id, name);
      setEditingPostbox(null);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update postbox');
    }
  };

  const handlePostboxDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this postbox? This will remove it from all tracking numbers.')) {
      return;
    }
    try {
      await api.deletePostbox(id);
      loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete postbox');
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
          <button
            onClick={handleDeleteAll}
            className="delete-all-btn"
            style={{ 
              marginRight: '10px', 
              padding: '8px 16px', 
              cursor: 'pointer',
              backgroundColor: '#e74c3c',
              color: 'white',
              border: 'none',
              borderRadius: '4px'
            }}
          >
            🗑️ Delete All Entries
          </button>
          <button
            onClick={() => setShowPostboxManager(!showPostboxManager)}
            className="postbox-manager-btn"
            style={{ marginRight: '10px', padding: '8px 16px', cursor: 'pointer' }}
          >
            📮 Manage Postboxes
          </button>
          <div className="filter-controls">
            <label>
              Filter by Box:
              <select
                value={selectedBox || ''}
                onChange={(e) => {
                  setSelectedBox(e.target.value ? parseInt(e.target.value) : null);
                  setCurrentPage(1); // Reset to first page when filter changes
                }}
              >
                <option value="">All Boxes</option>
                {boxes.map((box) => (
                  <option key={box.id} value={box.id}>
                    {box.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Items per page:
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(parseInt(e.target.value));
                  setCurrentPage(1); // Reset to first page when page size changes
                }}
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
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
            {stats.not_scanned}
          </div>
          <div className="stat-label">Not Scanned</div>
        </div>
        <div className="stat-card" style={{ borderColor: STATUS_COLORS.scanned }}>
          <div className="stat-emoji">{STATUS_EMOJIS.scanned}</div>
          <div className="stat-value">
            {stats.scanned}
          </div>
          <div className="stat-label">Scanned</div>
        </div>
        <div className="stat-card" style={{ borderColor: STATUS_COLORS.delivered }}>
          <div className="stat-emoji">{STATUS_EMOJIS.delivered}</div>
          <div className="stat-value">
            {stats.delivered}
          </div>
          <div className="stat-label">Delivered</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
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

      {showPostboxManager && (
        <div className="postbox-manager">
          <div className="postbox-manager-header">
            <h3>📮 Manage Postboxes</h3>
            <button onClick={() => setShowPostboxManager(false)}>✕ Close</button>
          </div>
          <div className="postbox-manager-content">
            <div className="postbox-create">
              <input
                type="text"
                placeholder="New postbox name..."
                value={newPostboxName}
                onChange={(e) => setNewPostboxName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handlePostboxCreate()}
              />
              <button onClick={handlePostboxCreate}>Add Postbox</button>
            </div>
            <div className="postbox-list">
              {postboxes.map((postbox) => (
                <div key={postbox.id} className="postbox-item">
                  {editingPostbox?.id === postbox.id ? (
                    <>
                      <input
                        type="text"
                        value={editingPostbox.name}
                        onChange={(e) => setEditingPostbox({ ...editingPostbox, name: e.target.value })}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            handlePostboxUpdate(editingPostbox.id, editingPostbox.name);
                          } else if (e.key === 'Escape') {
                            setEditingPostbox(null);
                          }
                        }}
                        autoFocus
                      />
                      <button onClick={() => handlePostboxUpdate(editingPostbox.id, editingPostbox.name)}>✓</button>
                      <button onClick={() => setEditingPostbox(null)}>✕</button>
                    </>
                  ) : (
                    <>
                      <span>{postbox.name}</span>
                      <button onClick={() => setEditingPostbox(postbox)}>✏️ Edit</button>
                      <button onClick={() => handlePostboxDelete(postbox.id)}>🗑️ Delete</button>
                    </>
                  )}
                </div>
              ))}
              {postboxes.length === 0 && <p>No postboxes yet. Create one above.</p>}
            </div>
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
              <th>Postbox</th>
              <th>Custom Timestamp</th>
              <th>Created</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {trackingNumbers.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-state">
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
                  <td>
                    <select
                      value={tn.postbox_id || ''}
                      onChange={(e) => handlePostboxChange(tn.id, e.target.value ? parseInt(e.target.value) : null)}
                      className="postbox-select"
                    >
                      <option value="">-</option>
                      {postboxes.map((postbox) => (
                        <option key={postbox.id} value={postbox.id}>
                          {postbox.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {editingTrackingId === tn.id ? (
                      <div className="timestamp-edit">
                        <input
                          type="date"
                          value={customTimestamp || (tn.custom_timestamp ? new Date(tn.custom_timestamp).toISOString().slice(0, 10) : '')}
                          onChange={(e) => setCustomTimestamp(e.target.value)}
                          onPaste={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const pastedText = e.clipboardData.getData('text').trim();
                            console.log('Pasted text:', pastedText); // Debug log
                            
                            // Try to parse the pasted text as a date with time
                            let parsedDate = '';
                            let parsedTime = '00:00:00'; // Default to midnight
                            
                            // Handle formats with comma: "12/09/2025, 01:00:00" or "12/09/2025,01:00:00"
                            const commaMatch = pastedText.match(/^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})[,\s]+(\d{1,2}:\d{2}(?::\d{2})?)/);
                            if (commaMatch) {
                              const datePart = commaMatch[1];
                              const timePart = commaMatch[2];
                              const parts = datePart.split(/[\/\-]/);
                              const day = parts[0].padStart(2, '0');
                              const month = parts[1].padStart(2, '0');
                              const year = parts[2];
                              parsedDate = `${year}-${month}-${day}`;
                              // Normalize time format (ensure HH:MM:SS)
                              const timeParts = timePart.split(':');
                              parsedTime = `${timeParts[0].padStart(2, '0')}:${(timeParts[1] || '00').padStart(2, '0')}:${(timeParts[2] || '00').padStart(2, '0')}`;
                              console.log('Converted (comma format):', parsedDate, parsedTime);
                            }
                            // Try ISO format first (YYYY-MM-DD or YYYY-MM-DD HH:MM)
                            else if (/^\d{4}-\d{2}-\d{2}(\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(pastedText)) {
                              const parts = pastedText.split(/\s+/);
                              parsedDate = parts[0];
                              if (parts[1]) {
                                const timeParts = parts[1].split(':');
                                parsedTime = `${timeParts[0].padStart(2, '0')}:${(timeParts[1] || '00').padStart(2, '0')}:${(timeParts[2] || '00').padStart(2, '0')}`;
                              }
                            } 
                            // Try DD/MM/YYYY HH:MM or DD/MM/YYYY (UK format with optional time)
                            else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}(\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(pastedText)) {
                              const parts = pastedText.split(/\s+/);
                              const datePart = parts[0];
                              const dateParts = datePart.split(/[\/\-]/);
                              const day = dateParts[0].padStart(2, '0');
                              const month = dateParts[1].padStart(2, '0');
                              const year = dateParts[2];
                              parsedDate = `${year}-${month}-${day}`;
                              if (parts[1]) {
                                const timeParts = parts[1].split(':');
                                parsedTime = `${timeParts[0].padStart(2, '0')}:${(timeParts[1] || '00').padStart(2, '0')}:${(timeParts[2] || '00').padStart(2, '0')}`;
                              }
                              console.log('Converted (UK format):', parsedDate, parsedTime);
                            }
                            // Try to parse as Date object (handles various formats including with time)
                            else {
                              const date = new Date(pastedText);
                              if (!isNaN(date.getTime())) {
                                parsedDate = date.toISOString().slice(0, 10);
                                parsedTime = date.toISOString().slice(11, 19);
                                console.log('Parsed via Date object:', parsedDate, parsedTime);
                              }
                            }
                            
                            if (parsedDate) {
                              // Use setTimeout to ensure React state update happens after browser validation
                              setTimeout(() => {
                                setCustomTimestamp(parsedDate);
                                // Auto-save after paste with the correct time
                                // Use local timezone for the time, then convert to UTC
                                const dateTimestamp = new Date(`${parsedDate}T${parsedTime}`).toISOString();
                                handleStatusChange(tn.id, tn.current_status, tn.postbox_id, dateTimestamp);
                              }, 0);
                            } else {
                              console.warn('Could not parse pasted date:', pastedText);
                            }
                          }}
                          onBlur={() => {
                            if (customTimestamp) {
                              // Convert date to ISO timestamp (midnight UTC)
                              const dateTimestamp = customTimestamp ? new Date(customTimestamp + 'T00:00:00Z').toISOString() : null;
                              handleStatusChange(tn.id, tn.current_status, tn.postbox_id, dateTimestamp);
                            } else {
                              setEditingTrackingId(null);
                            }
                          }}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter' && customTimestamp) {
                              // Convert date to ISO timestamp (midnight UTC)
                              const dateTimestamp = customTimestamp ? new Date(customTimestamp + 'T00:00:00Z').toISOString() : null;
                              handleStatusChange(tn.id, tn.current_status, tn.postbox_id, dateTimestamp);
                            } else if (e.key === 'Escape') {
                              setEditingTrackingId(null);
                              setCustomTimestamp('');
                            }
                          }}
                          autoFocus
                        />
                      </div>
                    ) : (
                      <div className="timestamp-display">
                        <span>{tn.custom_timestamp ? formatDate(tn.custom_timestamp) : '-'}</span>
                        <button 
                          onClick={() => {
                            setEditingTrackingId(tn.id);
                            setCustomTimestamp(tn.custom_timestamp ? new Date(tn.custom_timestamp).toISOString().slice(0, 10) : '');
                          }}
                          className="edit-timestamp-btn"
                          title="Edit timestamp"
                        >
                          ✏️
                        </button>
                      </div>
                    )}
                  </td>
                  <td>{formatDate(tn.created_at)}</td>
                  <td>{formatDate(tn.updated_at)}</td>
                  <td>
                    <div className="action-buttons">
                      <select
                        value={tn.current_status}
                        onChange={(e) => {
                          const newStatus = e.target.value as 'not_scanned' | 'scanned' | 'delivered';
                          if (editingTrackingId === tn.id && customTimestamp) {
                            // Convert date to ISO timestamp (midnight UTC)
                            const dateTimestamp = customTimestamp ? new Date(customTimestamp + 'T00:00:00Z').toISOString() : null;
                            handleStatusChange(tn.id, newStatus, tn.postbox_id, dateTimestamp);
                          } else {
                            handleStatusChange(tn.id, newStatus, tn.postbox_id, tn.custom_timestamp || null);
                          }
                        }}
                        className="status-select"
                      >
                        <option value="not_scanned">🔴 Not Scanned</option>
                        <option value="scanned">🟡 Scanned</option>
                        <option value="delivered">🟢 Delivered</option>
                      </select>
                      <button
                        onClick={() => handleRefreshSingle(tn.id)}
                        className="refresh-btn"
                        title="Refresh this tracking number"
                        style={{ marginRight: '5px' }}
                      >
                        🔄 Refresh
                      </button>
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

      {totalItems > itemsPerPage && (
        <div className="pagination">
          <div className="pagination-info">
            Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} entries
          </div>
          <div className="pagination-controls">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="pagination-btn"
            >
              First
            </button>
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="pagination-btn"
            >
              Previous
            </button>
            <span className="pagination-page-info">
              Page {currentPage} of {Math.ceil(totalItems / itemsPerPage)}
            </span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(Math.ceil(totalItems / itemsPerPage), prev + 1))}
              disabled={currentPage >= Math.ceil(totalItems / itemsPerPage)}
              className="pagination-btn"
            >
              Next
            </button>
            <button
              onClick={() => setCurrentPage(Math.ceil(totalItems / itemsPerPage))}
              disabled={currentPage >= Math.ceil(totalItems / itemsPerPage)}
              className="pagination-btn"
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

