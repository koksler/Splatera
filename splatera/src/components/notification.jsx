import './notification.css';

export default function Notification({ isVisible, title, description, progress, undoId, onUndo }) {
  return (
    <div className={`splatera-notification ${isVisible ? 'show' : ''}`}>
      <div className="notification-content">
        <h3 className="notification-title">{title}</h3>
        <p className="notification-desc">{description}</p>

        {typeof progress === 'number' && (
          <div className="notification-progress-bg">
            <div
              className="notification-progress-fill"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        )}

        {undoId && onUndo && (
          <button className="notification-undo-btn" onClick={onUndo}>Undo</button>
        )}
      </div>
    </div>
  );
}