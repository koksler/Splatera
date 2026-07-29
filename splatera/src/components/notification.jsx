import React from 'react';
import { Undo2 } from 'lucide-react';
import Button from './button';
import './notification.css';

export default function Notification({
  isVisible,
  title,
  description,
  progress,
  undoId,
  onUndo,
  undoText = "Undo"
}) {
  const hasProgress = typeof progress === 'number' && !isNaN(progress);

  return (
    <div className={`splatera-notification ${isVisible ? 'show' : ''}`}>
      {title && <h3 className="notification-title">{title}</h3>}

      {hasProgress && (
        <div className="notification-progress-bg">
          <div
            className="notification-progress-fill"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}

      {description && <p className="notification-desc">{description}</p>}

      {Boolean(undoId) && onUndo && (
        <Button
          icon={Undo2}
          text={undoText}
          onClick={onUndo}
          className="notification-undo-btn"
        />
      )}
    </div>
  );
}