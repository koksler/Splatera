import React, { useEffect } from 'react';
import { X, Trash2, Tag } from 'lucide-react';
import Button from './button';
import './confirmationModal.css';

export default function ConfirmationModal({
  isOpen,
  title = "Are you sure?",
  description,
  confirmText = "Delete",
  cancelText = "Cancel",
  thirdActionText,
  onConfirm,
  onCancel,
  onThirdAction,
  stacked = false,
}) {
  // Global ESC key listener to trigger cancel
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (onCancel) onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="confirmation-modal-overlay" onMouseDown={onCancel}>
      <div className="confirmation-modal-container" onMouseDown={(e) => e.stopPropagation()}>
        {/* Title */}
        <h2 className="confirmation-modal-title">{title}</h2>

        {/* Description */}
        <p className="confirmation-modal-desc">{description}</p>

        {/* Action Buttons Footer */}
        <div className={`confirmation-modal-footer ${stacked ? 'stacked' : ''}`}>
          <Button
            icon={X}
            text={cancelText}
            onClick={onCancel}
            className="confirmation-modal-btn"
          />
          <Button
            icon={Trash2}
            text={confirmText}
            onClick={onConfirm}
            className="confirmation-modal-btn"
          />
          {thirdActionText && onThirdAction && (
            <Button
              icon={Tag}
              text={thirdActionText}
              onClick={onThirdAction}
              className="confirmation-modal-btn"
            />
          )}
        </div>
      </div>
    </div>
  );
}
