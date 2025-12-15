import { useState, useEffect } from 'react';
import { api, Box } from '../api/api';
import './AddTracking.css';

export default function AddTracking() {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selectedBox, setSelectedBox] = useState<number | null>(null);
  const [newBoxName, setNewBoxName] = useState('');
  const [showNewBox, setShowNewBox] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [bulkTrackingNumbers, setBulkTrackingNumbers] = useState('');
  const [bulkCustomTimestamp, setBulkCustomTimestamp] = useState('');
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadBoxes();
  }, []);

  const loadBoxes = async () => {
    try {
      const response = await api.getBoxes();
      setBoxes(response.data);
    } catch (error) {
      console.error('Failed to load boxes:', error);
    }
  };

  const handleCreateBox = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBoxName.trim()) return;

    try {
      const response = await api.createBox(newBoxName.trim());
      setBoxes([...boxes, response.data]);
      setSelectedBox(response.data.id);
      setNewBoxName('');
      setShowNewBox(false);
      setMessage({ type: 'success', text: 'Box created successfully' });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.response?.data?.error || 'Failed to create box',
      });
    }
  };

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackingNumber.trim()) return;

    setLoading(true);
    setMessage(null);

    try {
      await api.createTrackingNumber(trackingNumber.trim(), selectedBox || undefined);
      setTrackingNumber('');
      setMessage({ type: 'success', text: 'Tracking number added successfully' });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.response?.data?.error || 'Failed to add tracking number',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkTrackingNumbers.trim()) return;

    setLoading(true);
    setMessage(null);

    try {
      // Parse tracking numbers (split by newline, comma, or space)
      const numbers = bulkTrackingNumbers
        .split(/[\n,]+/)
        .map((n) => n.trim())
        .filter((n) => n.length > 0);

      if (numbers.length === 0) {
        setMessage({ type: 'error', text: 'No valid tracking numbers found' });
        setLoading(false);
        return;
      }

      // Convert custom timestamp to ISO8601 format if provided
      const customTimestamp = bulkCustomTimestamp 
        ? new Date(bulkCustomTimestamp + 'T00:00:00Z').toISOString() 
        : null;

      const response = await api.bulkCreateTrackingNumbers(
        numbers,
        selectedBox || undefined,
        customTimestamp
      );
      setBulkTrackingNumbers('');
      setBulkCustomTimestamp('');
      setMessage({
        type: 'success',
        text: `Successfully added ${response.data.tracking_numbers.length} tracking numbers`,
      });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.response?.data?.error || 'Failed to add tracking numbers',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="add-tracking">
      <h2>Add Tracking Numbers</h2>

      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="box-selector">
        <label>
          Select Box (optional):
          <select
            value={selectedBox || ''}
            onChange={(e) =>
              setSelectedBox(e.target.value ? parseInt(e.target.value) : null)
            }
          >
            <option value="">No Box</option>
            {boxes.map((box) => (
              <option key={box.id} value={box.id}>
                {box.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => setShowNewBox(!showNewBox)}
          className="new-box-btn"
        >
          {showNewBox ? 'Cancel' : '+ New Box'}
        </button>
      </div>

      {showNewBox && (
        <form onSubmit={handleCreateBox} className="new-box-form">
          <input
            type="text"
            placeholder="Box name"
            value={newBoxName}
            onChange={(e) => setNewBoxName(e.target.value)}
            required
          />
          <button type="submit">Create Box</button>
        </form>
      )}

      <div className="mode-selector">
        <button
          className={mode === 'single' ? 'active' : ''}
          onClick={() => setMode('single')}
        >
          Single Entry
        </button>
        <button
          className={mode === 'bulk' ? 'active' : ''}
          onClick={() => setMode('bulk')}
        >
          Bulk Upload
        </button>
      </div>

      {mode === 'single' ? (
        <form onSubmit={handleSingleSubmit} className="tracking-form">
          <div className="form-group">
            <label htmlFor="tracking-number">Tracking Number</label>
            <input
              type="text"
              id="tracking-number"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="Enter tracking number"
              required
            />
          </div>
          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Adding...' : 'Add Tracking Number'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleBulkSubmit} className="tracking-form">
          <div className="form-group">
            <label htmlFor="bulk-tracking-numbers">
              Tracking Numbers (one per line or comma-separated)
            </label>
            <textarea
              id="bulk-tracking-numbers"
              value={bulkTrackingNumbers}
              onChange={(e) => setBulkTrackingNumbers(e.target.value)}
              placeholder="Enter tracking numbers, one per line or separated by commas"
              rows={10}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="bulk-custom-timestamp">
              Custom Timestamp (optional)
            </label>
            <input
              type="date"
              id="bulk-custom-timestamp"
              value={bulkCustomTimestamp}
              onChange={(e) => setBulkCustomTimestamp(e.target.value)}
            />
            <small>If provided, this timestamp will be applied to all tracking numbers in this bulk import.</small>
          </div>
          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Adding...' : 'Add Tracking Numbers'}
          </button>
        </form>
      )}
    </div>
  );
}

